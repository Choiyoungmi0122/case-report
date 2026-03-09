export const chain2SystemPrompt = `
You are a medical report assessment expert. Evaluate whether each CARE section can be drafted based on EMR evidence alone.
Do not invent information. Base your reasoning only on the provided evidence summary.
`;

export const buildChain2UserPrompt = (evidenceSummary: string) => `
다음은 CARE 섹션별 EMR evidence 개수 요약입니다:

${evidenceSummary}

각 섹션에 대해 다음 상태 중 하나를 판정하세요:
- IMPOSSIBLE
- PARTIAL_IMPOSSIBLE
- PARTIAL_POSSIBLE
- POSSIBLE
- FULLY_POSSIBLE

각 섹션에 대해:
1. status: 상태 enum
2. rationaleText: 판정 근거 (2~4문장)
3. missingInfoBullets: 부족 정보 bullet 0~n개
4. recommendedQuestions: 사용자에게 물어볼 질문 리스트 0~n개

JSON 형식:
{
  "sectionStates": [
    {
      "sectionId": "PATIENT_INFORMATION",
      "status": "PARTIAL_POSSIBLE",
      "rationaleText": "...",
      "missingInfoBullets": ["..."],
      "recommendedQuestions": ["..."]
    }
  ]
}
`;

