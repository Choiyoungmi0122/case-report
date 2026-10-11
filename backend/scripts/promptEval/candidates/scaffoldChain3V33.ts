/**
 * Scaffold CHAIN3 v3.3 후보 규칙 (2026-10-12, 평가용. 서비스에 연결되지 않음).
 *
 * 섹션별 생성(치료 개입만) 평가에서 늘어난 오류를 막는 일반 규칙. 서비스 프롬프트(v3)를 만든 뒤 작업 규칙 10 뒤에 끼운다.
 *  - 본문에 "~은 기록되어 있지 않다", "~은 확인되지 않는다"를 씀 (교수 기록에서 매번) → 금지, openIssues 로
 *  - 단위가 없는 약재 양에 g 을 붙임, "건부"를 "건열요법"으로 풀어 씀, "1cc*2"를 "총 2cc"로 계산 → 기록 표기 그대로
 *  - "이상의 치료는 … 적용되었다" 같은 마무리 요약 문장 → 금지
 * 이 사례에만 맞춘 낱말은 넣지 않는다.
 */
export const SCAFFOLD_CHAIN3_V33_LABEL = 'SCAFFOLD-CHAIN3:v3.3-candidate';

const V33_RULES = `11. 없는 내용: 본문에는 무엇이 기록되지 않았는지, 무엇이 확인되지 않는지 쓰지 않습니다. 근거가 없는 세부는 본문에서 빼고, 필수 항목이면 openIssues에 항목 이름으로 적습니다.
12. 표기 보존: 수치, 단위, 약어, 처방·처치 이름은 근거에 적힌 그대로 씁니다. 단위가 적히지 않은 수치에 단위를 붙이지 않고, 뜻이 근거에 나오지 않는 약어나 줄임말을 풀어 쓰지 않으며, 합계나 횟수를 계산해 근거에 없는 수치를 만들지 않습니다.
13. 마무리 문장 금지: 섹션 끝에 앞의 내용을 요약하거나 일반화하는 문장(예: 치료가 반복되었다, 상태에 따라 조정되었다)을 덧붙이지 않습니다.
`;

/** v3 시스템 프롬프트에 v3.3 규칙을 끼운다(규칙 11 → 14 로 번호를 민다). */
export function applyScaffoldChain3V33(prompt: string): string {
  const anchor = '11. evidenceCardIdsUsed에는';
  if (!prompt.includes(anchor)) throw new Error('v3 prompt anchor not found');
  return prompt.replace(anchor, `${V33_RULES}14. evidenceCardIdsUsed에는`);
}
