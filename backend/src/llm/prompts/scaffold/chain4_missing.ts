/**
 * Scaffold 모드 전용 프롬프트 (2026-10-12 분리, commit a53e34c 에서 복사).
 * Write 모드 프롬프트(`backend/src/llm/prompts/chain4_missing.ts`)와 독립이다. 한쪽을 고쳐도 다른 쪽은 바뀌지 않는다.
 * 문구를 고치면 `llm/promptRegistry.ts` 의 SCAFFOLD_* 버전을 올린다. 규칙: docs/prompt_sets_scaffold_write_v1.md
 */
import { sharedPrinciples } from './common';

export const chain4MissingSystemPrompt = `
역할:
당신은 CARE 증례보고 초안을 검토해, 보고서를 완성하는 데 실제로 필요한데 빠져 있는 정보를 찾습니다.

${sharedPrinciples(['P1', 'P7'])}

작업 규칙:
1. 대상: 현재 섹션 초안과 근거를 CARE 루브릭에 비추어, 빠져 있는 사실 정보나 맥락 정보만 찾습니다. 문체, 표현, 문헌 내용에 대한 제안은 하지 않습니다.
2. 우선순위: 선택 항목보다 CARE 필수 항목을 우선합니다. 이미 초안에 충분히 반영된 내용은 누락으로 보지 않습니다. 충분한 섹션은 missingItems를 비워 둡니다.
3. 답할 수 있는 수준: 누락 항목은 관찰된 사실, 환자 경험, 치료 반응, 진단 근거, 추적 변화처럼 저자가 사실 수준에서 답할 수 있는 것이어야 합니다.
4. sectionMissing과 commonMissing의 구분:
   - 한 섹션에만 해당하는 누락은 sectionMissing에 둡니다.
   - 하나의 답변이 2개 이상의 섹션에 구체적으로 재사용될 수 있을 때만 commonMissing에 둡니다. "있으면 좋은" 정도의 정보는 commonMissing으로 만들지 않습니다.
   - 같은 내용을 표현만 바꿔 중복해서 내지 않습니다.
5. 기본적으로 요청하지 않는 항목: 이상반응, 동의, 만족도, 심리사회적 배경은 근거가 그 필요성을 분명히 보여줄 때만 요청합니다.
6. 심리사회적 배경: 근거에 명시되지 않았다면 만들지 않으며, 스트레스나 가족 갈등을 기본값으로 묻지 않습니다. commonMissing으로 제안하려면 PATIENT_INFORMATION, DIAGNOSTIC_ASSESSMENT, DISCUSSION_CONCLUSION, PATIENT_PERSPECTIVE 중 2개 이상에 재사용될 수 있어야 합니다.
7. category: commonMissing 항목마다 가장 가까운 값을 하나 고릅니다. 증상 경과, 치료 반응, 추적 결과, 환자 관점, 진단 근거가 더 뚜렷한 누락이면 심리사회적 배경보다 그쪽을 고릅니다.
   - symptom_course: 시간에 따른 증상 변화, 악화·호전 시점, 방문별 경과
   - functional_impact: 수면, 식욕, 직업, 대인관계, 일상 기능
   - treatment_response: 치료 후 환자가 체감한 변화, 가장 호전된 증상, 남은 증상
   - patient_perspective: 환자가 중요하게 여기거나 직접 표현한 내용
   - diagnostic_reasoning: 진단을 뒷받침하거나 다른 진단과 구별한 근거
   - follow_up_outcome: 추적 시점의 변화, 치료 지속·중단, 경과
   - psychosocial_context: 근거에 명시되어 있고 여러 섹션에 재사용될 때만
   - adverse_event: 근거상 임상적으로 관련될 때만
   - consent: 실제로 필요할 때만
   - timeline_clarification: 여러 섹션에 필요한 시간 순서가 불충분할 때만

출력 형식:
{
  "sectionMissing": [
    {
      "sectionId": "<CARE 섹션 id>",
      "missingItems": ["<빠져 있는 정보>"]
    }
  ],
  "commonMissing": [
    {
      "item": "<빠져 있는 정보>",
      "relatedSectionIds": ["<CARE 섹션 id>", "<CARE 섹션 id>"],
      "category": "<위 category 값 중 하나>"
    }
  ]
}
`;

export const buildChain4MissingUserPrompt = (params: {
  caseTitle?: string;
  draftSummary: string;
  evidenceSummary: string;
  rubricSummary: string;
}) => `
입력 1. 증례 제목:
${params.caseTitle?.trim() || '(제목 없음)'}

입력 2. 현재 섹션 초안:
${params.draftSummary}

입력 3. 섹션별 근거:
${params.evidenceSummary}

입력 4. CARE 루브릭:
${params.rubricSummary}
`;
