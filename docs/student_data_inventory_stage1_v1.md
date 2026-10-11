# Student Study(S1~S10) 저장 데이터 점검 보고서 — 1단계 (추출 전)

- 작성일: 2026-10-11
- 범위: MongoDB(Atlas, DB `test`)와 현재 코드(`backend/src`, `frontend/src`)를 **읽기만** 하여 S1~S10 참가자 데이터의 존재 여부를 확인했다. DB 쓰기·삭제, 코드 변경, AI 체인 재실행은 하지 않았다.
- 모든 시각은 DB에 저장된 그대로 UTC(`Z`)다. 한국 시각은 +9시간.
- 이 문서의 "코드에 필드가 있음"과 "실험 당시 실제로 값이 저장됨"은 구분해서 적었다.

## 0. 핵심 결론

1. **S1~S10 참가자 기록 10건 + 재시작 기록 1건(S3-1)이 `cases` 컬렉션에 있다.** `experiment_code`와 `scaffoldState.participantCode`가 모두 `S1`~`S10` 문자열이라 참가자 연결은 바로 된다. 실험 기간은 2026-10-05 ~ 2026-10-08.
2. **"치료 개입(THERAPEUTIC_INTERVENTIONS)" 항목은 10명 모두 전체 흐름(내 초안 → 충분성 판단 → AI 초안 비교 → 회고)이 저장되어 있다.**
3. **"추적 관찰 및 결과(FOLLOW_UP_OUTCOMES)" 항목은 10명 모두 AI 공개 전 단계가 비어 있다.** 내 초안 없음, 충분성 판단 없음, 문장 표시 없음, 비교 메모는 `..` 같은 자리표시 문자. 섹션 진입에서 완료까지 6~35초. 원인으로 가장 유력한 것은 화면 단계 상태(`currentStep`)가 섹션을 바꿀 때 초기화되지 않아 두 번째 항목이 Step 4(AI 비교)로 열린 것이고, 서버 쪽 공개 게이트는 이 세션들에서 꺼져 있었다(§6-1). **두 번째 항목은 분석에서 "미수행"으로 다뤄야 한다.**
4. AI 초안은 2026-10-04에 생성해 고정한 것이라 **10명 모두 동일한 문장**을 보았다(해시 일치). 세션 중 AI 체인은 실행되지 않았다(LLM 사용 로그 없음).
5. "AI 공개 후 수정한 작성물"은 **시스템에 그런 기능이 없어서 존재하지 않는다.** 내 초안(`learnerNotes`)은 공개 전 스냅샷과 최종값이 10명 모두 동일하다. AI 공개 후의 흔적은 문장 표시(`reviewItems`)와 회고(`postAiReflection`)뿐이다.
6. 환자는 가상환자(68세 여, 6회 방문, 임상 교수 작성)이며 PHI 탐지 결과 0건, 참가자 자유 텍스트 256개 필드 패턴 검사에서 식별자 의심 0건. 비식별화 측면의 걸림돌은 없다.
7. 같은 DB에 테스트·리허설·데모·전문가 Write 실험 문서 34건이 섞여 있다. 추출 시 `mode='scaffold'` AND `experiment_code`가 `^S\d+(-\d+)?$` AND 생성일 2026-10-05~08로 걸러야 한다.

## 1. 데이터 위치와 식별

| 항목 | 내용 |
|---|---|
| DB | MongoDB Atlas, 데이터베이스 이름 `test` (`backend/.env`의 `MONGODB_URI`). 로컬 개발 서버와 Render 배포 서버가 같은 DB를 본다. |
| 컬렉션 | `cases` 45건(참가자 11건 포함), `experiment_counters` 2, `section_interactions` 4(참가자 것 없음), `manuscript_reviews` 1, `study_write_attachments` 2(참가자 것 없음) |
| 참가자 문서 | `cases` 1문서 = 1세션. 참가자 상태는 전부 `cases.scaffoldState` 안에 내장(embedded)되어 있다. 별도 컬렉션 없음. |
| 참가자 ID | `cases.experiment_code` = `cases.scaffoldState.participantCode` = `cases.researchState.participantCode` = `"S1"`…`"S10"`. 세션 시작 화면에서 연구자가 직접 입력한 값. 이름·이메일 등은 DB에 없다. |
| 실험 유형 | `cases.mode = "scaffold"`. `cases.studyMetadata.participationMode`에 `online`/`offline`. **`cases.studyConfig`는 11건 모두 `null`**(§6-1 참고). |
| 버전 | `versionMetadata = {appVersion 1.0.0, scaffoldVersion v2.0, caseVersion v1.0, sectionConfigVersion v2.0}` 11건 동일. |
| 사례 EMR | `cases.visits[6]` 가상환자 EMR. 11건 모두 본문 해시 동일(`dba3aa14`), `docs/study_case_emr_68F_v1.md` 원문과 같은 고정 사례. |

### 참가자 문서 목록

| code | caseId | 생성(UTC) | 참여 방식 | 비고 |
|---|---|---|---|---|
| S1 | case_1791189074009_i903gbp3w | 10-05 08:31 | online | |
| S2 | case_1791193186259_r4zlsfvmc | 10-05 09:39 | online | 자유 텍스트가 대부분 `..` |
| S3 | case_1791278360204_w5g4ej9n0 | 10-06 09:19 | offline | **중단 기록.** 섹션 진입 후 1단계로 되돌아가 v2 단계(core_message, claim_evidence)를 오가다 종료. 초안·판단 없음. 메모 1건. |
| S3-1 | case_1791279197423_nm1di5l9c | 10-06 09:33 | offline | S3의 재시작. S3의 메모가 그대로 다시 입력됨. 치료 개입 완료. |
| S4 | case_1791282346859_djywmgreu | 10-06 10:25 | offline | |
| S5 | case_1791352992154_5jdtik8m9 | 10-07 06:03 | offline | |
| S6 | case_1791362835010_inxyjutd8 | 10-07 08:47 | online | |
| S7 | case_1791424400651_n6masiyug | 10-08 01:53 | online | |
| S8 | case_1791439527522_dc9wqbckf | 10-08 06:05 | offline | |
| S9 | case_1791447053078_begiwvmjn | 10-08 08:10 | offline | |
| S10 | case_1791456192023_bnte4p0od | 10-08 10:43 | online | |

같은 DB의 비참가자 문서: `EQ001`~`EQ009`, `SQ001`~`SQ003`, `TEST-01`~`TEST-14`, `DRY-01`~`DRY-07`, `DEMO-01`, `홍길동 데모 1`, `SPEC-TEST-1`, `측정 임교수 1/2`. 모두 제외 대상.

## 2. 요청 항목별 저장 여부

범례: ✅ 실제 저장됨 / ⚠️ 부분 저장 또는 조건부 / ❌ 저장되지 않음(코드에 필드는 있을 수 있음)

| # | 항목 | 저장 | DB 필드 경로 (`cases.` 생략) | 저장 시점 | 추출 | 누락·불완전 |
|---|---|---|---|---|---|---|
| 1 | 참가자 식별 ID | ✅ | `experiment_code`, `scaffoldState.participantCode`, `scaffoldState.sessionId` | 세션 시작(사례 생성) 시 | 가능 | S3는 중단, S3-1이 실제 기록 |
| 2 | 실험 유형·진행 섹션 | ✅ | `mode`, `studyMetadata.participationMode`, `scaffoldState.sectionProgress[]`(sectionId, recordReviewCompleted, missingInfoReviewCompleted, draftRevealed, draftReviewCompleted, completedAt) | 각 단계 완료 PUT `/scaffold/sections/:id/progress` | 가능 | 추적 관찰 항목은 `recordReviewCompleted=false, missingInfoReviewCompleted=false`가 10명 공통 |
| 3 | EMR 기록 확인·메모 | ✅ | 메모: `scaffoldState.caseMap.caseNotes[]`(id, type observation/question, text, createdAt). 열람 행동: `scaffoldState.interactionEvents[]`의 `ui_action` kind `visit_jump`, `memo_suggestion_opened` | 메모 추가 즉시 PUT `/scaffold/case-map`; 이벤트는 POST `/scaffold/events` | 가능 | 메모 수정·삭제 이력은 없음(최종 상태만). S7은 AI 추천 1건을 추가했으나 최종 메모에 없음(삭제 추정) |
| 4 | AI 추천 메모 vs 사용자 메모 | ✅ | 사용자 메모 id `case-note-<ts>-…`, AI 추천 채택 메모 id `case-note-ai-<추천id>-<ts>`. 추천 원문은 DB가 아니라 코드 상수 `DEFAULT_STUDY_MEMO_SUGGESTIONS`(12개, v1-1~v6-2). 채택 이벤트 `memo_suggestion_added{suggestionId}` | 메모 추가 시 | 가능 | 추천 메모 텍스트는 채택 시 그대로 복사됨(편집 여부는 최종 텍스트와 상수 비교로 판별) |
| 5 | 선택한 근거 및 선택 이유 | ⚠️ | `scaffoldState.sectionReflections[].selectedEvidence[]`(id, sourceType, label, visitIndex), `selectedEvidenceIds[]`, `noRelevantEvidenceConfirmed`; 공개 전 고정본 `scaffoldState.preRevealSnapshots[].selectedEvidence[]`; 열람 `ui_action:evidence_picker_opened` | 내 정리 저장 시 PUT `/scaffold/sections/:id/reflection`; 스냅샷은 공개 직전 서버 생성 | 가능 | **선택 이유 필드는 없다.** 근거 선택은 접힌 선택 사항이라 S5(16), S7(8), S8(27), S10(32)만 선택. S1·S4·S6은 "관련 근거 없음" 체크. 추적 관찰 항목의 `selectedEvidenceIds`는 앞 항목 값이 그대로 넘어온 것(스냅샷은 0건)이라 쓰면 안 됨 |
| 6 | 근거 충분성 판단과 이유 | ⚠️ | 판단: `scaffoldState.reviewItems[]` 중 `sourceType='custom'`, id `THERAPEUTIC_INTERVENTIONS-custom-0-ti-001~003`, `judgment`(available_in_record / needs_additional_confirmation …), `updatedAt`; 공개 전 고정본 `preRevealSnapshots[].reviewItemJudgments[]`. 질문 원문은 코드 상수(프론트 `ScaffoldSectionPage.tsx` ti_001~003). "기록에서 관련된 부분 보기" 열람은 `evidence_opened{kind:record_pointer, questionId, judgmentWhenOpened}` | 답 고를 때마다 PUT `/scaffold/review-items/:itemId` | 가능 | **판단 이유 입력란이 없어 `note`가 11건 모두 null.** 치료 개입 10명×3문항=30건 저장(available 23, needs_additional_confirmation 7). 추적 관찰은 0건. 판단을 바꾼 이력은 `information_status_judgment_saved` 이벤트로 복원 가능(S1 ti_001, S9 등) |
| 6b | 학습자가 적은 "기록에 없는 정보" | ✅ | `sectionReflections[].learnerIdentifiedMissingItems[]`, 스냅샷 동일 필드 | 내 정리 저장 시 | 가능 | 7명 10건(S1,S4,S5,S6,S8,S9,S10). `learnerKeyInformationItems`, `additionalConfirmationItems`, `teacherReviewItems`는 화면에 없어 전원 빈 배열 |
| 7 | AI 공개 전 초안(preRevealSnapshot) | ✅ | `scaffoldState.preRevealSnapshots[]`(sectionId, createdAt, learnerNotes=내 초안, learnerIdentifiedMissingItems, selectedEvidence, reviewItemJudgments, questionTaskResults) | 공개 버튼 시 서버가 reflection에서 복사 생성(불변) | 가능 | 치료 개입 10/10 존재. 추적 관찰 10/10 존재하나 내용 전부 빈 값. S3는 없음 |
| 8 | AI 생성 초안 | ✅ | `sectionDrafts[]`(sectionId, draftText, evidenceLinks, unsupportedClaims, openIssues, generationMetadata{model gpt-4.1, promptVersion CHAIN3:v1, promptHash, inputHash, generatedAt 2026-10-04T14:26:14Z, tokenUsage}) | 사례 생성 시 고정 스냅샷(`studyCaseFrozen`)에서 복사 | 가능 | 11건 모두 동일 텍스트(치료 개입 504자, 추적 관찰 392자). 참가자별 생성이 아님 |
| 9 | AI 초안에 대한 판단과 이유 | ✅ | `scaffoldState.reviewItems[]` 중 `sourceType='draft_sentence'`: `sourceText`(AI 문장), `judgment`(want_to_add / differs_from_record / needs_additional_confirmation / needs_instructor_review), `note`(이유), `evidenceIds[]`(연결한 기록 근거), `learningFeedback`(규칙 기반 고정 문구, LLM 아님), `updatedAt`. 행동: `ui_action` kind `sentence_flag_opened/kind_selected/cancelled`, `draft_judgment_saved` | 문장 표시 저장 시 PUT `/scaffold/review-items/:itemId` | 가능 | "의심되는 문장만 표시" 방식이라 **표시하지 않은 문장은 레코드가 없다**(수용으로 간주 불가). 총 18건: want_to_add 16, differs_from_record 1(S6), needs_instructor_review 1(S10). S2·S3-1은 0건. want_to_add는 이유 선택 입력이라 S9 1건은 이유 없음 |
| 10 | AI 공개 후 수정·최종 작성물 | ❌ | 해당 기능 없음. `sectionReflections[].learnerNotes`(최종)와 `preRevealSnapshots[].learnerNotes`(공개 전) 비교 결과 10명 모두 동일. 공개 후 `own_draft` 편집 이벤트 0건 | — | 불가 | 대체 자료: 문장 표시(#9)와 회고(#11) |
| 11 | 회고·성찰 응답 | ✅ | `sectionReflections[].postAiReflection{changedJudgment, missingInDraft, unresolvedQuestion, transferPlan, savedAt}` | 항목 완료 직전 PUT reflection | 가능 | 화면 질문: changedJudgment="내 초안과 AI 초안을 비교해 보니"(필수), missingInDraft="AI 초안에 빠진 내용이 있나요?(선택)", unresolvedQuestion="교수님께 확인하고 싶은 것(선택)". **transferPlan은 화면에 없어 전원 빈 문자열.** 치료 개입: 비교 메모 실질 응답 9명(S2는 `..`), 빠진 내용 5명(S1,S4,S5,S8,S9), 교수 확인 3명(S4,S7,S9). 추적 관찰: 10명 모두 자리표시 문자 |
| 12 | 단계별 시각·수정 시각·사용 시간 | ✅ | `scaffoldState.startedAt`; `sectionReflections[].firstOpenedAt / draftRevealedAt / completedAt`; `preRevealSnapshots[].createdAt`; `reviewItems[].updatedAt`; `caseNotes[].createdAt`; `postAiReflection.savedAt`; 전체 이벤트 `scaffoldState.interactionEvents[]`(sequenceIndex, timestamp, eventType, sectionId, metadata). 입력칸 체류 `ui_action:field_edit{field, durationSeconds, length, changed}`, 20초 이상 무입력 `ui_action:pause{durationSeconds, step}` | 각 행동 시 | 가능 | **`scaffoldState.completedAt`은 11건 모두 null**(`session_completed` 이벤트 없음). 세션 종료는 마지막 `section_completed` 또는 첫 `final_summary_viewed`로 대체. 마지막 이벤트 시각은 연구자 재열람으로 오염됨(S2 10-07, S5 +2h, S9 +1h18m, S3-1 +24m). 처음 3개 이벤트(session_start, case_created, mode_selected)는 sequenceIndex·eventId 없음 |

보조 저장소: `researchState.interactionEvents`는 `scaffoldState.interactionEvents`의 거의 동일한 복사본(건수 ±1). 추출 기준은 `scaffoldState` 쪽으로 통일한다. `section_interactions`(Write 모드 Q&A), `exportLogs`(Word 내보내기), `export_requested` 이벤트는 참가자 11건 모두 비어 있다(세션 대본의 "Word로 내보내기" 단계는 기록상 수행되지 않음).

## 3. 참가자별 저장 현황 (치료 개입 항목 기준)

| code | 내 초안 글자수 | 근거 선택 | 기록에 없는 정보 | 충분성 판단 (ti_001/002/003) | 문장 표시 | 비교 메모 | 빠진 내용 | 교수 확인 | 메모(직접/AI채택) | AI전 분(min) | AI후 분 | 세션 총 분 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 143 | 없음 확인 | 1 | NAC/AIR/NAC | 4 (add 4) | 72자 | 38자 | — | 0/8 | 12.4 | 8.2 | 28.1 |
| S2 | 63 | 0 | 0 | AIR/NAC/AIR | 0 | `..` | `..` | `..` | 0/12 | 3.5 | 1.2 | 15.1 |
| S3 | — | — | — | — | — | — | — | — | 1/0 | — | — | 중단 |
| S3-1 | 65 | 0 | 0 | AIR/NAC/NAC | 0 (열어봄 1) | 57자 | — | — | 1/1 | 3.9 | 2.4 | 7.2 (+재열람) |
| S4 | 640 | 없음 확인 | 1 | AIR/AIR/AIR | 2 (add 2) | 25자 | 18자 | 58자 | 3/2 | 24.2 | 7.0 | 41.0 |
| S5 | 342 | 16 | 3 | AIR/AIR/AIR | 2 (add 2) | 33자 | 23자 | — | 8/3 | 16.7 | 6.0 | 35.6 |
| S6 | 271 | 없음 확인 | 1 | AIR/AIR/AIR | 3 (add 2, differs 1; 근거 연결 있음) | 46자 | — | — | 12/6 | 9.1 | 10.9 | 44.9 |
| S7 | 419 | 8 | 0 | NAC/AIR/AIR | 1 (add 1) | 29자 | `-` | 66자 | 19/0 | 8.4 | 3.4 | 33.0 |
| S8 | 219 | 27 | 1 | AIR/AIR/AIR | 2 (add 2) | 94자 | 126자 | — | 1/0 | 7.3 | 8.0 | 20.6 |
| S9 | 174 | 0 | 2 | AIR/NAC/AIR | 3 (add 3, 1건 이유 없음) | 106자 | 111자 | 73자 | 8/0 | 9.5 | 12.2 | 41.7 |
| S10 | 157 | 32 | 1 | AIR/AIR/AIR | 1 (instructor 1) | 68자 | — | — | 4/4 | 8.9 | 7.1 | 29.0 |

AIR = available_in_record, NAC = needs_additional_confirmation, add = want_to_add. "AI전 분"은 `firstOpenedAt`→`preRevealSnapshots.createdAt`, "AI후 분"은 `draftRevealedAt`→`completedAt`, "세션 총 분"은 `startedAt`→마지막 `section_completed`.

추적 관찰 항목(FOLLOW_UP_OUTCOMES): 10명 모두 내 초안 0자, 충분성 판단 0, 문장 표시 0, 비교 메모 `.`/`..`/`...`, 진입→완료 6~35초.

## 4. 연구 질문별 분석 가능성

| RQ | 활용 가능한 필드 | 부족한 점 |
|---|---|---|
| RQ1 EMR 정보 선택·구성 | `caseMap.caseNotes`(메모, 직접/AI채택 구분), `visit_jump`·`memo_suggestion_opened` 이벤트(방문별 탐색 순서), `preRevealSnapshots[].learnerNotes`(내 초안 원문), `preRevealSnapshots[].selectedEvidence`(4명), `noRelevantEvidenceConfirmed`(3명), `evidence_picker_opened`, 고정 `evidenceCards`(230장)와 `DEFAULT_STUDY_CARE_ELEMENT_MAP`(CARE 세부 항목별 기준표) | 근거 선택은 선택 사항이라 4명만 있음. 선택 이유 없음. 치료 개입 1개 항목만. 내 초안이 어떤 EMR 구절을 썼는지는 텍스트 대조로만 추정 가능 |
| RQ2 충분성·누락 판단 | `reviewItems[custom]`(3문항 판단, 30건), `information_status_judgment_saved`(판단 변경 이력), `evidence_opened:record_pointer`(답 고른 뒤 기록 확인 여부, 17건), `learnerIdentifiedMissingItems`(10건), `pause`(판단 중 멈춤) | **판단 이유 미수집.** 판단 종류가 2가지만 사용됨(unavailable, needs_instructor_review 0건). 추적 관찰 항목 없음 |
| RQ3 AI 초안 수용·거부·수정과 근거 | `reviewItems[draft_sentence]`(18건: 문장, 판단, 이유, 연결 근거), `sentence_flag_*` 이벤트(열었다 취소 13건 포함), 고정 AI 초안 전문(공통 7문장) | **"수용"은 기록되지 않는다**(표시 안 한 문장 = 판단 없음). "거부"에 해당하는 differs_from_record 1건뿐. 수정 행위 자체는 없음. 2명(S2, S3-1)은 표시 0건 |
| RQ4 AI 공개 전 초안 vs 이후 작성물 | 공개 전: `preRevealSnapshots[].learnerNotes`. 공개 후의 간접 자료: want_to_add 문장+이유(16건), `postAiReflection.changedJudgment`(9명), `missingInDraft`(5명) | **공개 후 작성물이 없다.** 초안 변화 분석은 불가하고 "AI 초안을 보고 자기 초안에 무엇이 빠졌다고 인식했는가"로 질문을 바꿔야 함 |
| RQ5 AI 지원 이후 회고 | `postAiReflection.changedJudgment`(필수), `missingInDraft`, `unresolvedQuestion`(교수 확인), `savedAt`, `field_edit`(회고 입력 시간) | 치료 개입 1개 항목만 실질 응답. S2는 자리표시. `transferPlan` 미수집. 사후 설문·인터뷰는 별도 수집본과 결합 필요 |

## 5. 누락·불완전 기록 정리

1. **추적 관찰 및 결과 항목 전원 미수행**(§0-3). 데이터 측면에서는 `sectionProgress`에 `recordReviewCompleted=false`가 남아 있어 구별된다.
2. **S3 중단 → S3-1 재시작.** S3-1을 S3의 기록으로 쓰되 `participantCode`는 `S3-1`로 저장되어 있으므로 매핑 표에 명시. S3의 메모 1건은 S3-1에 다시 입력되어 중복.
3. **S2**: 비교 메모·빠진 내용·교수 확인이 모두 `..`, 문장 표시 0건. 치료 개입 AI 후 검토 1.2분. 내 초안 63자와 충분성 판단 3건만 실질 자료.
4. **근거 선택 값의 섹션 간 전이**: 추적 관찰 항목의 `sectionReflections.selectedEvidenceIds`는 치료 개입 선택이 화면 상태로 넘어가 그대로 저장된 값. 같은 섹션의 `preRevealSnapshots.selectedEvidenceIds`는 0건. 스냅샷을 기준으로 삼으면 안전.
5. **코드에만 있고 실제 비어 있는 필드**: `learnerKeyInformationItems`, `additionalConfirmationItems`, `teacherReviewItems`, `questionTaskResults`, `postAiReflection.transferPlan`, `caseMap.selectedEvidenceIds / evidenceReflections / learnerAddedEvidence / claims`, `scaffoldState.completedAt`, `sessionOutcome`(전원 in_progress), `researcherAssistance`, `technicalIssues`, `exportLogs`.
6. **충분성 판단 이유 미수집**(입력란 없음). `draft_sentence`의 `want_to_add`는 이유가 선택 사항.
7. **세션 종료 시각 없음**: `session_completed` 이벤트가 한 번도 기록되지 않음. 대체 규칙은 §2-12.
8. **연구자 재열람 흔적**이 이벤트 로그에 섞임(`final_summary_viewed` 반복, 뒤늦은 `workflow_phase_changed`). 참가자 행동 분석 구간은 `startedAt`~마지막 `section_completed`로 잘라야 함.
9. **AI 추천 메모 삭제 흔적**: S7은 `memo_suggestion_added v1-1` 이벤트가 있으나 최종 메모에 없음. 메모 삭제 이벤트는 기록되지 않음.
10. 사전·사후 설문, 인터뷰, 관찰 기록지는 DB에 없음(별도 수집본).

### 6-1. 두 번째 항목이 건너뛰어진 기술적 배경 (코드 확인 결과)

- `frontend/src/pages/ScaffoldSectionPage.tsx`의 단계 상태 `currentStep`은 섹션이 바뀔 때 `step1`로 되돌리는 처리가 없고, 첫 항목 공개 뒤 `step4`로 둔 상태가 두 번째 항목에도 유지된다(이벤트에 `field_edit own_draft step=step4 draftRevealed=false`가 남음).
- 서버의 공개 게이트 `evaluateStudyRevealGate`는 `studyConfig.studyMode=true`일 때만 동작하는데, "실험용 Scaffold 시작" 경로로 만든 11건은 `studyConfig`가 `null`이라 기록 검토 없이 공개가 허용됐다.
- 이 보고서는 현상 확인까지만 한다. 코드 수정은 범위 밖이며, 연구자가 세션에서 두 번째 항목을 의도적으로 생략했는지 여부는 관찰 기록지와 대조가 필요하다.

## 7. 추천 추출 파일 구조 (2단계)

원칙: 먼저 11개 문서를 그대로 JSON으로 고정 보관(`00_raw_cases_S1-S10.json`, sha256 기록)하고, 아래 표 파일은 전부 그 고정본에서 파생한다. 코드 상수(추천 메모 12개, 충분성 질문 6개, CARE 기준표)도 같은 폴더에 사본으로 둔다. 시각은 UTC 원본과 KST 변환 열을 함께 둔다.

| 파일 | 행 단위 | 주요 열 | 비고 |
|---|---|---|---|
| A `student_participants.csv` | 참가자(11행, S3 포함) | code, analysis_code(S3-1→S3), caseId, participationMode, startedAt, firstSectionOpenedAt, lastSectionCompletedAt, firstFinalSummaryAt, totalMinutes, sectionsCompleted, status(complete/abandoned), notes | |
| B `student_evidence.csv` | 참가자×섹션×선택 근거 1건 | code, sectionId, source(pre_reveal_snapshot), evidenceId, sourceType, visitIndex, label, noRelevantEvidenceConfirmed | 스냅샷 기준. 추적 관찰은 비어 있음 |
| B2 `student_memos.csv` | 메모 1건 | code, noteId, origin(own/ai_suggested), suggestionId, type, text, createdAt, matchesSuggestionText | |
| B3 `student_sufficiency.csv` | 참가자×질문(30행) | code, sectionId, questionId, questionText, finalJudgment, judgmentChangeCount, recordPointerOpened, updatedAt | 이유 열은 "미수집" 고정 |
| B4 `student_missing_items.csv` | 학습자 기재 항목 1건 | code, sectionId, text | |
| C `student_ai_review.csv` | 문장 표시 1건(18행) | code, sectionId, aiSentenceId, aiSentenceText, judgment, judgmentLabel, reason, linkedEvidenceCount, linkedEvidenceLabels, updatedAt | 미표시 문장은 행 없음을 README에 명시 |
| D `student_drafts.csv` | 참가자×섹션 | code, sectionId, ownDraft_preReveal, ownDraft_final, ownDraftIdentical(true), aiDraftText, aiDraftHash, aiGeneratedAt, snapshotCreatedAt, revealedAt, completedAt | "AI 공개 후 수정본" 열은 두지 않고 README에 없음을 명시 |
| E `student_reflections.csv` | 참가자×섹션×질문 | code, sectionId, questionKey(changedJudgment/missingInDraft/unresolvedQuestion), questionText(화면 문구), answer, isPlaceholder, savedAt | `..` 같은 응답은 isPlaceholder=true |
| F `student_data_inventory.csv` | 참가자×데이터 유형 | code, dataType, present, count, missingReason, qualityNote | §2·§5 내용을 표로 |
| G `student_events.csv` | 이벤트 1건(~880행) | code, sequenceIndex, timestamp, elapsedSec, gapSec, eventType, kind, sectionId, step, draftRevealed, metadata(JSON) | 행동 분석용. 재열람 구간 플래그 열 추가 |
| README | — | 파일 설명, 필드 출처, 알려진 한계(§5), 코드 상수 사본 | |

## 8. 개인정보·데이터 훼손 위험과 대응

| 위험 | 평가 | 2단계 대응 |
|---|---|---|
| 환자 식별 정보 | 가상환자, `deidentifiedEMRs.phiSpans` 0건, 자유 텍스트 256필드 패턴 검사 0건 | 추출 후 한 번 더 전수 육안 확인. `visits` 원문은 분석에 꼭 필요하지 않으면 제외하고 `evidenceCards` 라벨만 사용 |
| 참가자 식별 | DB에는 S코드만. 연결표는 연구자 로컬 | 추출물에 S코드만 유지 |
| 접속 정보·키 | `.env`에 `MONGODB_URI`, `OPENAI_API_KEY` 있음 | 추출 스크립트는 `.env`를 읽되 출력에 절대 포함하지 않음. 이번 점검에서도 출력하지 않았음 |
| DB 쓰기 사고 | 백엔드 `deleteCase`·`updateCase` 경로 존재. 로컬 개발 서버도 같은 DB에 붙음 | 추출은 `find`만 쓰는 독립 Node 스크립트로 실행(서버 코드·mongoose 모델 불러오지 않음). 가능하면 Atlas에 읽기 전용 사용자 추가 권장 |
| 개발 데이터 혼입 | 같은 DB에 교수용 Write 실험 문서가 계속 늘어남 | 필터 `mode='scaffold'`, `experiment_code ~ ^S\d+(-\d+)?$`, `createdAt` 10-05~10-08, 추출 시 11건 수·caseId 목록을 이 보고서와 대조 |
| 사후 변경 | 연구자 재열람으로 이벤트가 추가될 수 있음. `cases`에 updatedAt 없음 | 고정 JSON 스냅샷을 먼저 뜨고 해시 기록. 이후 파생은 스냅샷에서만 |
| AI 생성물과 참가자 작성물 혼동 | AI: `sectionDrafts.draftText`, `learningFeedback`, 추천 메모 상수. 참가자: `learnerNotes`, `caseNotes`(origin 구분), `note`, `postAiReflection` | 모든 파일에 `author`/`origin` 열 또는 열 이름 접두어(`ai_`/`own_`)로 구분 |

## 9. 2단계 전에 확인이 필요한 사항

1. 추적 관찰 항목은 "미수행"으로 처리하고 A·F 파일에만 남길지, D·E에 빈 행으로도 남길지.
2. S3-1을 S3로 재표기할지(권장: `analysis_code` 열로 S3, 원 코드는 보존).
3. `visits`(가상 EMR 원문)와 `evidenceCards` 230장 전체를 추출물에 포함할지. RQ1에 참조용으로 필요할 수 있음.
4. 이벤트 파일(G)에서 연구자 재열람 구간을 제외할지, 플래그만 둘지.
5. 출력 폴더 위치(예: `casereport/exports/student_study_2026-10/`)와 git 추적 제외 여부.

## 부록. 이번 점검에서 쓴 방법

- 코드: `backend/src/db/schema.ts`, `models/caseModel.ts`, `types/scaffold.ts`, `routes/scaffold.ts`, `export/researchExport.ts`, `study/cases/defaultStudyCase.ts`, `frontend/src/pages/ScaffoldSectionPage.tsx`, `ScaffoldOverviewPage.tsx`, `docs/session_script_user_v1.md`, `detailed_experiment_protocol.md`.
- DB: `backend/node_modules/mongodb` 드라이버로 `find`/`countDocuments`/`listCollections`만 실행. 참가자 11건 원문은 세션 임시 폴더(scratchpad)에만 복사해 구조 분석에 사용했고 프로젝트 폴더에는 두지 않았다.
- 2026-10-04 백업(`backend/backups/mongo_2026-10-04_before-reprocess/`)에는 참가자 데이터가 없다(실험 전 백업).
