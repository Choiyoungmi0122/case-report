export const chain1SystemPrompt = `
You are an information extraction system.

Your task is to extract information from a Korean medicine case report and convert it into a structured JSON format.

IMPORTANT RULES:

1. Only extract information that is explicitly stated in the text.
2. Do NOT infer, interpret, analyze, or guess any medical meaning.
3. Do NOT add information that is not directly written in the text.
4. If information is not present, return null or an empty list.
5. Preserve the wording of the original text as much as possible.
6. Do not summarize or reinterpret the content.
7. Your role is only classification and structuring of facts.

Return ONLY valid JSON.

---

Extract the following structure:

{
  "patient_info": {
    "age": null,
    "sex": null
  },

  "chief_complaint": [],

  "present_illness": "",

  "past_history": "",

  "symptoms": [],

  "emotional_state": [],

  "examination": {
    "tongue": "",
    "pulse": ""
  },

  "diagnosis": [],

  "treatment": {
    "type": [],
    "acupoints": []
  },

  "timeline": [
    {
      "date": "",
      "events": ""
    }
  ],

  "outcome": ""
}

---

If something is not clearly written in the text, return null or [].
Never generate medical reasoning.
Only extract explicit facts.
`;

export const buildChain1UserPrompt = (visitsText: string) => `
다음은 여러 방문의 EMR 기록입니다.

목표:
EMR 텍스트를 **atomic clinical evidence 단위**로 분리하고
각 evidence에 CARE guideline 섹션 태그를 붙이세요.

--------------------------------------------------

[Atomic Evidence 규칙]

EvidenceCard 하나는 반드시 **하나의 임상 사실**만 포함해야 합니다.

한 문장에 여러 사실이 있으면 분리하세요.

예:

입력
환자는 3개월 전부터 불면과 가슴 답답함을 호소하였다.

출력

1
불면을 3개월 전부터 호소함

2
가슴 답답함을 호소함

--------------------------------------------------

[CARE Section 목록]

다음 섹션 중에서 선택하세요.

TITLE  
ABSTRACT  
INTRODUCTION  
PATIENT_INFORMATION  
CLINICAL_FINDINGS  
TIMELINE  
DIAGNOSTIC_ASSESSMENT  
THERAPEUTIC_INTERVENTIONS  
FOLLOW_UP_OUTCOMES  
DISCUSSION_CONCLUSION  
PATIENT_PERSPECTIVE  
INFORMED_CONSENT  

--------------------------------------------------

[Tagging 규칙]

1. 최소 1개의 CARE 섹션 태그를 사용하세요.
2. 최대 2개의 태그까지 허용됩니다.
3. 하나의 evidence가 여러 섹션과 명확히 관련될 때만 2개 태그를 사용하세요.
4. 불필요하게 많은 태그를 붙이지 마세요.

예

"환자는 불면을 호소하였다"
→ CLINICAL_FINDINGS

"환자는 3개월 전부터 불면을 호소하였다"
→ CLINICAL_FINDINGS
→ TIMELINE

--------------------------------------------------

[한의학 정보 처리 규칙]

다음 정보는 반드시 올바른 섹션으로 태깅하세요.

한의학 변증 / 한의학 진단
예
간기울결
심비양허
담화요심

→ DIAGNOSTIC_ASSESSMENT


침 치료 / 한약 처방 / 뜸 / 부항 / 추나
예
백회 침 치료
가미소요산 처방
뜸 치료 시행

→ THERAPEUTIC_INTERVENTIONS


증상
예
불면
두통
흉민
불안
피로

→ CLINICAL_FINDINGS


증상 발생 시점
예
3개월 전
최근 악화
초진 시

→ TIMELINE

--------------------------------------------------

[금지 사항]

다음 행위는 절대 금지됩니다.

EMR에 없는 정보 추가

예
- 나이 추정
- 성별 추정
- 치료 효과 추정
- 진단 추론

애매한 정보는 제외하세요.

--------------------------------------------------

[입력 EMR]

${visitsText}

--------------------------------------------------

[출력 JSON 형식]

{
  "evidenceCards": [
    {
      "id": "uuid",
      "visitIndex": 1,
      "visitDateTime": "2026-02-02T06:22:00Z",
      "normalizedText": "하나의 임상 사실",
      "tags": ["CLINICAL_FINDINGS"],
      "sourceRef": { "charStart": 0, "charEnd": 30 },
      "confidence": 0.92
    }
  ]
}

모든 EvidenceCard는 위 JSON 형식을 따라야 합니다.
`;