/**
 * 실험용 Write "AI 원고 검사" (AI 하네스 2단계). 코드 검사(manuscriptCheck.ts)가 못 잡는 것을 모델이 찾는다.
 *  - SW-V1: 사실 섹션 일곱 개를 섹션마다 기록·답과 대조 (기록과 반대, 잘못 읽음, 근거 없는 추론, 말한 사람, 시점)
 *  - SW-V2: 모든 섹션을 함께 보고 섹션 사이 불일치
 * 모델이 짚은 원고 문장(excerpt)이 실제 원고에 없으면 버린다(지어낸 지적 방지). 고치지 않는다.
 */
import { callLLMWithSchema } from '../llm/client';
import { getModelForChain } from '../llm/chains';
import {
  buildStudyWriteVerifyCrossUserPrompt,
  buildStudyWriteVerifyEvidenceUserPrompt,
  buildStudyWriteVerifySectionUserPrompt,
  studyWriteVerifyCrossSystemPrompt,
  studyWriteVerifyEvidenceSystemPrompt,
  studyWriteVerifySectionSystemPrompt
} from '../llm/prompts/studyWrite_verify';
import {
  StudyWriteVerifyCrossOutputSchema,
  StudyWriteVerifyEvidenceOutputSchema,
  StudyWriteVerifySectionOutputSchema
} from '../llm/schemas/studyWrite_verify';
import { createOutboundDeidContext } from '../deid/outbound';
import { StudyWriteState } from '../types/studyWrite';
import { CARE_SECTION_NAMES, CARE_SECTION_ORDER, careWritingRule } from './careItems';
import { buildQaText } from './drafting';
import { buildRecordText } from './interview';
import { CheckSeverity, firstContentVisit, ManuscriptFinding, recordVisits } from './manuscriptCheck';

/** 문장 대조를 하는 사실 섹션 */
export const AI_VERIFY_SECTIONS = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'PATIENT_PERSPECTIVE'
] as const;

const TYPE_SEVERITY: Record<string, CheckSeverity> = {
  contradicted: 'error',
  misread: 'error',
  unsupported: 'warn',
  wrong_speaker: 'warn',
  wrong_timing: 'warn'
};

/** 띄어쓰기·줄바꿈 차이는 무시하고 원고에 그대로 있는지 */
export function excerptInText(excerpt: string, text: string): boolean {
  const squash = (value: string) => String(value || '').replace(/\s+/g, '');
  const needle = squash(excerpt).replace(/…$|\.\.\.$/, '');
  return needle.length >= 4 && squash(text).includes(needle);
}

/**
 * 섹션 사이 지적이 실제로 어긋나는지: 숫자, 처방명(앞부분만 같은 다른 이름), 유무 표현 중 하나라도 맞지 않아야 한다.
 * 한쪽이 덜 자세하거나 줄여 쓴 것뿐이면 false (모델이 규칙을 두고도 "자세함 차이"를 내는 일이 있어 코드로 거른다).
 */
export function crossConflicts(excerptA: string, excerptB: string): boolean {
  const nums = (text: string) => new Set((text.match(/\d+(?:\.\d+)?/g) || []).map(Number));
  const a = nums(excerptA);
  const b = nums(excerptB);
  const subset = (x: Set<number>, y: Set<number>) => [...x].every((value) => y.has(value));
  if (!subset(a, b) && !subset(b, a)) return true;
  const formula = /[가-힣]{2,10}(?:탕|산|음|환)(?:합[가-힣]{2,10}(?:탕|산|음|환))?/g;
  const namesA = excerptA.match(formula) || [];
  const namesB = excerptB.match(formula) || [];
  const prefixClash = (xs: string[], ys: string[]) => xs.some((x) => !ys.includes(x) && ys.some((y) => y !== x && (y.startsWith(x) || x.startsWith(y))));
  if (prefixClash(namesA, namesB) || prefixClash(namesB, namesA)) return true;
  const definiteNo = (text: string) => /(없었다|없다|않았다|않는다)/.test(text) && !text.includes('[확인 필요');
  const unsure = (text: string) => text.includes('[확인 필요');
  if ((definiteNo(excerptA) && unsure(excerptB)) || (definiteNo(excerptB) && unsure(excerptA))) return true;
  return false;
}

export interface AiCheckResult {
  findings: ManuscriptFinding[];
  model: string;
  /** 모델이 냈지만 원고에 없는 문장을 짚어 버린 지적 수 */
  droppedCount: number;
  failedSections: string[];
}

export async function runAiManuscriptCheck(params: { caseData: any; state: StudyWriteState }): Promise<AiCheckResult> {
  const { caseData, state } = params;
  const model = getModelForChain('chain6');
  const recordText = buildRecordText(caseData);
  const qaText = await buildQaText(state, undefined, createOutboundDeidContext());
  const first = firstContentVisit(recordVisits(caseData));
  const firstVisitLabel = first ? `방문 ${first.index} (${first.day === 0 ? '첫 기록일' : `첫 기록일 +${first.day}일`})` : '';
  const texts = Object.fromEntries(CARE_SECTION_ORDER.map((id) => [id, state.sections?.[id]?.draftText || '']));
  const findings: ManuscriptFinding[] = [];
  const failedSections: string[] = [];
  let dropped = 0;
  let seq = 0;
  const add = (finding: Omit<ManuscriptFinding, 'id' | 'sectionName'>) => {
    seq += 1;
    findings.push({ id: `ai-${seq}`, sectionName: CARE_SECTION_NAMES[finding.sectionId] || finding.sectionId, ...finding });
  };

  const sectionJobs = AI_VERIFY_SECTIONS.filter((id) => texts[id].trim()).map(async (sectionId) => {
    const output = await callLLMWithSchema(
      StudyWriteVerifySectionOutputSchema,
      studyWriteVerifySectionSystemPrompt,
      buildStudyWriteVerifySectionUserPrompt({
        sectionName: CARE_SECTION_NAMES[sectionId] || sectionId,
        firstVisitLabel,
        writingRule: careWritingRule(sectionId),
        sectionText: texts[sectionId],
        qaText,
        recordText
      }),
      { model, label: `SW-V1 ${sectionId}` }
    );
    return { sectionId, output };
  });

  const sectionsText = CARE_SECTION_ORDER.filter((id) => texts[id].trim())
    .map((id) => `### ${id} (${CARE_SECTION_NAMES[id]})\n${texts[id]}`)
    .join('\n\n');
  const crossJob = callLLMWithSchema(
    StudyWriteVerifyCrossOutputSchema,
    studyWriteVerifyCrossSystemPrompt,
    buildStudyWriteVerifyCrossUserPrompt({ sectionsText }),
    { model, label: 'SW-V2 cross' }
  );

  const [sectionResults, crossResult] = await Promise.all([Promise.allSettled(sectionJobs), crossJob.then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error }))]);

  // "근거 없음" 지적은 근거를 한 번 더 찾는다 (SW-V3). 찾은 인용문이 기록·답에 그대로 있으면 버린다.
  // 환자 관점의 지적은 말한 사람 문제라 근거 문장이 있어도 맞는 지적이므로 거르지 않는다.
  const sourceText = `${recordText}\n${qaText}`;
  const recheck = async (sectionId: string, excerpt: string): Promise<{ supported: boolean; where: string; quote: string }> => {
    try {
      const output = await callLLMWithSchema(
        StudyWriteVerifyEvidenceOutputSchema,
        studyWriteVerifyEvidenceSystemPrompt,
        buildStudyWriteVerifyEvidenceUserPrompt({ sectionName: CARE_SECTION_NAMES[sectionId] || sectionId, excerpt, qaText, recordText }),
        { model: getModelForChain('chain4'), label: `SW-V3 ${sectionId}` }
      );
      const supported = Boolean(output.found && output.quote && excerptInText(output.quote, sourceText) && output.quote.replace(/\s+/g, '').length >= 8);
      return { supported, where: output.where || '', quote: output.quote || '' };
    } catch {
      return { supported: false, where: '', quote: '' };
    }
  };
  let recheckedDropped = 0;
  type SectionFinding = Awaited<(typeof sectionJobs)[number]>['output']['findings'][number];
  const kept: Array<{ sectionId: string; item: SectionFinding }> = [];

  for (const [index, result] of sectionResults.entries()) {
    const sectionId = AI_VERIFY_SECTIONS.filter((id) => texts[id].trim())[index];
    if (result.status === 'rejected') {
      failedSections.push(sectionId);
      continue;
    }
    const seen = new Set<string>();
    for (const item of result.value.output.findings) {
      if (!excerptInText(item.excerpt, texts[sectionId]) || seen.has(item.excerpt)) {
        dropped += 1;
        continue;
      }
      seen.add(item.excerpt);
      kept.push({ sectionId, item });
    }
  }
  const rechecks = await Promise.all(
    kept.map(({ sectionId, item }) =>
      item.type === 'unsupported' && sectionId !== 'PATIENT_PERSPECTIVE' ? recheck(sectionId, item.excerpt) : Promise.resolve(null)
    )
  );
  kept.forEach(({ sectionId, item }, index) => {
    const again = rechecks[index];
    if (again?.supported) {
      recheckedDropped += 1;
      return;
    }
    {
      add({
        sectionId,
        kind: `ai_${item.type}`,
        severity: TYPE_SEVERITY[item.type] || 'warn',
        message: `${item.explanation}${item.suggestion ? ` 고칠 방향: ${item.suggestion}` : ''}`.trim(),
        excerpt: item.excerpt,
        evidence: item.evidence || undefined
      });
    }
  });
  dropped += recheckedDropped;

  if (crossResult.ok) {
    for (const item of crossResult.value.findings) {
      const a = texts[item.sectionA as keyof typeof texts];
      const b = texts[item.sectionB as keyof typeof texts];
      if (!a || !b || !excerptInText(item.excerptA, a) || !excerptInText(item.excerptB, b) || !crossConflicts(item.excerptA, item.excerptB)) {
        dropped += 1;
        continue;
      }
      add({
        sectionId: item.sectionA,
        kind: 'ai_cross',
        severity: 'warn',
        message: `${CARE_SECTION_NAMES[item.sectionB] || item.sectionB}와 어긋납니다. ${item.explanation}${item.suggestion ? ` 고칠 방향: ${item.suggestion}` : ''}`.trim(),
        excerpt: item.excerptA,
        evidence: `${CARE_SECTION_NAMES[item.sectionB] || item.sectionB}: ${item.excerptB}`
      });
    }
  } else {
    failedSections.push('섹션 사이 비교');
  }

  const order: Record<CheckSeverity, number> = { error: 0, warn: 1, info: 2 };
  findings.sort(
    (x, y) => order[x.severity] - order[y.severity] || CARE_SECTION_ORDER.indexOf(x.sectionId as any) - CARE_SECTION_ORDER.indexOf(y.sectionId as any)
  );
  return { findings, model, droppedCount: dropped, failedSections };
}
