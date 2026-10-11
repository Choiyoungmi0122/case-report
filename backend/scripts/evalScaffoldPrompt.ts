/**
 * Scaffold CHAIN3 프롬프트 평가 (서비스·DB 에 쓰지 않는다).
 *
 * 사용: npm run eval:scaffold-prompt -- --variant <frozen|v2|current> [--source <fixed|case:<id>|sample:hwa-byung>] [--dates] [--runs 1]
 *  - frozen  : 고정 연구 사례에 저장된 AI 초안(2026-10-04, c18c6e5 프롬프트)을 채점만 한다. LLM 호출 없음. --source fixed 만.
 *  - v2      : 2026-10-12 적용 전 Scaffold 프롬프트(scripts/promptEval/baselines/scaffoldChain3V2.ts).
 *  - current : 지금 서비스 Scaffold 프롬프트(prompts/scaffold/chain3_draft.ts, v3).
 *  - --source
 *      fixed            고정 연구 사례(defaultStudyCaseProcessed.generated.ts). CARE 정리표 기준 22항목 채점을 함께 낸다.
 *      case:<caseId>    DB 에 있는 처리된 사례의 근거 카드·섹션 상태를 읽어 쓴다(읽기 전용).
 *      sample:hwa-byung 저장소 샘플 입력(scripts/sampleInput.hwa-byung.json). 처음 한 번 전처리·CHAIN1·CHAIN2 를 돌려
 *                       data/prompt-eval/inputs/ 에 저장하고, 다음부터 그 입력을 그대로 쓴다(비교 조건을 같게).
 *  - --dates : 근거 줄에 방문 날짜를 붙여 보낸다(서비스 기본값은 끔).
 *  - --sections A,B : 섹션별 생성. 그 섹션만 쓰게 한다(current 만). 예: --sections THERAPEUTIC_INTERVENTIONS
 *  - --evidence section|all : 섹션별 생성 때 근거 목록 범위. section(기본) = 그 섹션 근거만, all = 7개 섹션 근거 전체.
 *  - (v3.3 후보 규칙은 2026-10-12 서비스 v4 에 들어갔다. 이전 v3 본문은 --variant v3 로 비교한다.)
 *
 * 사례와 무관한 지표(모든 source): 치료 개입 근거의 숫자+단위 표기(용량·횟수·시간·규격)가 초안에 남은 비율, 초안의 숫자+단위 표기 중
 * 어느 근거 카드에도 없는 것(바뀌었거나 지어낸 값 후보), 글자·문장 수. 최종 판단은 사람이 초안을 기록과 대조해 한다.
 *
 * 출력: backend/data/prompt-eval/<시각>_<source>_<variant>.json (git 밖). 사용량 기록에는 caseId "eval:scaffold-chain3".
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { FIXED_STUDY_CASE_PROCESSED } from '../src/study/cases/defaultStudyCaseProcessed.generated';
import { callLLMWithSchema } from '../src/llm/client';
import {
  buildChain3Inputs,
  normalizeChain3Output,
  preprocessVisitsForChain1,
  runEvidenceSplit,
  runInitialSectionDrafts,
  runSectionAssessment
} from '../src/llm/chains';
import { getModelForChain } from '../src/llm/models';
import { Chain3ModelOutputSchema } from '../src/llm/schemas/chain3_draft';
import {
  chain3SystemPrompt as currentScaffoldChain3,
  buildChain3UserPrompt,
  buildScaffoldChain3SystemPrompt,
  SCAFFOLD_CHAIN3_SECTIONS,
  ScaffoldChain3Section
} from '../src/llm/prompts/scaffold/chain3_draft';
import { promptVersionLabel } from '../src/llm/promptRegistry';
import { runWithUsageContext } from '../src/llm/usageContext';
import { getScaffoldTerminologyRuntime } from '../src/rag/runtime';
import { SCAFFOLD_CHAIN3_V2_LABEL, scaffoldChain3V2SystemPrompt } from './promptEval/baselines/scaffoldChain3V2';
import { scoreTiDraft } from './promptEval/scaffoldTiChecklist';
import { SCAFFOLD_CHAIN3_V3_LABEL, scaffoldChain3V3SystemPrompt } from './promptEval/baselines/scaffoldChain3V3';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

type Variant = 'frozen' | 'v2' | 'v3' | 'current';
type Inputs = { evidenceCards: any[]; sectionStates: any[]; label: string };

const OUT_DIR = path.resolve(__dirname, '../data/prompt-eval');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadInputs(source: string): Promise<Inputs> {
  if (source === 'fixed') {
    const fields: any = (FIXED_STUDY_CASE_PROCESSED as any).fields;
    return { evidenceCards: fields.evidenceCards, sectionStates: fields.sectionStates, label: '고정 연구 사례' };
  }
  if (source.startsWith('case:')) {
    const caseId = source.slice('case:'.length);
    const mongoose = (await import('mongoose')).default;
    const { CaseModel, initDatabase } = await import('../src/db/schema');
    await initDatabase();
    try {
      const doc: any = await CaseModel.findOne({ id: caseId }, { evidenceCards: 1, sectionStates: 1, experiment_code: 1 }).lean().exec();
      if (!doc?.evidenceCards?.length) throw new Error(`case ${caseId} has no evidence cards`);
      return { evidenceCards: doc.evidenceCards, sectionStates: doc.sectionStates || [], label: `DB 사례 ${doc.experiment_code || caseId}` };
    } finally {
      await mongoose.disconnect();
    }
  }
  if (source === 'sample:hwa-byung') {
    const cacheFile = path.join(OUT_DIR, 'inputs', 'sample-hwa-byung.json');
    if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const raw = fs.readFileSync(path.resolve(__dirname, 'sampleInput.hwa-byung.json'));
    // 이 파일은 UTF-8 이 아닐 수 있다(2026-04 작성). UTF-8 로 읽히지 않으면 CP949 로 읽는다.
    let text = raw.toString('utf8');
    if (text.includes('�')) text = new TextDecoder('euc-kr').decode(raw);
    const sample = JSON.parse(text);
    const visits = (sample.visits || []).map((visit: any, idx: number) => ({
      index: visit.index ?? visit.visitIndex ?? idx + 1,
      date: visit.date ?? visit.visitDateTime ?? '',
      text: visit.soapText ?? visit.text ?? visit.sanitizedText ?? ''
    }));
    const runtime = getScaffoldTerminologyRuntime();
    const prepared = await runWithUsageContext({ caseId: 'eval:scaffold-chain3' }, () =>
      preprocessVisitsForChain1(visits, { semanticMatcher: runtime.semanticMatcher, llmResolver: runtime.llmResolver })
    );
    if (prepared.reviewRequired?.riskLevel === 'HIGH') throw new Error('sample blocked by HIGH de-identification risk');
    const evidenceCards = await runWithUsageContext({ caseId: 'eval:scaffold-chain3' }, () =>
      runEvidenceSplit(prepared.preparedVisits as any, { promptSet: 'scaffold' })
    );
    const sectionStates = await runWithUsageContext({ caseId: 'eval:scaffold-chain3' }, () =>
      runSectionAssessment(evidenceCards, { promptSet: 'scaffold' })
    );
    const inputs = { evidenceCards, sectionStates, label: '샘플 화병 사례' };
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(inputs, null, 2), 'utf8');
    return inputs;
  }
  throw new Error(`unknown source ${source}`);
}

const DETAIL_TOKEN = /\d+(?:\.\d+)?\s*(?:mg|g|cc|ml|mL|포|회|분|mm|정|캡슐|cap|C|T|일|주|개월|ml|%)/g;
const normalizeToken = (token: string) => token.replace(/\s+/g, '').toLowerCase();

/** 날짜(2026-04-15, 4월 15일, 4/15, 3월 11일부터)는 세부 수치로 세지 않는다 */
const DATE_LIKE = /\d{4}-\d{1,2}-\d{1,2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일|\d{1,2}\s*\/\s*\d{1,2}/g;

function tokensOf(text: string): Set<string> {
  const withoutDates = String(text || '').replace(DATE_LIKE, ' ');
  return new Set((withoutDates.match(DETAIL_TOKEN) || []).map(normalizeToken));
}

/** 사례와 무관한 지표 */
function genericMetrics(text: string, evidenceCards: any[]) {
  const tiCards = evidenceCards.filter((card) =>
    [...(card.tags || []), ...(card.sectionHints || [])].includes('THERAPEUTIC_INTERVENTIONS')
  );
  const tiTokens = new Set<string>();
  for (const card of tiCards) tokensOf(card.normalizedText || card.sourceText).forEach((token) => tiTokens.add(token));
  const allTokens = new Set<string>();
  for (const card of evidenceCards) {
    tokensOf(card.normalizedText || card.sourceText).forEach((token) => allTokens.add(token));
    tokensOf(card.sourceText).forEach((token) => allTokens.add(token));
  }
  const draftTokens = tokensOf(text);
  const sentenceList = text.split(/(?<=[.다])\s+/).filter((sentence) => sentence.trim());
  // "~은 기록되어 있지 않다", "확인되지 않았다" 처럼 없는 내용을 본문에 쓴 문장 (규칙상 openIssues 로 가야 한다)
  const absence = sentenceList.filter((sentence) =>
    /(기록|기재|명시|확인)(되어|되지|돼)\s*(있지\s*)?않|기록에\s*(나타나지|없)|확인되지\s*않/.test(sentence)
  );
  const kept = [...tiTokens].filter((token) => draftTokens.has(token));
  const notInEvidence = [...draftTokens].filter((token) => !allTokens.has(token));
  return {
    tiCards: tiCards.length,
    detailTokensInEvidence: tiTokens.size,
    detailTokensKept: kept.length,
    detailRetention: tiTokens.size ? Math.round((kept.length / tiTokens.size) * 100) : null,
    draftTokensNotInEvidence: notInEvidence,
    absenceSentences: absence.length,
    chars: text.length,
    sentences: text.split(/(?<=[.다])\s+/).filter((sentence) => sentence.trim()).length
  };
}

type Scope = { sections?: ScaffoldChain3Section[]; evidence: 'section' | 'all'; candidate?: 'v33' };

function scopeTag(scope: Scope): string {
  const cand = scope.candidate ? `+${scope.candidate}` : '';
  if (!scope.sections) return cand;
  return `${cand}+sec(${scope.sections.map((id) => id.slice(0, 4)).join(',')}${scope.evidence === 'all' ? ',allEv' : ''})`;
}

async function generate(variant: Exclude<Variant, 'frozen'>, inputs: Inputs, includeVisitDates: boolean, scope: Scope) {
  // 서비스 경로 그대로: 공개 단계와 같은 호출(runInitialSectionDrafts + sectionIds, 그 섹션 근거만)
  if (variant === 'current' && scope.sections && scope.evidence === 'section' && !includeVisitDates) {
    let serviceUsage: any = null;
    const serviceStartedAt = Date.now();
    const serviceDrafts = await runInitialSectionDrafts(inputs.evidenceCards, inputs.sectionStates, {
      promptSet: 'scaffold',
      sectionIds: scope.sections,
      onUsage: (value) => {
        serviceUsage = value;
      }
    });
    return { drafts: serviceDrafts, usage: serviceUsage, elapsedMs: Date.now() - serviceStartedAt };
  }
  const chain3 = buildChain3Inputs(inputs.evidenceCards, inputs.sectionStates, {
    includeVisitDates,
    sectionIds: scope.sections,
    // all: 7개 섹션 근거 전체를 보여 준다(섹션 지정이 없을 때와 같은 근거 목록)
    evidenceSectionIds: scope.sections && scope.evidence === 'all' ? SCAFFOLD_CHAIN3_SECTIONS : scope.sections
  });
  if (scope.sections && variant !== 'current') throw new Error('--sections 는 current 에서만 쓴다');
  const base =
    variant === 'current'
      ? scope.sections
        ? buildScaffoldChain3SystemPrompt(scope.sections)
        : currentScaffoldChain3
      : variant === 'v3'
        ? scaffoldChain3V3SystemPrompt
        : scaffoldChain3V2SystemPrompt;
  const system = base;
  let usage: any = null;
  const startedAt = Date.now();
  const output = await callLLMWithSchema(
    Chain3ModelOutputSchema,
    system,
    buildChain3UserPrompt(chain3.evidenceText, chain3.statusSummary, chain3.rubricSummary),
    {
      model: getModelForChain('chain3'),
      label: `CHAIN3 draft [scaffold-eval:${variant}${includeVisitDates ? '+dates' : ''}${scopeTag(scope)}]`,
      onUsage: (value) => {
        usage = value;
      }
    }
  );
  const drafts = normalizeChain3Output(output.sectionDrafts || [], inputs.evidenceCards);
  return { drafts, usage, elapsedMs: Date.now() - startedAt };
}

export { genericMetrics };

async function main() {
  const variant = (arg('--variant') || 'frozen') as Variant;
  if (!['frozen', 'v2', 'v3', 'current'].includes(variant)) throw new Error(`unknown variant ${variant}`);
  const source = arg('--source') || 'fixed';
  if (variant === 'frozen' && source !== 'fixed') throw new Error('frozen 은 --source fixed 에서만 쓴다');
  const includeVisitDates = process.argv.includes('--dates');
  const runs = Math.max(1, Number(arg('--runs') || 1));
  const sectionsArg = arg('--sections');
  const scope: Scope = {
    sections: sectionsArg ? (sectionsArg.split(',').map((id) => id.trim()) as ScaffoldChain3Section[]) : undefined,
    evidence: arg('--evidence') === 'all' ? 'all' : 'section',
    candidate: undefined
  };
  const inputs = await loadInputs(source);
  const promptLabel =
    variant === 'frozen'
      ? 'CHAIN3:v1 (c18c6e5, 고정)'
      : variant === 'v2'
        ? SCAFFOLD_CHAIN3_V2_LABEL
        : variant === 'v3'
          ? SCAFFOLD_CHAIN3_V3_LABEL
          : promptVersionLabel('SCAFFOLD_CHAIN3');

  const results: any[] = [];
  for (let run = 1; run <= (variant === 'frozen' ? 1 : runs); run += 1) {
    const { drafts, usage, elapsedMs } =
      variant === 'frozen'
        ? { drafts: (FIXED_STUDY_CASE_PROCESSED as any).fields.sectionDrafts, usage: null, elapsedMs: 0 }
        : await runWithUsageContext({ caseId: 'eval:scaffold-chain3' }, () => generate(variant, inputs, includeVisitDates, scope));
    const ti = (drafts || []).find((draft: any) => draft.sectionId === 'THERAPEUTIC_INTERVENTIONS');
    const text = String(ti?.draftText || '');
    const generic = genericMetrics(text, inputs.evidenceCards);
    const fixedScore = source === 'fixed' ? scoreTiDraft(text) : null;
    results.push({
      run,
      fixedScore,
      generic,
      tiDraft: text,
      tiOpenIssues: ti?.openIssues || [],
      usage,
      elapsedMs,
      otherSections: Object.fromEntries(
        (drafts || []).filter((draft: any) => draft.sectionId !== 'THERAPEUTIC_INTERVENTIONS').map((draft: any) => [draft.sectionId, draft.draftText])
      )
    });
    const fixedPart = fixedScore
      ? ` | 정리표 ${fixedScore.coverage.all.hit}/${fixedScore.coverage.all.total} 오류 ${fixedScore.errors.length}`
      : '';
    console.log(
      `[${source} ${variant}${includeVisitDates ? '+dates' : ''}${scopeTag(scope)} run ${run}] ${promptLabel}${fixedPart} | 세부 보존 ${generic.detailTokensKept}/${generic.detailTokensInEvidence} (${generic.detailRetention}%) | 근거에 없는 수치 ${generic.draftTokensNotInEvidence.length} ${JSON.stringify(generic.draftTokensNotInEvidence)} | 없는 내용 서술 ${generic.absenceSentences}문장 | ${generic.chars}자 ${generic.sentences}문장` +
        (usage ? ` | 토큰 in ${usage.promptTokens} out ${usage.completionTokens}` : '')
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeSource = source.replace(/[^a-zA-Z0-9_-]/g, '_');
  const scopeFile =
    (scope.candidate ? `_${scope.candidate}` : '') +
    (scope.sections ? `_sec-${scope.sections.join('-')}${scope.evidence === 'all' ? '-allEv' : ''}` : '');
  const outFile = path.join(OUT_DIR, `${stamp}_${safeSource}_${variant}${includeVisitDates ? '_dates' : ''}${scopeFile}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ variant, source, sourceLabel: inputs.label, includeVisitDates, scope, promptLabel, results }, null, 2),
    'utf8'
  );
  console.log(`saved ${outFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
