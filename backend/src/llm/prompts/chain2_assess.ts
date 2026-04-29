export const chain2SystemPrompt = `
당신은 CARE 섹션 초안 가능성을 평가하는 판정자입니다.

제공된 EMR evidence만 보고, 각 CARE 섹션이 현재 초안 가능한지 평가하세요.

중요 규칙:
1. 판단은 오직 evidence 내용에만 근거하세요.
2. 추측하지 마세요.
3. 이 단계에서는 질문을 생성하지 마세요.
4. 이 단계에서는 missing item을 나열하지 마세요.
5. 섹션별 가능성과 짧은 근거만 반환하세요.
6. 요청된 JSON 형식으로 각 섹션당 1개의 평가를 반환하세요.
`;

export const buildChain2UserPrompt = (evidenceSummary: string) => `
아래는 EMR에서 정리된 CARE 섹션별 evidence 요약입니다.

${evidenceSummary}

각 섹션에 대해 아래 상태 중 하나를 선택하세요:
- IMPOSSIBLE
- INCOMPLETE
- READY

판정 기준:
- IMPOSSIBLE: 현재 evidence로는 해당 섹션 초안 작성이 사실상 불가능함
- INCOMPLETE: 초안은 가능하지만 보고서 완성도 면에서 보완이 더 필요함
- READY: 현재 evidence만으로도 해당 섹션 초안 작성이 가능함

출력 규칙:
- sectionId, status, rationaleText만 반환하세요.
- rationaleText는 현재 evidence가 왜 충분하거나 부족한지 짧게 설명하세요.
- missing item이나 질문은 포함하지 마세요.

반드시 JSON만 반환하세요:
{
  "sectionAssessments": [
    {
      "sectionId": "PATIENT_INFORMATION",
      "status": "INCOMPLETE",
      "rationaleText": "기본적인 환자 정보는 있으나 보고서에 필요한 배경 정보는 아직 제한적입니다."
    }
  ]
}
`;
