/**
 * Scaffold 모드 전용 프롬프트 (2026-10-12 분리, commit a53e34c 에서 복사).
 * Write 모드 프롬프트(`backend/src/llm/prompts/common.ts`)와 독립이다. 한쪽을 고쳐도 다른 쪽은 바뀌지 않는다.
 * 문구를 고치면 `llm/promptRegistry.ts` 의 SCAFFOLD_* 버전을 올린다. 규칙: docs/prompt_sets_scaffold_write_v1.md
 */
/**
 * Principles shared by every chain prompt.
 *
 * Each chain prompt has the same four parts - 역할 / 공통 원칙 / 작업 규칙 /
 * 출력 형식 - and its user prompt carries input data only. The principles are
 * defined once here so that every chain states them in identical words and a
 * chain lists exactly the ones that apply to its task.
 */
const PRINCIPLES = {
  P1: 'P1. 근거 범위: 입력으로 제공된 자료(EMR 근거, 섹션 초안, 질의응답)에 있는 내용만 사용합니다. 외부 의학 지식, 문헌, 일반 임상 상식으로 내용을 보충하지 않습니다.',
  P2: 'P2. 생성 금지: 입력에 없는 사실, 날짜, 수치, 진단명, 검사명, 약물·처방명, 치료 세부, 이상반응, 동의 여부를 만들지 않습니다. 불확실하면 쓰지 않습니다.',
  P3: 'P3. 기록 부재: 기록이 없다는 것은 없었다는 근거가 아닙니다. 입력에 명시되어 있지 않으면 이상반응, 합병증, 과거력 등이 "없었다" 또는 "보고되지 않았다"고 쓰지 않습니다.',
  P4: 'P4. 잠정 표현 유지: "r/o", "의심", "가능성"으로 기록된 진단이나 판단을 확정된 것으로 바꾸지 않습니다.',
  P5: 'P5. 효과·인과 주장 금지: 치료 기간 중의 변화는 관찰된 경과로만 기술합니다(예: "치료 기간 중 ~의 빈도가 감소하였다"). 치료가 변화를 일으켰다거나 효과적이었다고 쓰거나 암시하지 않습니다. 환자나 의료진이 그렇게 말한 내용은 그 사람의 진술로 표기합니다.',
  P6: 'P6. 비식별 표기 유지: [PATIENT_NAME_1]과 같은 비식별 표기는 입력에 있는 그대로 둡니다.',
  P7: 'P7. 출력: 지정된 JSON 객체 하나만 반환합니다. 사람이 읽는 문장은 모두 한국어로 씁니다.'
} as const;

export type PrincipleId = keyof typeof PRINCIPLES;

export function sharedPrinciples(ids: PrincipleId[]): string {
  return ['공통 원칙:', ...ids.map((id) => `- ${PRINCIPLES[id]}`)].join('\n');
}

/** How a drafting chain must treat the CARE rubric it receives as input. */
export const RUBRIC_HANDLING = `루브릭 사용 원칙:
- CARE 루브릭은 완성된 보고서가 갖출 요소의 점검표이며, 빈 항목을 채우라는 지시가 아닙니다.
- 필수 항목이라도 근거가 없으면 본문에 쓰지 않습니다.
- 근거가 부족해 섹션이 짧아지는 것은 올바른 결과입니다.`;

/** Manuscript style shared by the chains that write section text. */
export const MANUSCRIPT_STYLE = `문체 원칙:
- 학술 증례보고 문체의 자연스러운 한국어 서술형 문단으로 씁니다. 메모, 체크리스트, 표 형태로 쓰지 않습니다.
- JSON 키, 근거 id, 섹션 id 같은 내부 표기를 본문에 넣지 않습니다.
- 교과서식 일반론이나 상투적인 문장으로 분량을 채우지 않습니다.
- 정규화된 용어가 제공되면 그 표기를 따르고, 같은 용어는 모든 섹션에서 같은 형태로 씁니다.
- 가져온 타임라인 표의 행("날짜 | 방문 | ...")이나 방문별 기록을 그대로 옮기지 않습니다. 수치는 의미 있는 변화를 보여줄 때만 선별해 씁니다.`;
