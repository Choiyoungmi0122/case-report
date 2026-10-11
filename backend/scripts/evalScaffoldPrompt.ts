/**
 * Scaffold CHAIN3 프롬프트 평가 (서비스·DB 에 쓰지 않는다).
 *
 * 사용: npm run eval:scaffold-prompt -- --variant <frozen|current|candidate> [--dates] [--runs 1]
 *  - frozen    : 고정 연구 사례에 저장된 AI 초안(2026-10-04, c18c6e5 프롬프트)을 채점만 한다. LLM 호출 없음.
 *  - current   : 지금 Scaffold 프롬프트(prompts/scaffold/chain3_draft.ts)로 새로 생성한다.
 *  - candidate : 개선 후보(scripts/promptEval/candidates/scaffoldChain3V3.ts)로 새로 생성한다.
 *  - --dates   : 근거 줄에 방문 날짜를 붙여 보낸다(지금 서비스 입력에는 날짜가 없다).
 *
 * 입력: 고정 연구 사례의 근거 카드·섹션 상태(defaultStudyCaseProcessed.generated.ts). 고정 파일은 읽기만 한다.
 * 출력: backend/data/prompt-eval/<시각>_<variant>.json (git 에 올라가지 않는다) 과 콘솔 요약.
 * 비용: 생성 1회당 gpt-4.1 약 0.15~0.25 USD. 사용량 기록에는 caseId "eval:scaffold-chain3" 로 남는다.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { FIXED_STUDY_CASE_PROCESSED } from '../src/study/cases/defaultStudyCaseProcessed.generated';
import { callLLMWithSchema } from '../src/llm/client';
import { buildChain3Inputs, normalizeChain3Output } from '../src/llm/chains';
import { getModelForChain } from '../src/llm/models';
import { Chain3ModelOutputSchema } from '../src/llm/schemas/chain3_draft';
import { chain3SystemPrompt as currentScaffoldChain3, buildChain3UserPrompt } from '../src/llm/prompts/scaffold/chain3_draft';
import { promptVersionLabel } from '../src/llm/promptRegistry';
import { runWithUsageContext } from '../src/llm/usageContext';
import { SCAFFOLD_CHAIN3_V3_CANDIDATE_LABEL, scaffoldChain3V3SystemPrompt } from './promptEval/candidates/scaffoldChain3V3';
import { scoreTiDraft } from './promptEval/scaffoldTiChecklist';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

type Variant = 'frozen' | 'current' | 'candidate';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function generate(variant: Exclude<Variant, 'frozen'>, includeVisitDates: boolean) {
  const fields: any = (FIXED_STUDY_CASE_PROCESSED as any).fields;
  const inputs = buildChain3Inputs(fields.evidenceCards, fields.sectionStates, { includeVisitDates });
  const system = variant === 'current' ? currentScaffoldChain3 : scaffoldChain3V3SystemPrompt;
  let usage: any = null;
  const startedAt = Date.now();
  const output = await callLLMWithSchema(
    Chain3ModelOutputSchema,
    system,
    buildChain3UserPrompt(inputs.evidenceText, inputs.statusSummary, inputs.rubricSummary),
    {
      model: getModelForChain('chain3'),
      label: `CHAIN3 draft [scaffold-eval:${variant}${includeVisitDates ? '+dates' : ''}]`,
      onUsage: (value) => {
        usage = value;
      }
    }
  );
  const drafts = normalizeChain3Output(output.sectionDrafts || [], fields.evidenceCards);
  return { drafts, usage, elapsedMs: Date.now() - startedAt };
}

async function main() {
  const variant = (arg('--variant') || 'frozen') as Variant;
  if (!['frozen', 'current', 'candidate'].includes(variant)) throw new Error(`unknown variant ${variant}`);
  const includeVisitDates = process.argv.includes('--dates');
  const runs = Math.max(1, Number(arg('--runs') || 1));
  const fields: any = (FIXED_STUDY_CASE_PROCESSED as any).fields;
  const promptLabel =
    variant === 'frozen' ? 'CHAIN3:v1 (c18c6e5, 고정)' : variant === 'current' ? promptVersionLabel('SCAFFOLD_CHAIN3') : SCAFFOLD_CHAIN3_V3_CANDIDATE_LABEL;

  const results: any[] = [];
  for (let run = 1; run <= (variant === 'frozen' ? 1 : runs); run += 1) {
    const { drafts, usage, elapsedMs } =
      variant === 'frozen'
        ? { drafts: fields.sectionDrafts, usage: null, elapsedMs: 0 }
        : await runWithUsageContext({ caseId: 'eval:scaffold-chain3' }, () => generate(variant, includeVisitDates));
    const ti = (drafts || []).find((draft: any) => draft.sectionId === 'THERAPEUTIC_INTERVENTIONS');
    const text = String(ti?.draftText || '');
    const score = scoreTiDraft(text);
    results.push({
      run,
      score,
      tiDraft: text,
      tiOpenIssues: ti?.openIssues || [],
      heuristicUnsupported: (ti?.unsupportedClaims || []).map((item: any) => item.sentence),
      usage,
      elapsedMs,
      otherSections: Object.fromEntries(
        (drafts || []).filter((draft: any) => draft.sectionId !== 'THERAPEUTIC_INTERVENTIONS').map((draft: any) => [draft.sectionId, draft.draftText])
      )
    });
    const c = score.coverage;
    console.log(
      `[${variant}${includeVisitDates ? '+dates' : ''} run ${run}] ${promptLabel} | 9a ${c['9a'].hit}/${c['9a'].total} 9b ${c['9b'].hit}/${c['9b'].total} 9c ${c['9c'].hit}/${c['9c'].total} 합계 ${c.all.hit}/${c.all.total} | 오류 ${score.errors.length} | 범위 밖 ${score.scope.length} | ${score.chars}자 ${score.sentences}문장 | 근거 연결 못 한 문장(휴리스틱) ${results[results.length - 1].heuristicUnsupported.length}` +
        (usage ? ` | 토큰 in ${usage.promptTokens} out ${usage.completionTokens}` : '')
    );
    for (const error of score.errors) console.log(`   오류: ${error}`);
    console.log(`   빠짐: ${score.items.filter((item) => !item.hit).map((item) => item.label).join(' / ') || '없음'}`);
  }

  const outDir = path.resolve(__dirname, '../data/prompt-eval');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `${stamp}_${variant}${includeVisitDates ? '_dates' : ''}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ variant, includeVisitDates, promptLabel, results }, null, 2), 'utf8');
  console.log(`saved ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
