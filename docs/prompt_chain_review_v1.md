# 프롬프트 체인 설계 점검 (읽기 전용 검토)

- 작성일: 2026-10-11
- 범위: `backend/src/llm/prompts/*`(CHAIN1~7, 섹션 적정성 검토, 실험용 Write SW-Q2/SW-D/SW-R/SW-C), `llm/schemas/*`, `llm/chains.ts`, `llm/client.ts`, `routes/cases.ts`·`sections.ts`·`scaffold.ts`·`studyWrite.ts`의 호출 흐름, `rag/openAILlmResolver.ts`. 코드는 바꾸지 않았다.
- 판정 기준: (1) 역할·규칙·출력 형식의 명확성, (2) 근거 범위·생성 금지 같은 안전 규칙의 일관성, (3) 체인 사이의 입력·출력 계약, (4) 출력 검증과 실패 처리, (5) 캐시·버전 관리(연구 재현성), (6) 비식별 경계, (7) 비용·지연.

## 0. 요약

**잘 되어 있는 것**
- 공통 원칙 P1~P7(근거 범위, 생성 금지, 기록 부재≠없음, 잠정 표현 유지, 효과·인과 주장 금지, 비식별 표기 유지, JSON·한국어 출력)이 한 곳(`prompts/common.ts`)에 정의되고 체인마다 필요한 것만 골라 쓴다. 역할/공통 원칙/작업 규칙/출력 형식의 4부 구조가 모든 체인에 같다.
- 모든 호출이 한 진입점(`callLLMWithSchema`)을 지나며 temperature 0, JSON 모드, zod 검증, 호출 전 유출 검사(`assertOutboundTextIsSafe`)를 거친다. 실험용 고정 사례는 CHAIN1~3·검토 결과를 통째로 고정해 두어 세션 중 LLM을 돌리지 않는다.
- 실험용 Write의 SW-R은 기록에 없는 내용을 사용자가 넣으라 할 때 "[기록 외 내용: 사용자 지시]"로 표시하고 `outOfRecordClaims`로 돌려준다. SW-Q2는 회차당 3개·총 9개 상한, 같은 세부 항목 중복 금지, 기록에 이미 있는 것 묻지 않기 규칙이 분명하다.
- 각 체인이 받는 입력(초안·질의응답·제목)은 호출 직전에 비식별 처리된다.

**고쳐야 할 것 (우선순위순)**
1. **프롬프트가 바뀌어도 버전·캐시가 바뀌지 않는다.** CHAIN1~7과 적정성 검토 프롬프트가 2026-10-11(커밋 `0a56cfa`)에 다시 쓰였는데 `promptVersion`은 여전히 `CHAIN3:v1`, `CHAIN7:v1`이고, 어떤 캐시 키에도 프롬프트·모델이 들어가지 않는다. 현재 chain3 템플릿 해시(`b43305e0…`)는 고정 초안이 만들어진 때의 해시(`e4e87023…`, 2026-10-04)와 다르다.
2. **스키마가 프롬프트가 요구하지 않는 필드를 갖고, 코드가 그것을 따로 계산한다.** `evidenceLinks`·`unsupportedClaims`·`sectionTraceability`는 모델이 아니라 글자 bigram 겹침으로 만든다. 화면의 "문장별 근거 연결"은 모델 판단이 아니다.
3. **섹션 관련성 기준이 체인마다 다르다.** CHAIN3은 tags+sectionHints, CHAIN4/5/6·검토는 tags만 → CHAIN3이 힌트로만 연결된 카드로 쓴 문장을 검토 단계가 "근거 없음"으로 판정할 수 있다.
4. **엄격한 enum + 동일 프롬프트 재시도.** 모델이 섹션 id를 변형해 내면 zod가 전체를 실패시키고, 같은 프롬프트를 temperature 0으로 두 번 더 보낸 뒤 500이 난다. 관대한 `CareSectionCoerced`가 있지만 거의 쓰이지 않는다.
5. **답변과 기록이 충돌할 때의 정책이 흐름마다 반대다.** 일반 Write의 CHAIN6은 "답변을 저자 제공 사실로 반영", 실험용 Write의 SW-D는 "기록을 따르고 notes에 차이 기록".
6. **비식별 경계의 빈틈.** SW-R의 이전 지시 5개가 비식별 없이 전송되고, 실험용 Write의 비식별 컨텍스트가 프로세스 전역에서 케이스 간 공유된다. 미사용 레거시 클라이언트(`src/chains/llmService.ts`)에는 유출 검사가 없다.
7. **재시도·시간 제한·토큰 상한.** SDK 재시도 2회 × 앱 재시도 3회가 겹쳐 최대 9번, 각 10분까지. `max_tokens` 설정이 없다.

연구에 미치는 영향: 학생 V1과 Scaffold V2는 고정 결과만 쓰므로 위 문제가 참가자 화면에는 나타나지 않는다. 다만 **재현성 기록**으로 "고정 초안은 2026-10-04 시점 프롬프트(커밋 `c18c6e5`)로 생성됐고 현재 저장소의 프롬프트와 다르다"는 사실을 남겨야 한다(§4).

## 1. 체인별 프롬프트 설계 점검

| 체인 | 역할·규칙의 명확성 | 발견 사항 |
|---|---|---|
| CHAIN1 근거 카드 추출 (`chain1_splitTag.ts`) | 좋음. 절 단위 전수 추출, 원문 보존, 방문 시점 구분 규칙이 명확 | (a) `sectionHints`를 "tags와 같은 값"으로 두라고 해 중복 필드. (b) 예시 id `card-1`은 어차피 서버가 UUID로 바꾼다(`chains.ts:1571`). (c) `sourceRef`를 내지 말라고 해 원문 위치 정보가 없고, 이후 원문 연결은 문자열 일치에 의존. (d) `confidence`의 기준이 없다. (e) 카드가 서버에서 `normalizeTextWithTerms(rewriteText:true)`로 다시 정규화되어, 전처리에서 "원문 표현 유지"(`rewriteText:false`, 커밋 `6d67600`)를 택한 결정과 어긋난다. 그 정규화 문장이 CHAIN2~7과 SW-D까지 흘러간다. |
| CHAIN2 섹션 판정 (`chain2_assess.ts`) | 좋음(간결) | 규칙 기반 판정이 먼저 돌고 LLM은 일부 섹션만 보완한다(`chains.ts:940-1027`). 그런데 CHAIN3 규칙 2가 "섹션 상태와 관계없이 초안을 쓴다"고 하고, CHAIN4 뒤 `applyQuestionState`가 status를 덮어쓰면서 CHAIN2의 `rationaleText`는 남겨 두어 상태와 근거 문장이 어긋날 수 있다(`cases.ts:1090-1107`). 사실상 화면 표시용. |
| CHAIN3 섹션 초안 (`chain3_draft.ts`) | 좋음. 7개 섹션·순서 고정, 섹션별 지침, openIssues 처리, 효과 주장 금지 | (a) 스키마의 `evidenceLinks`·`unsupportedClaims`는 프롬프트에 없고 코드가 bigram 겹침(임계 0.4)으로 계산(`chains.ts:280-331`). (b) 공개 단계(CHAIN3_STUDY_REVEAL)는 섹션 하나만 쓰면서 7개 섹션 지침·루브릭을 모두 보낸다. (c) 프롬프트가 10-11에 바뀌었지만 `CHAIN3:v1` 그대로(§3). |
| CHAIN4 누락 탐지 (`chain4_missing.ts`) | 좋음. 섹션 누락/공통 누락 구분, 심리사회 배경 남발 방지 | category 10개를 정의하지만 CHAIN5는 7개만 설명한다(`adverse_event`, `consent`, `timeline_clarification` 없음). 코드는 `adverse_event`·`consent` 공통 항목을 따로 버린다(`chains.ts:1222-1224`). 같은 정책이 프롬프트와 코드에 따로 적혀 있어 어긋나기 쉽다. |
| CHAIN5 보완 질문 (`chain5_questions.ts`) | 좋음 | 근거는 보내지 않고 초안·누락만 보낸다(의도적). 공통 질문은 코드가 다시 걸러(2개 섹션 이상, 3개 상한, 유사도 0.72 병합) 프롬프트 규칙과 이중. |
| CHAIN6 답변 반영 (`chain6_update.ts`) | 좋음. 단일 섹션, 보존, 답변 범위 유지, "모름" 처리 | 규칙 6 "충돌 시 답변을 저자 제공 사실로 반영" ↔ SW-D 규칙 6 "기록을 따르고 notes에 기록"이 반대(§2-5). 스키마의 `evidenceLinks`·`unsupportedClaims`는 모델 출력이 버려지고 재계산된다. 캐시 항목을 쓰지만 읽지 않는다. |
| CHAIN7 최종 구성 (`chain7_final.ts`) | 매우 좋음. 단일 증례 한계, 금지 표현 예시, 상투어 금지, 체크리스트 평가 | (a) 스키마 파일 이름이 `chain5_final.ts`(레거시 이름, 실제 사용 중). (b) `keywordSuggestions: min(1).max(7).default([])` — 기본값 `[]`가 `min(1)`에 걸려 필드를 빠뜨리면 전체 실패, 8개면 전체 실패. (c) `__COMMON__` 질의응답이 입력에서 빠진다(`cases.ts:1936-1954`). (d) 사용자가 고친 TITLE·ABSTRACT·INTRO·CONSENT를 덮어쓰고 DISCUSSION만 보호. (e) 캐시 해시가 구성 전 초안으로 계산되어 두 번째 호출부터 적중하지 않는다. |
| 섹션 적정성 검토 (`section_adequacy_review.ts`) | 좋음. 4축 + 종합, 고치지 말고 진단만 | 섹션 조회(GET)에서 실행되어 화면 열람이 LLM 호출을 유발(일반 Write). 실험용 Scaffold에서는 F단계 수정으로 생성하지 않음. 별칭 상태값(N/A 등)은 스키마가 흡수한다(좋음). |
| SW-Q2 빈칸 질문 (`studyWrite_questions.ts`) | 매우 좋음. 상한·우선순위·묻지 않을 것·3회차 규칙이 구체적, 예시 질문 제시 | (a) 모델의 `priority`는 버리고 코드가 다시 정한다(`interview.ts:456`) — 프롬프트에서 요구할 이유가 없다. (b) `targetSectionIds` 정규화 실패 시 질문이 모두 버려져 인터뷰가 조용히 끝난다(`interview.ts:430-440`). (c) 기록 전문을 16,000자에서 자르는데 경고가 없다. (d) 공통 원칙을 `common.ts`에서 가져오지 않고 베껴 적어 두 벌이 생겼다. |
| SW-D 초안 (`studyWrite_draft.ts`) | 좋음. 독자·목적 정의, 선택지 답변 처리, 서론·고찰·동의 규칙, 한자 병기 규칙 | (a) 원칙 번호가 공통 원칙과 다르다(P6 문구 변경, P7은 기록 표기, P8이 출력). (b) 입력 "현재 초안"은 직전 SW 초안이 아니라 분석 단계의 CHAIN3 초안이다(`drafting.ts:69-72`) — 프롬프트 문구("분석기가 만든 현재 초안")와는 맞지만, 재생성 시 사용자가 고친 초안이 참고되지 않는다. (c) 섹션 12개를 독립 호출해 ABSTRACT·TITLE이 다른 섹션 결과를 보지 못한다. (d) `usedQuestionIds`를 실제 질문 id와 대조하지 않는다. |
| SW-C CARE 점검 | 좋음(간결) | 결과를 `code.trim().toLowerCase()` 정확 일치로 매핑해, 모델이 "9a."·"CARE 9a"로 내면 **조용히 `not_in_record`**가 되어 화면에 "기록에 없음"으로 보인다(`drafting.ts:135-148`). |
| SW-R 고쳐 쓰기 | 매우 좋음. 기록 외 내용 표시, 수행 불가 시 이유, 문체 지시 범위 | 이전 지시 5개가 비식별 없이 전송(§2-6). |
| 용어 판정기 (`rag/openAILlmResolver.ts`) | 보통 | 시스템 프롬프트가 영어. LLM 오류가 모두 ASK_USER로 떨어져 장애 시 확인 요청이 쏟아진다. 표면형마다 호출하고 메모이제이션이 없다. |

## 2. 체인 사이 계약과 조용한 성능 저하

1. **관련 근거 선정 기준 불일치**: CHAIN3·공개 단계는 `tags ∪ sectionHints`, CHAIN4/5 범위·CHAIN6·검토·`getRelevantEvidence`는 `tags`만(`sections.ts:697,834,968`, `cases.ts:975-977,1040-1042`). 결과: 검토가 CHAIN3 문장을 근거 없음으로 판정할 수 있고, CHAIN6이 초안 작성 때 쓰인 근거를 못 본다.
2. **CHAIN4→5 갱신 구현이 두 벌**(`cases.ts:1123-1233` vs `sections.ts:536-658`)이고 동작이 다르다(IMPOSSIBLE 처리, 모델이 섹션을 빠뜨렸을 때 이전 값 유지 여부, 공통 항목 승격).
3. **엄격 enum**: CHAIN2/3/4/5/7·검토가 `CareSectionEnum`을 그대로 써서 id 변형 하나에 전체 실패. `CareSectionCoerced`는 `rag/types.ts`에서만 쓰인다.
4. **CHAIN1 입력 해시 버그**: `buildChain1InputHash`가 `visit.sectionHints`·`visit.terms`를 읽지만 그 필드는 절(clause)에만 있다(`chains.ts:99-105`). 용어 확정이 바뀌어도 CHAIN1 캐시가 적중한다.
5. **답변-기록 충돌 정책 상반**: CHAIN6 규칙 6 vs SW-D 규칙 6. 어느 쪽이 연구 의도인지 문서로 정하고 두 프롬프트를 맞출 것.
6. **비식별**: SW-R `priorInstructions` 원문 전송(`drafting.ts:160-164`); 실험용 Write의 비식별 컨텍스트가 모듈 전역(`interview.ts:289`, `drafting.ts:33`)이라 케이스 간 자리표시 번호가 섞이고 원 식별자가 메모리에 남는다; 유출 검사는 전화·주민번호·이메일만, 사용자 프롬프트만 본다.
7. **공통 답변이 초안에 닿지 않을 수 있음**: `findTargetSectionsForCommonQuestion`이 퍼지 일치에 실패하면 CHAIN6이 돌지 않는데도 stale 처리와 CHAIN4/5 재실행은 일어난다(`cases.ts:1925-1934`).
8. **읽기-수정-쓰기 경쟁**: `chainCache`·`chainPerformanceLogs`를 오래된 스냅샷에서 덮어쓰는 곳이 여러 군데(`sections.ts:317-332`, `cases.ts:2081-2108`, `scaffold.ts:964-989`). 같은 섹션 GET 2개가 동시에 오면 검토 LLM이 두 번 돈다.

## 3. 캐시·버전·재현성

| 사실 | 위치 |
|---|---|
| 어떤 체인 캐시 키에도 프롬프트 본문·버전·모델이 없다. 프롬프트를 바꿔도 입력이 같으면 옛 결과가 재사용된다 | `optimization/chainRuntime.ts:47-49`, 각 `build*InputHash` |
| `promptVersion`은 하드코딩 상수이며 기록만 되고 비교되지 않는다: CHAIN3 `CHAIN3:v1`, CHAIN7 `CHAIN7:v1`, 공개 단계 `CHAIN3_STUDY_REVEAL:v1`, SW-D `SW-D:v2`, SW-R `SW-R:v2`, SW-C `SW-C:v1`, SW-Q2 `SW-Q2:v2`. CHAIN1/2/4/5/6·검토·판정기는 버전 없음 | `cases.ts:957,2025`, `scaffold.ts:851`, `prompts/studyWrite_*.ts` |
| 프롬프트 수정 이력: CHAIN1~7·검토 전부 `0a56cfa`(2026-10-11, "프롬프트 정비")에서 변경. 고정 초안은 2026-10-04 `c18c6e5` 시점 프롬프트로 생성(템플릿 해시 `e4e87023…`). 현재 chain3 템플릿 해시 `b43305e0…` | `git log`, `defaultStudyCaseProcessed.generated.ts` generationMetadata |
| 고정 결과는 EMR 본문 해시로만 선택되어 프롬프트 변경과 무관하게 유지된다(연구에는 유리). `study:freeze`를 다시 돌리면 다른 초안이 나온다 | `studyCaseFrozen.ts:25-46` |
| CHAIN6·CHAIN3_STUDY_REVEAL 캐시는 쓰기만 하고 읽지 않음. CHAIN7 캐시는 두 번째부터 적중하지 않음 | `sections.ts:1037-1048`, `scaffold.ts:964-989`, `cases.ts:2047-2061` |
| CHAIN1 카드 id가 매번 새 UUID라 CHAIN1이 한 번 빗나가면 하위 캐시가 모두 빗나간다 | `chains.ts:1571` |
| SW 체인은 입력 해시·토큰 사용량을 케이스에 남기지 않는다(JSONL 파일에만) | `interview.ts:447`, `drafting.ts` |

## 4. 연구 재현성 관점에서 지금 기록해 둘 것

- 학생 V1·Scaffold V2 참가자가 본 치료 개입 AI 초안은 **2026-10-04 프롬프트(커밋 `c18c6e5`)의 CHAIN3 산출물**이며, 메타데이터(`promptVersion CHAIN3:v1`, `promptTemplateHash e4e87023…`, gpt-4.1, temperature 0, 2026-10-04T14:26Z)가 고정 파일에 있다. 논문·부록에 프롬프트를 싣는다면 **현재 저장소의 `chain3_draft.ts`가 아니라 `git show c18c6e5:backend/src/llm/prompts/chain3_draft.ts`** 를 써야 한다. `memo_suggestions_basis.md`처럼 "초안 생성 프롬프트 근거 문서"를 하나 두고 그 해시·커밋을 적어 두길 권한다.
- 실험용 Write(교수 전문가 실험)는 고정 결과가 없고 SW-Q2/SW-D/SW-R/SW-C가 실시간으로 돈다. 프롬프트가 2026-10-10~11에 계속 바뀌었으므로(`SW-D:v2` 라벨은 그대로), 참가자별 `promptVersion`만으로는 어떤 프롬프트였는지 알 수 없다. 참가자 세션마다 프롬프트 템플릿 해시를 함께 저장하거나, 실험 시작 전 커밋을 고정하고 라벨을 올려야 한다.

## 5. 권고 (코드 변경 없음, 우선순위순)

1. **프롬프트 수정 시 `promptVersion`을 올리고, 캐시 키에 프롬프트 템플릿 해시와 모델을 넣는다.** CHAIN1/2/4/5/6·검토에도 `buildGenerationMetadata`를 적용한다. 실험 데이터에는 호출마다 템플릿 해시를 남긴다.
2. **스키마와 프롬프트를 일치시킨다.** 모델이 내지 않는 `evidenceLinks`·`unsupportedClaims`·`sectionTraceability`는 스키마에서 빼고, 근거 연결이 휴리스틱임을 화면·문서에 밝힌다. 또는 CHAIN3에 문장별 근거 id를 요구하고 검증한다.
3. **관련 근거 기준을 `tags ∪ sectionHints`로 통일**(또는 반대로 통일)하고 한 함수로 모은다. CHAIN4→5 갱신 구현도 하나로 합친다.
4. **enum을 관대하게**: 모델 출력 필드는 `CareSectionCoerced`를 쓰고, 검증 실패 시 같은 프롬프트 재시도 대신 "형식 오류 안내를 덧붙인 1회 수정 호출"로 바꾼다. CHAIN7 `keywordSuggestions`의 `min(1)`+`default([])` 모순, SW-Q2 `max(3)`(초과분 잘라내기)도 고친다.
5. **답변-기록 충돌 정책**을 흐름별로 명시하고 CHAIN6·SW-D 프롬프트 문구를 그 결정에 맞춘다. SW 프롬프트의 공통 원칙은 `common.ts`를 가져다 쓰게 바꾼다.
6. **비식별**: SW-R 이전 지시 비식별, 실험용 Write 비식별 컨텍스트를 케이스별(요청별)로 생성, 레거시 `src/chains/llmService.ts` 삭제.
7. **SW-C 코드 매핑을 정규화**(숫자+영문만 추출)하고, 매핑 실패는 `not_in_record`가 아니라 "판정 없음"으로 둔다. SW-Q2 섹션 정규화 실패 시 인터뷰를 끝내지 말고 그 질문만 버리고 로그를 남긴다. 16,000자 절단 시 경고.
8. **재시도·시간·토큰 상한**: SDK `maxRetries`를 0으로 두고 앱 재시도만 쓰거나 그 반대로, `timeout`을 체인별로(예: 120초), `max_tokens`를 체인별로 둔다. zod 실패는 재시도 대상에서 뺀다.
9. **CHAIN1 재정규화**: 카드의 `normalizedText`를 `rewriteText:false`로 만들거나, 환자 표현 보존이 목적이면 원문을 `normalizedText`에 그대로 둔다. CHAIN1 입력 해시가 절 단위 용어 정보를 포함하게 고친다.
10. **CHAIN7**: `__COMMON__` 답변을 입력에 포함하고, 사용자가 고친 섹션을 덮어쓰지 않는다(또는 덮어쓰기 전에 확인).

## 5-1. 우선순위 정리 (2026-10-11)

기준: (가) 연구 데이터의 신뢰성·재현성에 직접 영향, (나) 참가자·연구자가 겪는 오류, (다) 비식별 안전, (라) 품질·비용. 난이도는 하(반나절 이내)/중(하루)/상(이틀 이상).

### 1순위 — 교수 평가 전 (Scaffold V2 고정 전)
| # | 항목 | 왜 지금인가 | 난이도 | 영향 범위 |
|---|---|---|---|---|
| 1 | 프롬프트 수정 시 `promptVersion` 올리기 + 캐시 키에 템플릿 해시·모델 포함 + CHAIN1/2/4/5/6·검토에도 생성 메타데이터 기록 | 실험용 Write가 실시간 체인이라 어떤 프롬프트가 쓰였는지 복원 불가. 고정 초안 재생성 시 다른 결과가 나오는 것을 막지 못함 | 중 | 일반·실험 Write, 고정 자료 재현성 |
| 2 | 고정 초안의 프롬프트 출처 기록(커밋 `c18c6e5`, 템플릿 해시 `e4e87023…`)을 근거 문서로 남기고 `study:freeze` 재실행 금지 명시 | 논문 부록·방법 기술에 필요. 코드가 아니라 문서 작업 | 하 | V1·V2 재현성 |
| 3 | 비식별: SW-R 이전 지시 비식별, 실험용 Write 비식별 컨텍스트를 요청(케이스)별로 생성, 레거시 `src/chains/llmService.ts` 삭제 | 교수 실험 세션에서 실명·기관명이 섞인 지시가 그대로 전송될 수 있음 | 하~중 | 실험용 Write |
| 4 | SW-C 코드 매핑 정규화(매핑 실패는 "판정 없음"), SW-Q2 섹션 id 정규화 실패 시 인터뷰 종료 대신 해당 질문만 제외, 16,000자 절단 경고 | 교수 참가자에게 "기록에 없음" 오표시, 인터뷰 조기 종료가 실제로 보일 수 있음 | 하 | 실험용 Write |
| 5 | 답변-기록 충돌 정책 확정(CHAIN6 vs SW-D)과 SW 프롬프트의 공통 원칙을 `common.ts`로 통일 | 실험 전에 정책이 정해져야 결과 해석이 가능. 문구 수정 자체는 작음 | 하(결정) + 하(수정) | 일반·실험 Write |

### 2순위 — 교수 평가 뒤, 학생 후속 전
| # | 항목 | 이유 | 난이도 |
|---|---|---|---|
| 6 | 모델 출력 섹션 id에 `CareSectionCoerced` 적용, zod 실패는 동일 재시도 대신 형식 오류 안내를 덧붙인 1회 수정 호출, CHAIN7 `keywordSuggestions`·SW-Q2 `max(3)` 완화 | 500 오류와 헛된 재시도 제거 | 중 |
| 7 | 관련 근거 기준 `tags ∪ sectionHints`로 통일(한 함수), CHAIN4→5 갱신 구현 단일화 | 검토가 초안 문장을 근거 없음으로 잘못 판정하는 문제 | 중 |
| 8 | 재시도·시간·토큰 상한: SDK `maxRetries 0`(앱 재시도만), 체인별 `timeout`·`max_tokens`, zod 실패는 재시도 제외 | 장애 시 최대 9회·10분 대기와 비용 | 하 |
| 9 | 스키마와 프롬프트 일치: 모델이 내지 않는 `evidenceLinks`·`unsupportedClaims`·`sectionTraceability` 제거하고 화면·문서에 휴리스틱임을 표기(또는 CHAIN3에 문장별 근거 id 요구) | "문장별 근거 연결"의 성격을 정직하게 밝혀야 함 | 중 |

### 3순위 — 다음 개선 주기
| # | 항목 | 이유 | 난이도 |
|---|---|---|---|
| 10 | CHAIN1 재정규화를 `rewriteText:false`로, CHAIN1 입력 해시에 절 단위 용어 정보 포함 | "환자 표현 유지" 결정과의 모순, 캐시 오적중 | 중 |
| 11 | CHAIN7: `__COMMON__` 답변 포함, 사용자가 고친 섹션 덮어쓰기 금지, 캐시 해시 시점 수정 | 일반 Write 최종 구성 품질 | 중 |
| 12 | 쓰지 않는 캐시(CHAIN6, CHAIN3_STUDY_REVEAL) 정리, `chainCache` 읽기-수정-쓰기 경쟁 제거, 용어 판정기 메모이제이션·장애 시 ASK_USER 폭주 완화 | 안정성·비용 | 중~상 |
| 13 | 용어 판정기 프롬프트 한국어화, 영어 하드코딩 문구 정리, 죽은 export 제거, `chain5_final.ts` 파일명 정정 | 정리 | 하 |

## 5-2. 진행 상태 (2026-10-11, 1순위 작업)

| # | 항목 | 상태 | 내용 |
|---|---|---|---|
| 1 | 프롬프트 버전·캐시 키·생성 메타데이터 | 완료 | `backend/src/llm/promptRegistry.ts` 신설(버전표·템플릿 해시·모델·지문). CHAIN1~7·검토 v2로 소급(CHAIN6 v3), SW-Q2/SW-D/SW-R v3, SW-C v2. `chainCache` 항목에 `promptFingerprint`를 남기고 적중 판정에서 비교(지문 없는 옛 항목은 호환 인정 → 학생 V1 문서 LLM 재실행 없음). `chainPerformanceLogs`에 `promptVersion`·`promptTemplateHash`·`model` 기록. CHAIN3 생성 메타·공개 단계 라벨·SW 회차/초안/점검 이력에 템플릿 해시 기록. 모델 선택은 `llm/models.ts`로 분리. 테스트 `npm run test:prompt-registry` |
| 2 | 고정 초안 출처 문서·재동결 방지 | 완료 | `docs/study_ai_draft_prompt_provenance_v1.md`(커밋 `c18c6e5`, 해시, 모델, 시각, 열람법). `npm run study:freeze`는 `ALLOW_STUDY_REFREEZE=1` 없이는 실행되지 않음 |
| 3 | 비식별 빈틈 | 완료 | SW-R 이전 지시 5개와 선택 문장을 비식별 처리. 실험용 Write의 비식별 문맥을 프로세스 전역에서 호출(케이스)별로 변경(`interview.ts`, `drafting.ts`). 유출 검사 없는 레거시 `src/chains/llmService.ts`·`schemas.ts`·`mockData.ts` 삭제(참조 없음 확인) |
| 4 | 참가자에게 보이는 오동작 | 부분 완료 | SW-C 코드 매핑을 숫자+영문으로 정규화("9a.", "CARE 9a", "9-a"). 판정을 못 받은 항목은 hint에 "점검 결과를 받지 못한 항목" 표시(별도 "판정 없음" 상태는 화면 작업과 함께 — 다른 세션이 해당 파일 수정 중이라 보류). SW-Q2는 섹션 id를 못 알아보면 careItem 코드로 섹션을 찾고, 그래도 안 되면 인터뷰를 끝내지 않고 재시도 오류. 기록 16,000자 절단 시 프롬프트에 사실을 적고 회차·초안 이력에 `recordTruncated` 기록 |
| 5 | 답변-기록 충돌 정책·공통 원칙 통일 | 완료 | CHAIN6 규칙 6을 "기록 우선, 답변 내용은 쓰지 않고 `[기록과 답변 불일치: 확인 필요]` 표시"로 바꿔 SW-D와 같게 함(새 사실 추가는 충돌이 아님을 명시). SW-Q2·SW-D·SW-R·SW-C가 `common.ts`의 P1~P7을 그대로 쓰고 실험용 규칙은 P8(기록 표기)·P9(자리표시 생성 금지)로 이음 |

보류했던 두 건은 2026-10-12에 마쳤다.
- **SW-C "판정 없음"**: 상태 `unchecked`를 추가(백엔드 `types/studyWrite.ts`, 프론트 `api.ts`). 모델이 판정을 빠뜨린 항목은 `not_in_record`가 아니라 `unchecked`로 저장된다. 초안 화면 CARE 탭에 "판정 없음(?)" 배지와 "전체 점검하기로 다시 점검" 안내를 두고, 준수율은 판정 받은 항목만 분모로 계산하며 판정 없음 개수를 따로 보인다(색은 판정 없음이 있으면 "모두 충족"으로 표시하지 않음). 연구 요약(`studyWrite/researchSummary.ts`)에 `careUnchecked`를 추가하고, `carePct`·`careRequiredPct`·누락 수는 판정 받은 항목으로만 센다. 2026-10-11 판에서 "not_in_record + 점검 결과를 받지 못한 항목…" hint로 저장된 항목도 읽을 때 판정 없음으로 본다(저장값은 그대로, `studyWrite/careStatus.ts`). 테스트 `npm run test:study-write-care`.
- **SW-R 이력 템플릿 해시**: 고쳐 쓰기(revise) 이력 항목에 `promptTemplateHash`를 남긴다(`routes/studyWrite.ts`).

연구 자료 해석 주의: 10-12 이전 실험용 Write 세션의 `carePct`는 판정 없음을 미충족으로 센 값이다. 연구 요약을 다시 만들면 새 기준으로 계산된다.

## 5-3. 진행 상태 (2026-10-12, 2순위 작업)

프롬프트 본문은 바꾸지 않았다(레지스트리 버전 그대로). 바뀐 것은 검증(스키마)·호출 정책·근거 범위·갱신 구현이다. 고정 연구 사례(학생 V1, Scaffold V2)는 LLM을 돌리지 않으므로 영향이 없다.

| # | 항목 | 상태 | 내용 |
|---|---|---|---|
| 6 | 관대한 스키마·수정 호출 | 완료 | CHAIN2/3/4/5/7·검토의 모델 출력 `sectionId`에 `CareSectionCoerced`("therapeutic_intervention", "Follow-up Outcomes", "discussion" 등 정규화), 섹션 id **목록**(`relatedSectionIds`·`targetSectionIds`)은 `CareSectionListCoerced`로 알아볼 수 없는 값만 버림, 허용 밖 `category`는 버림(코드가 뒤에서 추정). 빠진 배열은 빈 배열. CHAIN7 `titleSuggestions`·`keywordSuggestions`는 `min(1)` 모순을 없애고 3개·7개로 잘라냄, 섹션 키 변형 정규화·모르는 키 제거. SW-Q2 `questions.max(3)`·`targetSectionIds.min(1)` 제거(회차 예산만큼 잘라 쓰고, 빈 섹션은 careItem으로 찾음). `llm/client.ts`: 형식 오류(JSON 구문·zod)는 같은 프롬프트 재시도 대신 **모델 응답 + 검증 오류(경로·메시지만)를 덧붙인 수정 호출 1회**, 그래도 실패하면 `LLMOutputError(llm_output_invalid)` |
| 7 | 근거 범위 통일·CHAIN4→5 단일화 | 완료 | `llm/evidenceScope.ts` 신설: `cardSections`(tags ∪ sectionHints), `getRelevantEvidence`, `getEvidenceForSections`. CHAIN3·CHAIN4/5 범위·CHAIN6·검토·원고 검토 어댑터가 모두 이것을 쓴다(`cases.ts`·`sections.ts`·`adapters.ts`의 tags 전용 필터 7곳 교체). CHAIN4→5 갱신은 `questions/questionState.ts` 하나로 합침(`cases.ts`의 `recomputeQuestionState`는 테스트 의존성 주입을 위해 이름만 남겨 위임, `sections.ts`의 `refreshGlobalQuestionState` 삭제). 동작 결정: 누락·질문은 모델 결과 그대로(섹션을 내지 않으면 "없음" — CHAIN4 프롬프트 규칙 2와 일치, 이전 값을 유지하면 답한 항목이 영원히 남음), 핵심 AI 섹션 상태는 초안 없음→IMPOSSIBLE / 누락 있음→INCOMPLETE / 없음→READY, `rationaleText`는 **상태가 바뀔 때만** 일반 문구로 바꾸고 그대로면 CHAIN2 설명 유지. 입력 해시에 `sectionHints`를 넣어 기존 케이스는 다음 답변에서 CHAIN4/5가 한 번 다시 돈다 |
| 8 | 재시도·시간·토큰 상한 | 완료 | `new OpenAI({ maxRetries: 0, timeout })` — 재시도는 앱에서만(전송 오류 2회, 지수 백오프 0.5→1→2초). 체인별 상한표 `CHAIN_LIMITS`(라벨 접두어: CHAIN1 180s/8k, CHAIN2 90s/3k, CHAIN3 240s/8k, CHAIN4·5 120s/4k, CHAIN6 120s/6k, CHAIN7 300s/16k, SECTION 90s/3k, SW-Q2 90s/3k, SW-D·SW-R 180s/6k, SW-C 90s/4k, TERMINOLOGY 30s/1k), 요청마다 `max_completion_tokens`와 request `timeout` 전달. `finish_reason=length`는 재시도 없이 `llm_output_truncated`. `shouldRetryLLMError`는 ZodError·SyntaxError·LLMOutputError를 제외. 토큰 사용량은 수정 호출까지 합산해 `onUsage`로 보고, 사용량 JSONL에는 `(repair)` 표시 |
| 9 | 스키마와 프롬프트 일치·휴리스틱 표기 | 완료 | 모델 출력 스키마를 분리: `Chain3ModelOutputSchema`(evidenceLinks·unsupportedClaims 없음), `Chain6ModelOutputSchema`(updatedDraftText만), `FinalDraftModelOutputSchema`(sectionTraceability 없음). 저장 형태(`SectionDraftSchema`, `Chain6SectionUpdateOutputSchema`, `FinalDraftSchema`)는 그대로 두고 `buildDraftTraceability`가 덧붙인다. 그 성격(문자 2-gram 겹침, 임계 0.4)을 코드 주석, 미지원 문장 `reason` 문구("자동 문자 일치 검사에서 … 찾지 못했습니다. 실제 근거 여부는 기록을 확인해 판단하세요."), Scaffold 섹션 화면의 대체 문구, DOCX "Evidence Traceability" 부록 머리말에 밝힘. 고정 사례의 저장된 `reason`은 바뀌지 않는다 |

검증(2순위): `npm run test:llm-client`(신설: 스키마 정규화, 수정 호출 1회·전송 재시도·400 즉시 실패·잘린 출력, 체인 상한, 근거 범위, 갱신 상태 규칙), `test:prompt-registry`, `test:study`, `test:study-integration`, `test:study-write`, `test:research-export`, `test:export`, `test:optimization`, `test:common-questions`, `test:workflow`, `test:privacy-outbound`, `test:privacy-payload`, `test:timeline-import` 통과. 백엔드·프론트 `tsc` 통과. 실제 LLM 호출로 수정 호출의 성공률은 재지 않았다.

## 5-4. 진행 상태 (2026-10-12, 3순위 작업)

고정 연구 사례는 CHAIN1을 돌리지 않고(저장된 스냅샷), 실험용 Scaffold 공개 경로(`routes/scaffold.ts`)는 손대지 않았다. 학생 V1·Scaffold V2 자료에는 영향이 없다.

| # | 항목 | 상태 | 내용 |
|---|---|---|---|
| 10 | CHAIN1 재정규화·입력 해시 | 완료 | 카드를 만들 때 사전 치환을 다시 돌리던 것을 없앰. 절과 맞으면 그 절의 `normalizedText`(원문에 사용자가 확정한 용어만 반영)와 용어를 쓰고, 맞는 절이 없으면 원문 그대로 두고 `rewriteText:false`로 용어만 찾는다. 모델이 바꿔 낸 `normalizedText`는 쓰지 않는다. `buildChain1InputHash`가 존재하지 않는 방문 단위 필드 대신 절 단위 본문·섹션 힌트·용어를 해시한다(용어 확정이 바뀌면 CHAIN1이 다시 돈다) |
| 11 | CHAIN7 | 완료 | 공통 질문 답변(`__COMMON__`)을 질의응답 입력에 "공통 질문(여러 섹션에 해당)"으로 포함. 앞부분 입력으로 저자가 쓴 제목·고찰에 `authoredBy: 'user'`를 남기고 최종 구성이 덮어쓰지 않으며 최종 원고 본문도 저자 원문으로 맞춤. 저자 핵심어가 있으면 본문 KEYWORDS로 유지. CHAIN7이 쓴 섹션은 `authoredBy: 'chain7'`로 표시해 다음 구성 때 다시 씀(이전에는 한 번 생성된 고찰이 저자 원문처럼 굳었다). 표시 없는 옛 문서의 고찰은 이전 동작대로 둔다. 저장 직전에 최신 문서를 다시 읽어 그 위에 반영(구성 중 들어온 답변 보존). 캐시 해시는 **저장 뒤 상태**로 계산하고, 구성 중 입력이 바뀌었으면 캐시를 남기지 않고 stale 상태를 유지. 생성 메타데이터의 `CHAIN7:v1` 하드코딩을 레지스트리 값으로 교체 |
| 12 | 캐시 정리·쓰기 경쟁·판정기 | 완료 | `caseModel.recordChainRun`: `chainCache.X`·`sectionAdequacyReviews.X`를 점 경로 `$set`, 성능 로그를 `$push … $slice:-200`으로 원자 병합(필드가 null인 옛 문서는 읽어서 합치는 대체 경로). 섹션 검토·섹션 답변·공통 답변·앞부분 입력·CHAIN7 작업/캐시 적중/실패가 이것을 쓴다. 같은 섹션 검토가 동시에 오면 진행 중인 호출을 공유(케이스·섹션·입력 해시 기준). 검토 입력 해시에 `sectionHints` 포함. 읽는 곳이 없던 CHAIN6 캐시 항목은 더 쓰지 않는다(성능 로그는 남김). `CHAIN3_STUDY_REVEAL` 캐시 쓰기는 실험 경로라 그대로 두었다(출처 기록 용도). 용어 판정기: 같은 표현·후보 조합 메모이제이션(진행 중 호출 공유, 5,000개), 60초 안에 3회 실패하면 120초 동안 호출하지 않음, 판정기 실패는 ASK_USER 대신 **원문 유지**(KEEP_ORIGINAL)로 처리해 확인 요청 폭주를 막음 |
| 13 | 정리 | 완료 | 용어 판정기 프롬프트를 한국어로 옮김(`TERM:v2`, 판단 기준 동일). 일반 Write 섹션 화면 안내문(`uiHints`)·남은 질문 없음 사유·CHAIN7 상태 설명·실패 메시지·판정기 사유를 한국어로. `chains.ts`의 쓰지 않는 별칭 export 11개 삭제(`buildSectionDraftTraceability`는 테스트가 써서 유지). `schemas/chain5_final.ts` → `schemas/chain7_final.ts` |

정책 변화 두 가지(연구자 확인 권장): (가) 용어 판정기 장애 시 저자에게 묻지 않고 원문을 둔다. 본문을 바꾸지 않는 정책(2026-10-11)과 맞지만, 장애 동안 오타·약어 확인 기회가 사라진다. (나) 기존 일반 Write 사례는 해시 변경으로 다음 처리 때 CHAIN1·CHAIN7·검토가 한 번씩 다시 돈다.

검증(3순위): `npm run test:chain-hygiene`(신설: 카드 본문 비치환, CHAIN1 해시, CHAIN7 반영 규칙, 판정기 메모·차단·원문 유지), `npm run test:chain-state-integration`(신설, 테스트 전용 DB: 동시 쓰기 3건 보존, 키 삭제, 로그 200개 제한, 잘못된 키 거부, null 필드 대체 경로). 그 밖의 백엔드 스위트 27개와 백엔드·프론트 `tsc` 통과. `test:deid`(106행)·`test:privacy`(55행)는 실패하지만 HEAD(`ecf81c5`)에서도 같은 줄에서 실패하는 기존 문제다(2026-10-11 용어 정규화 결정 이후 기대값이 맞지 않음).

## 6. 점검 방법

- 프롬프트·스키마 본문 전부를 직접 읽었다. 오케스트레이션(호출 순서, 모델, 캐시, 검증, 비식별)은 코드 탐색으로 정리했고 핵심 지점은 파일:줄로 표시했다.
- 현재 chain3 템플릿 해시는 `hashPromptParts([chain3SystemPrompt])`로 계산했다(`promptTemplateHash` 계산식이 다를 수 있으나 10-11에 프롬프트 본문이 바뀐 사실은 git 이력으로 확정).
- 실제 LLM을 호출해 출력 품질을 평가하지는 않았다. 출력 품질 평가는 고정 사례 외의 사례로 별도 검증이 필요하다.
