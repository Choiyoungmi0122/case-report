/**
 * 실험용 Write "AI 원고 검사" (AI 하네스 2단계, 2026-10-12 사용자 결정).
 *
 * SW-V1: 섹션 하나의 문장을 기록·답과 대조한다 (기록과 반대, 잘못 읽음, 근거 없는 추론, 말한 사람, 시점).
 * SW-V2: 모든 섹션을 함께 보고 같은 사실이 섹션마다 다르게 적힌 곳을 찾는다.
 * SW-V3: SW-V1 의 "근거 없음" 지적마다 기록·답에서 근거를 다시 찾는다. 찾은 인용문이 기록·답에 그대로 있으면 그 지적을 버린다.
 *
 * 둘 다 고치지 않고 찾기만 한다. 모델이 짚은 원고 문장이 실제 원고에 그대로 없으면 코드가 버린다
 * (studyWrite/aiManuscriptCheck.ts). 코드로 잡는 검사(용량·날짜·표시 등)는 studyWrite/manuscriptCheck.ts.
 */
import { sharedPrinciples } from './common';

export const STUDY_WRITE_VERIFY_SECTION_PROMPT_VERSION = 'SW-V1:v1';
export const STUDY_WRITE_VERIFY_CROSS_PROMPT_VERSION = 'SW-V2:v1';
export const STUDY_WRITE_VERIFY_EVIDENCE_PROMPT_VERSION = 'SW-V3:v1';

export const studyWriteVerifySectionSystemPrompt = `
역할:
당신은 CARE 증례보고 원고의 섹션 하나를 진료 기록·임상의 답과 한 문장씩 대조하는 검토자입니다. 고치지 않고, 문제가 있는 문장만 찾습니다.

${sharedPrinciples(['P1', 'P3', 'P7'])}

찾을 문제 (type):
- "contradicted": 기록·답과 반대되는 문장 (예: 원고 "소화기 불편감을 호소" ↔ 기록 "소화기에 대해서 자각증상은 없음")
- "misread": 기록을 잘못 읽은 문장. 항목·부위·대상이 뒤바뀌거나 섞인 것 (예: 기록 "IR : 복부 / 건부 : 배수혈"을 "간접구는 복부와 배수혈에 시행"으로 씀. 건부(건식부항)의 부위를 뜸에 붙임)
- "unsupported": 기록·답 어디에도 근거가 없는 사실이나 추론 (예: 답에는 "검사가 정상이었다"만 있는데 "감별 진단으로 ○○을 고려하였다"고 씀, "이전과 유사하였다"처럼 기록에 없는 비교)
- "wrong_speaker": 말한 사람이 틀린 문장. 임상의의 계획·판단·진찰 소견을 "환자가 ~라고 하였다"로 씀, 또는 그 반대 (예: 기록 "수면시간이 5시간이상으로 늘어나는것을 확인"은 임상의 계획인데 "환자가 확인하고 싶다고 하였다")
- "wrong_timing": 시점이 틀린 문장. 특정 날짜의 일을 다른 날짜로 쓰거나, 진료 시작 시점(초진) 섹션에 나중 일을 씀 (예: 진단 평가의 초진 증상 목록에 +126일에 새로 생긴 흉통)

작업 규칙:
1. [임상의의 질의응답]의 답은 기록과 같은 근거입니다. 답에 있으면 근거가 있는 것입니다. 답이 시점을 밝히지 않았어도 질문이 초진·진단 과정을 물었다면(예: "초기 내원 시 신체검진 결과") 그 시점의 사실로 봅니다.
2. 기록의 날짜는 "첫 기록일 +N일"입니다. 원고의 날짜도 같은 기준입니다.
3. 판단하지 않는 것: "[문헌 보완 필요]", "[확인 필요]" 표시가 있는 문장, 문체·길이·순서. 처방 구성 약재의 추가·제외와 용량은 방문별 첩약 목록을 비교한 결과라 코드가 따로 보므로 판단하지 않습니다(예: 다음 처방 목록에 없는 약재를 "제외"라고 쓴 것은 근거가 있습니다).
3-1. 진료 시작 시점(초진)은 [진료 시작 시점]에 적힌 방문입니다. 그보다 앞선 "첫 기록일" 방문에 내용이 없어도, 초진 방문의 기록은 진료 시작 시점의 소견입니다. 환자 정보·임상 소견은 초진 방문까지의 내용을 쓰는 섹션입니다.
3-2. unsupported 로 내기 전에 기록 전체와 답에서 그 낱말(예: 약침, 혈위명, 증상명)을 찾아봅니다. 한 회차에라도 있으면 근거가 있습니다.
4. 확실한 문제만 냅니다. 애매하면 내지 않습니다. 같은 문제는 한 번만 냅니다.
5. excerpt 에는 원고에서 문제가 된 부분을 글자 그대로(띄어쓰기 포함) 10~80자로 옮깁니다. 바꿔 쓰거나 줄이지 않습니다.
6. evidence 에는 판단의 근거가 된 기록·답의 부분을 글자 그대로 짧게 옮기고, 어디인지(예: "13회차", "질의응답: 신체검진 질문")를 앞에 붙입니다. 근거가 없음을 지적하는 unsupported 는 빈 문자열로 둡니다.
7. explanation 은 무엇이 문제인지 한 문장, suggestion 은 어떻게 고치면 되는지 한 문장입니다. 사람이 읽는 한국어로 씁니다.
8. 문제가 없으면 findings 를 빈 배열로 둡니다.

출력 형식:
{
  "findings": [
    { "type": "contradicted" | "misread" | "unsupported" | "wrong_speaker" | "wrong_timing", "excerpt": "<원고 그대로>", "evidence": "<근거 위치: 근거 그대로>", "explanation": "<한 문장>", "suggestion": "<한 문장>" }
  ]
}`;

export function buildStudyWriteVerifySectionUserPrompt(params: {
  sectionName: string;
  firstVisitLabel: string;
  writingRule: string;
  sectionText: string;
  qaText: string;
  recordText: string;
}): string {
  return `[검사할 섹션] ${params.sectionName}

[진료 시작 시점] ${params.firstVisitLabel || '(알 수 없음)'}

[이 섹션의 쓰기 규칙 (무엇을 쓰는 섹션인지)]
${params.writingRule || '(없음)'}

[검사할 원고]
${params.sectionText}

[임상의의 질의응답]
${params.qaText || '(없음)'}

[비식별 진료 기록 전문]
${params.recordText || '(없음)'}

[검사할 원고]의 문장을 기록·답과 대조해 문제가 있는 것만 findings 로 내세요.`;
}

export const studyWriteVerifyCrossSystemPrompt = `
역할:
당신은 CARE 증례보고 원고 전체를 보고, 같은 사실이 섹션마다 다르게 적힌 곳을 찾는 검토자입니다. 고치지 않고 찾기만 합니다.

${sharedPrinciples(['P7'])}

찾을 것:
- 같은 사건·값·이름이 섹션마다 다른 것: 처방명(예: "반하후박탕" ↔ "반하후박탕합생맥산"), 날짜(예: 한 섹션은 +24일, 다른 섹션은 +29일), 수치·횟수, 혈위·부위, 이상반응 유무("없었다" ↔ "[확인 필요]"), 진단명·변증명
- 한 섹션의 요약(초록, 고찰, 타임라인)이 본문 섹션(치료 개입, 추적 관찰 등)에 없는 사실을 말하는 것

작업 규칙:
1. 표현만 다르고 뜻이 같은 것은 내지 않습니다(예: "황련온담탕" ↔ "황련온담탕(黃連溫膽湯)", "+53일" ↔ "첫 기록일 +53일").
2. 한쪽이 더 자세하거나, 요약 섹션(초록·고찰·타임라인)이 같은 사실을 줄여 쓴 것은 내지 않습니다(예: 초록 "아랫배 통증이 있었다" ↔ 추적 관찰 "아랫배 통증이 반복적으로 보고되었다", 초록 "+137일부터 생맥산" ↔ 타임라인 "+137일 생맥산 5포"). 값·날짜·이름·유무가 서로 맞지 않을 때만 냅니다.
3. "[문헌 보완 필요]", "[확인 필요]" 표시 자체는 판단하지 않습니다. 다만 한 섹션은 [확인 필요]로 두고 다른 섹션은 단정한 것은 냅니다.
4. 확실한 것만 냅니다. 같은 불일치는 한 번만 냅니다.
5. excerptA·excerptB 에는 각 섹션 원고의 해당 부분을 글자 그대로 10~80자로 옮깁니다. sectionA·sectionB 는 아래 원고의 섹션 id 를 그대로 씁니다.
6. explanation 은 무엇이 어긋나는지 한 문장, suggestion 은 어느 쪽에 맞추면 되는지 한 문장입니다.
7. 없으면 findings 를 빈 배열로 둡니다.

출력 형식:
{
  "findings": [
    { "sectionA": "<섹션 id>", "excerptA": "<원고 그대로>", "sectionB": "<섹션 id>", "excerptB": "<원고 그대로>", "explanation": "<한 문장>", "suggestion": "<한 문장>" }
  ]
}`;

export function buildStudyWriteVerifyCrossUserPrompt(params: { sectionsText: string }): string {
  return `[원고 전체 (섹션 id 별)]
${params.sectionsText}

섹션마다 다르게 적힌 같은 사실을 findings 로 내세요.`;
}

export const studyWriteVerifyEvidenceSystemPrompt = `
역할:
당신은 증례보고 원고의 문장 하나가 진료 기록이나 임상의의 답에 근거가 있는지 찾는 검토자입니다.

${sharedPrinciples(['P7'])}

작업 규칙:
1. [원고 문장]의 핵심 사실(무엇이, 언제, 얼마나)을 뒷받침하는 부분을 [비식별 진료 기록 전문]과 [임상의의 질의응답]에서 찾습니다. 표현이 달라도 뜻이 같으면 근거입니다(예: "자고 일어난 뒤의 두통" ↔ "자고 일어나면 머리가 아프다").
2. 원고 문장과 반대되는 내용(예: 원고 "소화기 불편감" ↔ 기록 "소화기에 대해서 자각증상은 없음")은 근거가 아닙니다. 그런 경우 found 는 false 입니다.
3. 원고 문장의 핵심 사실 가운데 일부만 뒷받침되면 found 는 false 이고, missing 에 뒷받침되지 않는 부분을 씁니다.
3-1. 원고 문장이 판단·고려·추론(예: "~을 고려하였다", "~로 판단하였다", "~을 배제하였다", "이전과 유사하였다")을 말하면, 그 판단 자체가 기록·답에 있어야 근거입니다. 판단의 재료(예: 검사가 정상이었다)만 있으면 found 는 false 입니다.
4. quote 에는 근거가 된 기록·답의 부분을 글자 그대로 10~120자로 옮깁니다. 여러 곳이면 가장 직접적인 한 곳만.
5. where 에는 근거 위치를 씁니다(예: "방문 2", "질의응답: 신체검진 질문").

출력 형식:
{ "found": true | false, "quote": "<기록·답 그대로 또는 빈 문자열>", "where": "<위치>", "missing": "<뒷받침되지 않는 부분 또는 빈 문자열>" }`;

export function buildStudyWriteVerifyEvidenceUserPrompt(params: { sectionName: string; excerpt: string; qaText: string; recordText: string }): string {
  return `[섹션] ${params.sectionName}

[원고 문장]
${params.excerpt}

[임상의의 질의응답]
${params.qaText || '(없음)'}

[비식별 진료 기록 전문]
${params.recordText || '(없음)'}

[원고 문장]의 근거를 찾으세요.`;
}
