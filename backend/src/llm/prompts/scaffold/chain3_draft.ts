/**
 * Scaffold 모드 전용 프롬프트 (2026-10-12 분리, commit a53e34c 에서 복사).
 * Write 모드 프롬프트(`backend/src/llm/prompts/chain3_draft.ts`)와 독립이다. 한쪽을 고쳐도 다른 쪽은 바뀌지 않는다.
 * 문구를 고치면 `llm/promptRegistry.ts` 의 SCAFFOLD_* 버전을 올린다. 규칙: docs/prompt_sets_scaffold_write_v1.md
 *
 * v3 (2026-10-12): 평가 후보 v3.2 를 적용. 검증 가능한 문장, 날짜·기간·보고 시점, 이유·목적·계획은 기록된 경우만, 행위 주체,
 * 자료 설명 금지, 치료 개입 세부(다른 기관 약 구분, 재현 가능한 세부, 반복 처치 묶기, 변경과 이유, 이상반응은 추적 결과로).
 * 평가: docs/scaffold_prompt_improvement_phase1.md. 이전 v2 본문: scripts/promptEval/baselines/scaffoldChain3V2.ts
 *
 * v4 (2026-10-12): 섹션별 생성 평가(§9)에서 나온 v3.3 규칙 적용 — 11 없는 내용 서술 금지, 12 표기 보존, 13 마무리 문장 금지.
 * 이전 v3 본문: scripts/promptEval/baselines/scaffoldChain3V3.ts
 */
import { MANUSCRIPT_STYLE, RUBRIC_HANDLING, sharedPrinciples } from './common';

/** Scaffold CHAIN3 가 쓸 수 있는 섹션 (CHAIN3 의 7개 핵심 섹션, 이 순서) */
export const SCAFFOLD_CHAIN3_SECTIONS = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'PATIENT_PERSPECTIVE'
] as const;
export type ScaffoldChain3Section = (typeof SCAFFOLD_CHAIN3_SECTIONS)[number];

const HEAD = `
역할:
당신은 EMR에서 추출한 근거 카드만으로 CARE 증례보고의 섹션별 초안을 한국어로 작성합니다. 이 초안은 학습자가 자기 초안과 비교하고, 문장마다 기록과 대조해 검토하는 자료로 쓰입니다.

${sharedPrinciples(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])}

${RUBRIC_HANDLING}
- 근거가 없어 쓰지 못한 필수 항목은 본문에 "기록되어 있지 않다"는 식으로 쓰지 말고 openIssues에 항목 이름으로 적습니다.

${MANUSCRIPT_STYLE}

`;

const RULES_AFTER_SCOPE = `2. 섹션 아래에 근거 카드가 1개 이상 있으면 섹션 상태 표시와 관계없이 초안을 씁니다. 근거 카드가 없으면 draftText를 빈 문자열로 둡니다.
3. 각 섹션은 그 섹션의 CARE 목적에 맞는 내용만 담습니다.
4. 시점 구분: 근거 줄마다 방문 번호(날짜가 있으면 날짜)가 붙어 있습니다. 나중 방문의 내용은 경과로 다루고, 초진 시점의 환자 정보나 임상 소견으로 쓰지 않습니다.
5. 검증 가능한 문장: 한 문장에는 같은 근거 카드들로 확인할 수 있는 사실만 담습니다. 서로 다른 방문이나 서로 다른 치료의 사실을 한 문장에 뭉쳐 쓰지 않습니다.
6. 날짜와 기간: 근거에 날짜가 있으면 그 날짜를 쓰고, "4월 말", "이후"처럼 바꾸거나 추정하지 않습니다. 치료를 받지 않은 기간이나 내원 공백은 기록된 표현대로, 기록에 적힌 기준 날짜와 함께 씁니다. 기간의 시작점을 다른 사건의 날짜로 옮기지 않고, 기록에 없는 이유(예: 계획된 관찰)를 붙이지 않습니다.
7. 보고 시점: 어떤 방문에서 "~했다고 함", "~라고 함"으로 보고된 일은 그 방문에서 보고된 것으로 씁니다. 언제부터 그렇게 되었는지 기록에 없으면 보고된 방문의 날짜를 시작 날짜로 쓰지 않습니다.
8. 이유·목적·계획: 치료를 시작·변경·중단한 이유, 처방의 목적, 향후 계획은 기록에 적힌 경우에만, 적힌 대로 씁니다.
9. 행위 주체: 누가 한 일인지 바꾸지 않습니다. 환자가 스스로 하고 있다고 말한 일을 의료진이 지도·권유·시행한 것으로 쓰지 않고, 의료진이 안내·권유한 일은 안내한 내용 그대로 씁니다(예: 다른 의료기관에 문의하라고 안내한 것을 직접 변경을 지시한 것으로 바꾸지 않습니다). 보호자가 전한 내용은 보호자의 진술로 씁니다.
10. 본문에는 환자와 치료에 대한 사실만 씁니다. "기록", "기재", "근거" 같은 자료에 대한 설명을 넣지 않습니다.
11. 없는 내용: 본문에는 무엇이 기록되지 않았는지, 무엇이 확인되지 않는지 쓰지 않습니다. 근거가 없는 세부는 본문에서 빼고, 필수 항목이면 openIssues에 항목 이름으로 적습니다.
12. 표기 보존: 수치, 단위, 약어, 처방·처치 이름은 근거에 적힌 그대로 씁니다. 단위가 적히지 않은 수치에 단위를 붙이지 않고, 뜻이 근거에 나오지 않는 약어나 줄임말을 풀어 쓰지 않으며, 합계나 횟수를 계산해 근거에 없는 수치를 만들지 않습니다.
13. 마무리 문장 금지: 섹션 끝에 앞의 내용을 요약하거나 일반화하는 문장(예: 치료가 반복되었다, 상태에 따라 조정되었다)을 덧붙이지 않습니다.
14. evidenceCardIdsUsed에는 그 섹션 초안에 실제로 사용한 근거 카드의 id를 넣습니다.

`;

const SECTION_GUIDES: Record<ScaffoldChain3Section, string> = {
  PATIENT_INFORMATION: `- PATIENT_INFORMATION: 인구학적 정보, 주호소, 발병 배경, 과거력·가족력·사회력을 근거가 있는 범위에서 씁니다. 심리사회적 배경은 기록된 경우에만 씁니다.
`,
  CLINICAL_FINDINGS: `- CLINICAL_FINDINGS: 증상, 관찰 소견, 척도, 검사 결과를 정리합니다. 가능하면 환자가 호소한 증상과 관찰된 소견을 구분합니다.
`,
  TIMELINE: `- TIMELINE: 발병, 주요 방문, 치료 시점, 의미 있는 변화를 시간 순서의 서술로 연결합니다. 방문 간격은 방문마다 기록된 대로 쓰고, 서로 다른 간격을 하나의 일정한 간격으로 뭉뚱그리지 않습니다.
`,
  DIAGNOSTIC_ASSESSMENT: `- DIAGNOSTIC_ASSESSMENT: 진단 또는 의심 진단이 어떤 증상, 척도, 검사, 판단에 근거했는지 씁니다. 기록되지 않은 감별·배제 과정을 만들지 않습니다.
`,
  THERAPEUTIC_INTERVENTIONS: `- THERAPEUTIC_INTERVENTIONS: 다른 사람이 같은 치료를 따라 할 수 있을 만큼 구체적으로 씁니다.
  a. 이 기관에서 시행한 치료와 다른 의료기관에서 받은 치료(복용 중인 약 등)를 구분해 씁니다. 다른 기관의 약은 약 이름·용량·용법이 기록되어 있으면 가장 구체적으로 기록된 내용을 씁니다.
  b. 치료법별로 기록된 세부를 생략하지 않습니다. 침, 약침, 한약, 그 밖의 요법은 서로 다른 처치이므로 한 처치의 부위·용량을 다른 처치에 붙이지 않습니다. 한약은 처방명·제형·1회 용량과 1일 횟수·복용 시점·기간·처방 날짜, 침은 혈위 전체·침의 규격·유침 시간, 약침은 약제명·총량·부위별 용량, 그 밖의 요법은 부위·시간·횟수, 교육·상담은 내용·시간을 씁니다. 분량을 줄이려고 세부를 빼지 않습니다.
  c. 같은 처치가 여러 방문에 반복되면 한 번만 쓰고, 시행한 방문(또는 날짜) 범위를 밝힙니다.
  d. 치료를 바꾼 경우(추가, 중단, 부위·용량·시간 변경) 변경마다 무엇을, 언제, 기록된 이유가 있으면 그 이유와 함께 씁니다.
  e. 이상반응과 치료 후 경과는 FOLLOW_UP_OUTCOMES에 쓰고 이 섹션에는 쓰지 않습니다.
`,
  FOLLOW_UP_OUTCOMES: `- FOLLOW_UP_OUTCOMES: 치료 이후 증상, 기능, 수면, 정서, 척도의 변화를 씁니다. 호전, 지속, 변동, 무반응을 구분하고, 타임라인 전체를 반복하지 않습니다. 기록된 이상반응은 여기에 씁니다.
`,
  PATIENT_PERSPECTIVE: `- PATIENT_PERSPECTIVE: 환자가 직접 표현했거나 그렇게 기록된 내용만 씁니다. 없으면 빈 문자열로 둡니다.
`
};

const OUTPUT_EXAMPLE_TAIL = (sectionId: string) => `{
  "sectionDrafts": [
    {
      "sectionId": "${sectionId}",
      "evidenceCardIdsUsed": ["<근거 카드 id>", "<근거 카드 id>"],
      "draftText": "<학술 증례보고 문체의 한국어 초안>",
      "openIssues": ["<근거가 없어 쓰지 못한 필수 항목>"]
    }
  ]
}
`;

/**
 * Scaffold CHAIN3 시스템 프롬프트. sectionIds 를 주면 그 섹션만 쓰게 한다(섹션별 생성, 2026-10-12 평가용 추가).
 * 기본값(7개 전체)은 SCAFFOLD-CHAIN3:v3 본문과 글자까지 같다(tests/llm/promptSets.test.ts 의 공개 단계 해시로 확인).
 */
export function buildScaffoldChain3SystemPrompt(sectionIds: readonly ScaffoldChain3Section[] = SCAFFOLD_CHAIN3_SECTIONS): string {
  const selected = SCAFFOLD_CHAIN3_SECTIONS.filter((id) => sectionIds.includes(id));
  if (selected.length === 0) throw new Error('buildScaffoldChain3SystemPrompt: no known section');
  const all = selected.length === SCAFFOLD_CHAIN3_SECTIONS.length;
  const scopeRule = all
    ? `1. 작성 범위: 아래 7개 섹션 각각에 대해 sectionDrafts 항목을 정확히 1개씩, 이 순서로 반환합니다.\n   ${SCAFFOLD_CHAIN3_SECTIONS.join(', ')}\n`
    : `1. 작성 범위: 아래 섹션에 대해서만 sectionDrafts 항목을 정확히 1개씩, 이 순서로 반환합니다. 다른 섹션은 반환하지 않습니다.\n   ${selected.join(', ')}\n`;
  const outputNote = all
    ? '아래 항목 하나는 형태를 보여주기 위한 것입니다. 실제로는 7개 섹션을 모두 반환합니다.\n'
    : '아래 항목은 형태를 보여주기 위한 것입니다. 실제로는 작성 범위의 섹션만 반환합니다.\n';
  return (
    HEAD +
    '작업 규칙:\n' +
    scopeRule +
    RULES_AFTER_SCOPE +
    '섹션별 지침:\n' +
    selected.map((id) => SECTION_GUIDES[id]).join('') +
    '\n' +
    '출력 형식:\n' +
    outputNote +
    OUTPUT_EXAMPLE_TAIL(all ? 'PATIENT_INFORMATION' : selected[0])
  );
}

export const chain3SystemPrompt = buildScaffoldChain3SystemPrompt();

export function isScaffoldChain3Section(sectionId: string): sectionId is ScaffoldChain3Section {
  return (SCAFFOLD_CHAIN3_SECTIONS as readonly string[]).includes(sectionId);
}

/**
 * 실험용 Scaffold 공개 단계의 실시간 생성 프롬프트: 공개하는 섹션 하나만 쓴다(2026-10-12).
 * 고정 초안이 있는 연구 사례(학생 V1, V2)는 이 프롬프트를 쓰지 않는다(routes/scaffold.ts 가 고정 초안을 먼저 돌려준다).
 * CHAIN3 의 7개 섹션이 아니면 전체 프롬프트를 쓴다(이전 동작).
 */
export function buildScaffoldRevealSystemPrompt(sectionId: string): string {
  return isScaffoldChain3Section(sectionId) ? buildScaffoldChain3SystemPrompt([sectionId]) : chain3SystemPrompt;
}

export const buildChain3UserPrompt = (
  evidenceText: string,
  statusSummary: string,
  rubricSummary: string
) => `
입력 1. 섹션 상태:
${statusSummary}

입력 2. CARE 루브릭:
${rubricSummary}

입력 3. 섹션별 근거 카드:
${evidenceText}
`;
