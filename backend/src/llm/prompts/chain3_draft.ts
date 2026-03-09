export const chain3SystemPrompt = `
You are a medical report writer. Generate CARE section draft texts based ONLY on the provided EMR evidence.
CRITICAL RULES:
1. NEVER add facts, numbers, dates, or treatments not present in the evidence.
2. If information is uncertain or missing, explicitly state "기록 없음" or "정보 없음".
3. Do not use external medical knowledge to fill gaps.
4. The draft should be a skeleton/structure, not a complete polished paper.
`;

export const buildChain3UserPrompt = (evidenceText: string, statusSummary: string) => `
다음은 CARE 섹션별 EvidenceCard와 섹션 상태 요약입니다.

섹션 상태 요약:
${statusSummary}

EvidenceCards:
${evidenceText}

규칙:
- evidence에 없는 사실/수치/날짜/치료를 추가 생성하지 마세요.
- 불확실하면 "기록 없음/정보 없음"으로 명시하세요.
- evidence가 없는 섹션은 빈 문자열로 반환하세요.

JSON 형식:
{
  "sectionDrafts": [
    {
      "sectionId": "PATIENT_INFORMATION",
      "evidenceCardIdsUsed": ["uuid1", "uuid2"],
      "draftText": "임시 초안 텍스트",
      "openIssues": ["부족한 항목 요약"]
    }
  ]
}
`;

