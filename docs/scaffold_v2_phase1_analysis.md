# Scaffold V2 개발 — Phase 1: 현재 구현 상태 및 영향 분석

- 작성일: 2026-10-11
- 범위: `casereport/backend/src`, `frontend/src`, `docs/`, `exports/`를 **읽기만** 하여 요청서(Scaffold V2 최종 개발 요청서) V2-01~V2-09, §5(교수 실습 범위), §6(데이터 보호·저장·버전)에 대한 현재 상태를 조사했다. DB는 열지 않았고, 1단계 점검 보고서(`student_data_inventory_stage1_v1.md`, `_addendum.md`)의 DB 사실을 인용했다.
- 이번 세션에서 코드에 반영한 것은 **진입점 1건만**이다(§1-2). 그 외 Phase 2 개발은 착수하지 않았다.
- 표기: 난이도 하/중/상, 파일 경로는 `casereport/` 기준. 줄 번호는 현재 작업 트리(미커밋 변경 포함) 기준이라 커밋 후 조금 달라질 수 있다.

## 0. 핵심 결론

1. **"V1"은 코드와 데이터 안에서 이미 "v2"로 불린다.** caseMap 버전 `'scaffold-v2'`, 화면 kicker "Scaffold v2", 학생 11건의 `versionMetadata.scaffoldVersion = 'v2.0'`. 따라서 **연구상 V2를 구분할 식별자가 아직 없다.** 새 값(예: `scaffoldVersion: 'v3.0'`)을 정하고 문서에 "연구 V2 = 시스템 v3.0"으로 매핑을 남겨야 한다(§4-1).
2. **학생 V1 11건은 `studyConfig = null`이라 서버 공개 게이트가 꺼진 상태로 진행됐다.** 실험용 입력 화면이 일반 `POST /api/cases`로 케이스를 만들기 때문이다. 게이트를 켜는 `POST /api/cases/study/start`는 구현만 있고 호출되지 않는다. V2에서 게이트를 켤지 말지는 연구자 결정 사항이며, 켜면 현재 게이트 조건이 "내 초안만 쓴 학습자"를 막기 때문에 조건 수정이 함께 필요하다(§4-3).
3. **9개 요구사항 중 완전 구현된 것은 없다.** 부분 구현 5건(V2-01, 02, 05, 07, 08, 09 중 안내·저장 골격만 있음), 미구현 3건(V2-03 크기 조절, V2-04 메모 출처·필터, V2-06 EMR 검색). 상세는 §3.
4. **AI 추천 메모는 고정 데이터다**(`DEFAULT_STUDY_MEMO_SUGGESTIONS` 12개, 회차당 2개). 실시간 생성이 아니므로 교수 참가자 간 동일성은 이미 보장된다. 12개 중 치료 개입(9a~9c) 관련은 5개뿐이고, CARE 항목·출처 anchor는 서버에 있지만 **응답에서 잘려 나가** 화면에 못 쓴다(§3 V2-05).
5. **치료 개입 고정 AI 초안(504자)은 공개 전까지 화면과 `GET /scaffold` 응답 모두에서 숨겨진다.** 다만 `careElementMap`(CARE 세부 항목별 "기록에 있는 정보/없는 정보" 정답표)은 공개 전에도 응답에 포함되어 개발자 도구로 볼 수 있고, `GET /api/cases/:id`와 `/summary`는 초안을 그대로 돌려준다(§4-4). 교수 평가에서는 문제가 되지 않지만 V2 설계 시 알고 있어야 한다.
6. **데이터 저장 구조는 서버 whitelist 정규화 방식**이다. `normalizeScaffoldState`/`normalizeV2CaseMap`이 알려진 키만 다시 조립하므로, V2에서 새 필드(메모 회차·분류, 판단 이유 등)를 넣으려면 이 함수들과 export, 프론트 타입을 함께 고쳐야 한다. 거꾸로 **V1 문서는 V2 코드가 읽어도 바뀌지 않는다**(쓰기가 일어나지 않으면). 단, 연구자 "다시 보기(읽기 전용)" 기능의 GET 경로 하나가 비연구 케이스에 쓰기를 일으킬 수 있어 확인이 필요하다(§4-6).
7. **섹션 범위:** 현재 `STUDY_SECTION_IDS = ['THERAPEUTIC_INTERVENTIONS','FOLLOW_UP_OUTCOMES']`가 개요 목록, 다음 섹션 자동 이동(완료 1초 후 추적 관찰로 이동), 진행 헤더, 연구 기록 화면에 모두 쓰인다. 교수 평가를 치료 개입만으로 제한하려면 V2에서 이 목록을 1개로 줄이는 변경이 필요하다(§5).

## 1. 현재 작업 트리(미커밋) 변경 사항 확인

요청서의 "현재 작업 중인 교수용 개발 변경 사항이 있다면 먼저 확인" 항목이다. `git status` 기준 34개 파일이 미커밋 상태이며 성격이 셋으로 나뉜다.

### 1-1. Scaffold 관련 (교수용으로 보이는 작업)
| 변경 | 파일 | 내용 | V2와의 관계 |
|---|---|---|---|
| 연구자 "참가자 화면 다시 보기(읽기 전용)" | `frontend/src/utils/readOnlyView.ts`(신규), `components/ReadOnlyViewGuard.tsx`(신규), `components/scaffold/ReadOnlyStageNavigator.tsx`(신규), `services/api.ts`(인터셉터), `backend/src/index.ts`(헤더 403), `ResearchHistoryPage.tsx`(버튼), Overview/Section/Summary 페이지에 내비게이션 바 | `?readonly=1` 진입 시 입력·클릭을 막고 단계별로 참가자 화면을 재생. 쓰기 요청은 클라이언트에서 거부하고 텔레메트리는 가짜 200 | 중복 개발 아님. V2 경로/섹션 목록이 `'/study/scaffold/cases/'`와 `STUDY_SECTION_IDS`에 하드코딩되어 있어 V2 섹션 범위 변경 시 함께 조정 필요 |
| 데모 사례 메모 추천 | `backend/src/study/cases/demoCase.ts`(신규, 미추적), `routes/scaffold.ts:13,769-774` | 45세 남성 요통 3회차 데모 사례용 추천 6개 | V2 무관. 고정 사례(68세 여) 판정 로직과 분리됨 |
| 작성 화면에 1단계 메모 표시 | `ScaffoldSectionPage.tsx:986-1008` | 1단계 메모를 회차별로 묶어 오른쪽 "내가 정리한 내용" 패널 맨 위에 표시. 회차는 AI 추천 id(`case-note-ai-v3-1-…`)에서만 복원되고 직접 쓴 메모는 "직접 쓴 메모"로 묶임 | **V2-04 메모 출처의 전신**. 직접 메모에 회차가 없다는 한계를 그대로 드러냄 |
| 방문 기록·메모 목록 높이 | `ScaffoldOverviewPage.css:295-303` | `max(320px, calc(100vh - 220px))` 등 | V2-03/06 스크롤 점검과 겹침 |

### 1-2. 이번 세션에서 추가한 것 (요청 1건)
- `ModeSelectPage.tsx`: "실험용 Scaffold 시작" 아래 **"실험용 Scaffold V2 시작"** 버튼 → `/study/scaffold-v2`.
- `App.tsx`: `/study/scaffold-v2` → `StudyEntryPage mode="scaffold" scaffoldVersion="v2"`.
- `StudyEntryPage.tsx`: 제목 "Study Scaffold V2", 라우터 state에 `scaffoldVersion: 'v2'` 전달.
- **한계:** `CaseInputPage`가 이 state를 읽지 않아 현재는 V1과 완전히 같은 흐름으로 진행된다. 식별자 저장은 Phase 2 첫 작업(§6 A단계)이다. `tsc --noEmit` 통과.

### 1-3. Write 모드·공통 변경 (V2 범위 밖, 섞이지 않게 주의)
`backend/src/llm/prompts/chain*.ts`(7개 수정, 3개 삭제), `deid/*`, `studyWrite/*`, `StudyWriteDraftPage/FinalPage`, `docs/session_script_user_v1.md`, `survey_items_user_v1.md`, 세션 대본 docx. 요청서 §6 "기존 Write 모드 수정 금지"와 별개로 **이미 작업 트리에 있는 Write 변경**이다. V2 커밋과 분리해서 처리하길 권한다(커밋 단위를 나누지 않으면 V2 변경 추적이 어려워진다).

## 2. 유지해야 할 6가지 교육 요소 ↔ 현재 구현

| # | 교육 요소 | 현재 화면·코드 | 상태 |
|---|---|---|---|
| 1 | CARE 13항목 소개 | 개요 페이지 intro("시작하기 전에 / 오늘 진행 방법")의 `renderCareMap` — `CARE_OVERVIEW`(`utils/scaffoldUi.ts:223+`), 오늘 연습 항목 표시. intro 확인 여부는 localStorage `scaffold-intro-done:<caseId>` | 있음 |
| 2 | EMR 탐색 및 메모 | 개요 1단계 `case_understanding`: 좌 "방문 기록"(회차별 `<details>` + `<pre>` 원문), 우 "내 증례 메모"(관찰/질문 2종), 회차 점프 버튼, AI 메모 추천(회차별 접힘) | 있음. 검색·메모 회차 연결 없음 |
| 3 | CARE 기준 및 예시 | 섹션 페이지 상단 "CARE 기준" 박스(`CARE_SECTION_GUIDE`, `scaffoldUi.ts:303-310`) + 다른 환자 1문장 예시(`CARE_WRITING_EXAMPLES`) | 있음. 현재 사례 예시 없음 |
| 4 | AI 공개 전 직접 작성 | Step 1 "내 초안 써 보기"(`authoringNotes` → `sectionReflections[].learnerNotes`) → Step 2 충분성 판단(`reviewItems[custom]`) → "내 정리 저장하고 AI 초안 보기"에서 즉시 공개 | 있음. 공개 직전 서버가 `preRevealSnapshots[]` 생성(불변) |
| 5 | AI 초안 판단 및 근거 확인 | Step 3(코드상 step4) 문장 클릭 표시 → 4종 판단 + 이유 + 근거 연결(`reviewItems[draft_sentence]`), `careElementMap` 표 | 있음. 미표시 문장은 레코드 없음 |
| 6 | 사후 회고 | 같은 화면 하단 3문항(`postAiReflection`) → "이 항목 완료" 시 저장 | 있음. 완료 전 새로고침 시 유실 |

**순서 보장:** 공개 전 단계는 한 화면(Step1+Step2 동시 표시)이고, 공개 후에는 Step 1 입력란이 숨겨져 내 초안을 고칠 수 없다. 서버는 reflection PUT으로 `learnerNotes`를 언제든 받지만 스냅샷은 바뀌지 않는다. **V2에서도 이 흐름(사용자 선행 판단 → AI → 비교·회고)은 그대로 쓸 수 있다.**

## 3. 요구사항별 현황

각 항목: 관련 코드 → 현재 동작 → 필요한 변경 → 난이도 → 기존 기능·데이터 영향.

### V2-01. 실습 목적 및 진행 안내 — 부분 구현
- **코드:** `ScaffoldOverviewPage.tsx:510-599, 661-694`(intro, `renderHowTo`, `renderCareMap`), `:618-644`(단계 스테퍼, 실험 모드는 1·2단계만 표시), `:684-686`(1단계 안내문), `ScaffoldSectionPage.tsx:1820-1847`(CARE 기준), `:2361-2365`(문장 표시 안내), `components/scaffold/ScaffoldProgressHeader.tsx`.
- **현재:** intro는 "내 초안 쓰기 → AI와 비교 → 알게 된 것 적기" 3단계 설명 + CARE 13항목 + 다른 환자 예시. **1단계(기록 읽기·메모)에 대한 안내는 없음**("무엇을 메모할지", "AI 추천을 언제 열지"). 각 단계 완료 후 다음 단계 예고도 없음. 실험용 Write에서 쓰는 "AI 자동 작성 도구가 아니다"류 목적 안내 없음.
- **필요:** (1) intro에 교육용 목적 1~2문장 + 6요소 흐름 한 줄씩, (2) 1단계 안내 추가, (3) 섹션 페이지 각 Step 머리에 "지금 할 일 / 다음에 할 일" 1줄, (4) Step 2→공개 직전 경고문 유지. 텍스트 상수 중심 변경.
- **난이도:** 하. **영향:** 없음(문구). 단, 교수 평가용 V2 고정 후에는 문구도 바꾸지 않아야 함.

### V2-02. CARE 작성 기준 및 현재 사례 예시 — 부분 구현
- **코드:** `scaffoldUi.ts:252-273`(`CARE_WRITING_EXAMPLES`, 치료 개입 예: "침 치료를 주 2회 시행하였고, 2차 방문부터 온열 치료를 추가하였다."), `:247-250`(`CARE_EXAMPLE_RECORD`, 45세 남 요통), `:279-284`(9a 필수/9b 필수/9c 선택), `ScaffoldSectionPage.tsx:1820-1847`(기준 박스, 접히지 않음, 중앙 열 상단에서 스크롤로 사라짐). 서버 고정 자료: `defaultStudyCase.ts:505-552`(`DEFAULT_STUDY_CARE_ELEMENT_MAP` 치료 개입 9a/9b/9c inRecord 12항·notInRecord 6항), `:407-440`(`DEFAULT_STUDY_RECORD_POINTERS` ti_001~003, 회차별 원문 인용 18개).
- **현재:** 기준 3줄 + 다른 환자 예시 1문장. 현재 사례(68세 여) 예시는 없음. `careElementMap`은 공개 후에만 화면에 표시(`:2489`).
- **고정 AI 초안과의 중복 점검:** 치료 개입 고정 초안(504자, `defaultStudyCaseProcessed.generated.ts:7531`)은 9a(정신과·신경과 약, 황련해독탕, 침·약침·기기구술·자율훈련법·지언고론요법), 9b(2주 복용·유침 20분·1일 2회 10분), 9c(쿠에티아핀 추가, 침 중단, 안와부 멍)를 **거의 전부** 담고 있다. 따라서 **현재 사례에서 뽑은 예문은 어떤 것이든 초안 문장과 내용이 겹친다.** 중복을 낮추는 선택지는 셋이다.
  1. CARE 세부 요소마다 **형식 예시**(예: 9b "약 이름 + 용량/포 + 1일 횟수 + 복용 기간, 예: 황련해독탕 5.61g 1일 3회 2주")로 한정하고, 치료 종류 전체 나열(9a)은 예시로 주지 않음.
  2. 예시의 사실 출처를 **`recordPointers`의 원문 인용**으로 연결(이미 회차 번호가 있음)해 "원기록 → 작성 문장" 변환을 보여 주되, 요소당 1개로 제한.
  3. 9c(치료 변경)는 현재 사례 예시를 주지 않고 다른 환자 예시 유지(변경 이유 서술이 초안의 핵심 차별 지점이라서).
  어느 조합을 쓸지는 연구자 결정(§7-3). "직접 작성 단계가 형식적으로 변하지 않는지"는 예시 공개 전후 내 초안 글자 수·요소 포함률을 V1 10명 자료와 비교해 점검할 수 있다(이번 조사 범위 밖).
- **필요:** 예시 데이터 상수(요소별 짧은 예문 + 근거 회차/인용 id) 추가, 기준 박스를 작성 중 다시 열 수 있게 **접기/고정(sticky)** 배치, V2에서만 노출.
- **난이도:** 중(데이터 작성·검수가 핵심, 코드는 하). **영향:** 프론트 상수와 섹션 페이지만. V1 데이터 무관.

### V2-03. 초안 작성 화면 영역 크기 조절 — 미구현
- **코드:** `ScaffoldSectionPage.css:11-17`(`height:100vh` flex), `:179-184`(`grid-template-columns: 31% minmax(0,1fr) 29%`), `:186-240`(패널별 `overflow-y:auto`), `:401-442`(1199px 이하 32/1fr/24, 899px 이하 1열·페이지 스크롤), `:783-795`(초안 textarea `min-height:150px; resize:vertical`). 패널: 좌 "환자 원기록"(`ScaffoldSectionPage.tsx:1590-1709`), 중 "현재 작업"(`:1712-2639`), 우 "내가 정리한 내용"(`:2642-2673`, 미커밋 변경으로 1단계 메모가 여기 상단에 붙음).
- **현재:** 고정 비율 3열, 분할선 없음, 최소 폭은 `min-width:0`만.
- **필요:** 3열 사이 드래그 분할선 2개(마우스+터치), 열별 최소 폭(예: 240px), 폭을 `grid-template-columns` 변수로 치환, 리사이즈 중 패널 내부 스크롤 유지, localStorage에 비율 저장(선택), 899px 이하에서는 분할선 숨김(현재 1열 fallback 유지). 외부 라이브러리 없이 구현 가능.
- **난이도:** 중. **영향:** CSS/레이아웃만. 저장 데이터 없음. 다만 `interactionEvents`에 `ui_action: pane_resized`를 남길지 결정(IRB상 단순 행동 로그 미수집 원칙과 충돌 가능 → 기본은 **남기지 않음** 권고).

### V2-04. 메모 출처 회차·분류·필터 — 미구현
- **코드:** 타입 `api.ts:349-357` / `backend/src/types/scaffold.ts:168-176` — `ScaffoldV2CaseNote {id, type: 'observation'|'question', text, sourceEvidenceIds: [], createdAt}`. 작성 `ScaffoldOverviewPage.tsx:380-401`(전역 작성란 1개, `case-note-<ts>-<rand>`), AI 채택 `:405-427`(`case-note-ai-<추천id>-<ts>`), 목록 `:786-797`(입력 순, "눈에 띈 점 N" 라벨). 서버 정규화 `routes/scaffold.ts:401-417, 451-456`(id 120자·텍스트 4000자, **최대 30개로 조용히 잘림**, `sourceEvidenceIds`는 알려진 근거 id만 유지).
- **현재:** 직접 쓴 메모에 회차·분류·출처 정보 **없음**. AI 채택 메모만 id 접두어로 회차 복원. 필터·정렬·그룹 없음. 1단계 화면에서 AI 채택/직접 구분 표시 없음(요약·연구 화면에만 "AI 추천에서 가져옴"). 수정은 자동 저장 안 됨(추가·삭제는 자동 저장).
- **필요:**
  - 데이터: `caseNotes[]`에 `visitIndex?: number`(없으면 미지정), `careItems?: string[]`(9a/9b/9c 등) 또는 `category?`, `origin: 'own'|'ai_suggestion'`, `suggestionId?`, `updatedAt?` 추가. **V1 메모는 이 필드가 없는 상태로 그대로 두고, 읽을 때 `origin`은 id 접두어로, `visitIndex`는 AI id에서만 유추(직접 메모는 "미지정")**. 임의 회차 부여 금지.
  - 서버: `normalizeV2CaseMap`에 새 필드 허용(whitelist 추가), 30개 제한 상향 또는 사용자에게 고지. export `scaffoldData.caseMap` skipKeys에 새 id/enum 필드 추가.
  - UI: 작성 시 회차 선택(기본값은 "현재 보고 있는 회차"를 자동 제안하되 사용자 확인 후 저장, 확실치 않으면 미지정), 메모 카드에 회차·분류 배지, 회차/분류/출처(직접·AI) 필터, 정렬(작성순·회차순), 카드에서 해당 회차로 점프(기존 `jumpToVisit` 재사용).
  - 섹션 페이지 미커밋 그룹화(`ScaffoldSectionPage.tsx:986-1008`)를 `visitIndex` 우선, id 접두어 fallback으로 바꿈.
- **난이도:** 중. **영향:** `caseMap` 쓰기 경로. V1 문서는 읽기만 하면 변하지 않지만, **V1 케이스를 V2 코드로 열어 메모를 저장하면** 새 필드가 추가되므로 연구자 다시 보기(읽기 전용)에서만 열어야 한다.

### V2-05. AI 추천 메모 수량·공개 방식 — 부분 구현
- **코드:** `defaultStudyCase.ts:296-305`(타입 `{id, visitIndex, type, text, careItem, recordAnchor}`), `:320-393`(12개: v1-1~v6-2, 질문 4·관찰 8, careItem 분포 5c·7·8a·9a·9c·10a·10b·10c), `routes/scaffold.ts:765-774`(고정 사례 판정 후 `{id, visitIndex, type, text}`만 전송 → **careItem·recordAnchor 제거**), 화면 `ScaffoldOverviewPage.tsx:722-751`(회차별 접힌 `<details>` "AI 메모 추천 N개", 열면 `memo_suggestion_opened` 이벤트), 채택 `:405-427`, 근거 문서 `docs/memo_suggestions_basis.md`.
- **현재:** **고정 데이터**(실시간 생성 아님, 2026-10-04 작성, 임상 전문가 검수 전). 요청 전에는 접혀 있어 "요청 시 공개"는 충족. 회차당 2개. 치료 개입(9a~9c) 관련은 v1-2(부분), v2-1, v3-2, v5-1, v5-2 **5개**, 나머지는 추적 관찰(10a~10c)·기타. 추천마다 회차는 있으나 CARE 항목·근거는 화면에 없음. 비고정 사례는 빈 배열.
- **수량 결정 근거(제안, 확정은 연구자):** 치료 개입만 실습하므로 추천의 관련성은 9a/9b/9c 중심으로 재구성한다. 재료는 이미 검수된 고정 자료에 있다 — `careElementMap` 치료 개입 inRecord 12항(회차 표시 포함), `recordPointers` ti_001~003 인용 18개(회차 포함). 이를 회차별로 배분하면 **회차당 3~4개, 총 18~24개**가 중복 없이 가능하다. 기존 12개 중 추적 관찰용 7개는 V2에서 숨기거나 "다음 항목용"으로 구분. 후보를 뽑아 중복·사실 확인(EMR 원문 대조)을 거친 뒤 개수를 확정하는 절차를 Phase 2 안에 둔다.
- **필요:** (1) 응답에 `careItem`(표시용 라벨 포함)·`recordAnchor`(회차+인용)·`targetSection` 전달, (2) V2용 추천 세트 상수(V1 상수는 그대로 보존, V1 데이터의 id 참조가 깨지지 않게 기존 id 유지), (3) "요청 시 공개" 유지 + 회차 안에서 1개씩 더 보기 방식(단계적 공개)으로 바꿀지 결정, (4) 카드에 회차·CARE·근거 표시, 선택 채택(기존 유지), (5) 채택 메모에 `origin:'ai_suggestion'`, `visitIndex`, `careItems` 자동 기록(V2-04와 연결).
- **난이도:** 중(데이터 검수 포함). **영향:** 고정 사례 판정(`isFixedStudyCaseText`)에 의존하므로 EMR 원문을 한 글자라도 바꾸면 추천·pointer·고정 초안이 모두 비활성화된다 — 원문 수정 금지.

### V2-06. EMR 탐색(검색·강조·이동·스크롤) — 미구현
- **코드:** `ScaffoldOverviewPage.tsx:699-757`(회차별 `<details open>` + `<pre>{soapText}`), `:704-710, 429-438`(회차 점프, `scrollTop` 직접 변경), `ScaffoldOverviewPage.css:284-303, 345-350, 696-698`(2열 grid, 방문 목록·메모 목록 각각 `overflow:auto` 중첩 스크롤, sticky 없음). 섹션 페이지 좌측 패널도 동일 구조(`ScaffoldSectionPage.tsx:1590-1709`). `Visit.structured`(S/O/A/P)는 타입만 있고 표시에 안 씀.
- **현재:** 검색·강조·결과 이동 없음. 메모→원문 이동 없음. 중첩 스크롤 2개 + 페이지 스크롤, 점프 바가 함께 스크롤되어 사라짐.
- **필요:** 검색 입력(개요·섹션 좌측 패널 공통 컴포넌트), 일치 구간 `<mark>` 렌더(원문은 그대로, 표시만 분할), 이전/다음 결과 이동 + "N/M", 결과가 있는 회차 자동 펼침, 점프 바·검색창 sticky, 메모 카드의 회차 점프(V2-04), 스크롤 컨테이너 1개로 정리 검토.
- **난이도:** 중. **영향:** 표시 전용. `visits` 데이터 불변. 검색어 로그는 남기지 않는 것을 기본으로 함.

### V2-07. 정보 충분성 판단 기준·이유 — 부분 구현
- **코드:** 질문 `ScaffoldSectionPage.tsx:176-192`(ti_001 치료 방법·약물·용량 / ti_002 시작 시점·기간·빈도 / ti_003 부작용·치료 변경), 선택지 `:396-401`(기록에서 확인 가능 `available_in_record` / 추가 확인 필요 `needs_additional_confirmation` / 교수자에게 확인 필요 `needs_instructor_review` / 현재 기록으로 확인할 수 없음 → 저장값 `unavailable`), 저장 `:1284-1318` → `PUT /scaffold/review-items/:itemId`(`{id:'<section>-custom-0-ti-001', sourceType:'custom', judgment, note: undefined, evidenceIds: []}`), 원문 보기 `:2241-2275`(판단 후 `<details>` "기록에서 관련된 부분 보기" + "맞고 틀림을 알려주는 것이 아닙니다"), 스냅샷 `routes/scaffold.ts:1242-1293`.
- **현재:** 선택지 의미 설명·예시 없음. **이유 입력란 없음**(`note` 전원 null — 1단계 보고서 §2-6). 정답 피드백 없음(요구 충족). 라벨이 요약/내보내기(`ScaffoldSummaryPage.tsx:41-51` "기록만으로 확인하기 어려움", "교수님께 확인")와 다름.
- **필요:** 선택지별 한 줄 설명 + 짧은 예시(현재 사례가 아닌 일반 예), 선택 후 "이유(선택)" textarea → `note`에 저장(기존 필드. 확인 결과 PUT review-items는 타입과 무관하게 `note`를 trim 후 저장하므로(`routes/scaffold.ts:1663, 1731`) 서버 변경 없이 바로 쓸 수 있음), 저장 시점은 blur/디바운스, 스냅샷 `reviewItemJudgments`에 `note` 포함되도록 `buildPreRevealSnapshot` 보강, 라벨 통일, 원문 보기에서 좌측 EMR 해당 회차로 점프(V2-06 연계).
- **난이도:** 하~중. **영향:** `reviewItems.note` 사용은 기존 필드라 V1 호환. 스냅샷 필드 추가는 새 문서에만 적용.

### V2-08. AI 초안 문장 검토 안내 — 부분 구현
- **코드:** 문장 분할 `scaffoldUi.ts:322-328`(서버 동일 `routes/scaffold.ts:998-1006`), 클릭 표시 `ScaffoldSectionPage.tsx:2366-2388, 1410-1432`, 판단 4종 `:381-386`(내 초안에 더하고 싶음 / 기록과 다름 / 기록만으로 확인하기 어려움 / 교수님께 확인), 이유 `:2434-2447`(`want_to_add` 외는 이유 또는 근거 필수), 근거 연결 `ScaffoldEvidenceSelector`, 저장 shape `routes/scaffold.ts:1725-1759`(`learningFeedback`은 저장만, 학습자 화면 미표시), 안내 `:2361-2365, 2395-2398`.
- **현재:** 안내 1문장("눌러서 표시… 다시 누르면 풀림"). 판단 유형 설명 없음. 이유 입력 위치는 표시 카드 안(문장과 카드가 떨어져 있어 연결이 약함). **미표시 문장은 레코드가 없고 수용으로 해석되지 않음**(요구 충족). 서버에는 `supported_by_record`·`uncertain` 판정값이 있으나 UI 미노출.
- **주의 — 게이트와의 충돌:** `studyConfig.studyMode=true`이면 완료 게이트 `allDraftJudgmentsSaved`가 **모든 문장에 판정을 요구**(`:1135-1167, 1954`)해 "의심 문장만 표시" UI와 맞지 않는다(V1은 studyMode가 꺼져 있어 드러나지 않았음). V2에서 게이트를 켜면 (a) 이 조건을 완료 게이트에서 빼거나, (b) 문장마다 "확인함(기록과 맞음)" 명시 선택을 두는 방식 중 택일(§7-2).
- **필요:** Step 머리에 3줄 사용법(표시 → 종류 선택 → 이유/근거), 판단 유형 설명 툴팁, 표시 문장에 번호를 붙이고 카드에 같은 번호 표시(연결 명확화), 카드에서 원문 회차 점프, 기존 공개 게이트·스냅샷 유지.
- **난이도:** 하~중. **영향:** 저장 shape 변경 없음.

### V2-09. 사후 회고 안내 — 부분 구현
- **코드:** `ScaffoldSectionPage.tsx:2545-2585`(문항 3개: "AI 초안에 빠진 내용이 있나요?(선택)" → `missingInDraft`, "내 초안과 AI 초안을 비교해 보니"(필수) → `changedJudgment`, "교수님께 확인하고 싶은 것(선택)" → `unresolvedQuestion`; `transferPlan`은 입력란 없음), 저장 `:1511-1519` → `sectionReflections[sectionId].postAiReflection`(완료 버튼 시 1회).
- **현재:** 요청서의 세 구분(내 초안 부족 / AI 초안 부족·의심 / 전문가 확인) 중 **"내 초안에서 부족한 것"이 "비교해 보니"라는 포괄 문항에 섞여 있다.** 참가자별·섹션별 저장은 충족. 완료 전 새로고침 시 입력 유실.
- **필요:** 문항 수 3개 유지하되 문구를 (1) 내 초안에서 빠졌거나 부족했던 것, (2) AI 초안에서 부족하거나 의심스러운 것, (3) 교수·전문가에게 확인할 것으로 **재정렬**(필드 매핑: `changedJudgment`→(1), `missingInDraft`→(2), `unresolvedQuestion`→(3)). V1 자료와 문항 의미가 달라지므로 분석 시 버전별로 해석해야 함을 버전 문서에 기록. 디바운스 자동 저장(완료 전 유실 방지) 추가.
- **난이도:** 하. **영향:** 필드 재사용이라 스키마 변경 없음. 의미 변화는 문서화 필수.

### 요약표

| 요구 | 상태 | 난이도 | 저장 구조 변경 | V1 데이터 영향 |
|---|---|---|---|---|
| V2-01 안내 | 부분 | 하 | 없음 | 없음 |
| V2-02 기준·예시 | 부분 | 중(검수) | 없음(프론트 상수) | 없음 |
| V2-03 크기 조절 | 미구현 | 중 | 없음 | 없음 |
| V2-04 메모 출처·필터 | 미구현 | 중 | `caseNotes` 필드 추가 + 정규화·export | 읽기만 하면 없음 |
| V2-05 추천 확대 | 부분 | 중(검수) | 응답 필드 추가, 상수 추가 | 없음(V1 상수·id 보존) |
| V2-06 EMR 검색 | 미구현 | 중 | 없음 | 없음 |
| V2-07 판단 이유 | 부분 | 하~중 | `note` 재사용 + 스냅샷 보강 | 없음 |
| V2-08 검토 안내 | 부분 | 하~중 | 없음(게이트 정책만) | 없음 |
| V2-09 회고 | 부분 | 하 | 없음(문항 의미 변경) | 해석 주의 |

## 4. 데이터 저장·버전·기존 시스템 보호 (요청서 §6)

### 4-1. V2 식별자가 없다
- 저장 위치 후보와 현재 상태:
  - `versionMetadata.scaffoldVersion`: 생성 시 `getVersionMetadata()`(`backend/src/config/researchMetadata.ts:12-19`, 기본 `'v2.0'`)에 **클라이언트가 보낸 `metadata.versionMetadata`를 덧씌움**(`routes/cases.ts:2326-2329`). 즉 프론트가 `scaffoldVersion: 'v3.0'`을 보내면 백엔드 변경 없이 저장·export(`researchExport.ts:538-541`, `ResearchHistoryPage`에 이미 표시)된다.
  - `studyConfig`: `normalizeStudyConfig`가 6개 키만 남김(`cases.ts:552-562`). 새 키는 잘림.
  - 최상위 새 필드: 스키마(`db/schema.ts`) + `CaseModel` 4개 메서드(`caseModel.ts:61-105, 155-199, 201-250, 252-297`) + export에 모두 추가해야 함.
- **권고:** `versionMetadata.scaffoldVersion`을 식별자로 쓰고(값은 §7-1에서 확정), 프론트 `CaseInputPage`가 라우터 state의 `scaffoldVersion`을 읽어 생성 요청에 넣는다. 화면은 `GET /scaffold` 응답에서 이 값을 읽어 V2 기능을 켠다(확인 결과 `buildScaffoldResponse`(`routes/scaffold.ts:730-780`)는 `studyConfig`·`experiment_code`는 돌려주지만 **`versionMetadata`는 포함하지 않음** → 1줄 추가 필요). 경로는 `/study/scaffold/*`를 그대로 쓰고(하드코딩 경로 10여 곳 수정 회피), 진입만 `/study/scaffold-v2`로 구분한다.

### 4-2. whitelist 정규화 — 새 필드는 등록해야 살아남는다
- `normalizeScaffoldState`(`routes/scaffold.ts:482-533`), `normalizeV2CaseMap`(`:419-474`, `version:'scaffold-v2'` 강제, 근거 5개·메모 30개 절단), reflection 항목별 재조립(`:2017-2101`). 모든 PUT이 전체 state를 다시 써서 저장하므로 미등록 필드는 다음 저장에서 사라진다.
- V2 필드 목록(안): `caseNotes[].visitIndex/careItems/origin/suggestionId/updatedAt`, `reviewItems[custom].note`(기존), `preRevealSnapshots[].reviewItemJudgments[].note`, 추천 채택 기록(`memo_suggestion_added` 이벤트 기존 + 메모 `suggestionId`), 선택적으로 `sectionReflections[].uiLayout`은 **저장하지 않음** 권고.
- export(`researchExport.ts:441-515`)의 `caseMap` sanitizer skipKeys에 새 id/enum 키 등록 필요. `exports/student_study_2026-10/scripts/extract_student_study.ts`는 V1 전용 필터(S코드·날짜)라 V2 영향 없음.

### 4-3. 공개 게이트 정책 결정이 필요하다
- 현재 V1 경로: `studyConfig=null` → 서버 게이트 미적용. 프론트 조건만으로 진행(내 초안만 있으면 Step 1 완료, `ScaffoldSectionPage.tsx:886-893`). 스냅샷은 studyMode와 무관하게 항상 생성(`:1910-1945`).
- 게이트를 켜려면(`studyConfig.studyMode=true`): `POST /cases/study/start` 경로 사용 또는 생성 시 studyConfig 전달. 그러면 (a) `evaluateStudyRevealGate`(`:1074-1133`)가 `section_purpose_viewed` 이벤트 + 근거 선택/핵심정보/근거없음 확인 중 하나 + 충분성 3문항 저장을 요구 — **`learnerNotes`(내 초안)를 인정하지 않아** 초안만 쓴 학습자는 409. 조건에 `learnerNotes` 추가 필요. (b) 완료 게이트가 전 문장 판정을 요구(V2-08). (c) `sectionStates` 블랭크, `CHAIN3_STUDY_REVEAL` 생성 경로 활성(고정 초안이 있으면 생성 안 함) 등 부수 효과.
- **권고:** V2는 게이트를 켜되 (a)(b) 두 조건을 V2 요구에 맞게 수정. V1 경로(`/study/scaffold`)는 건드리지 않음.

### 4-4. AI 초안 사전 노출 경로
- 숨김: `GET /scaffold`(미공개 섹션 초안 제거, `:566-580`), `GET /:id/sections/:sectionId`(`currentDraft` 블랭크).
- 노출: `careElementMap`은 공개 전에도 `GET /scaffold` 응답에 포함(`:776-778`), `GET /api/cases/:id`·`/summary`는 `sectionDrafts`/`draftsBySection` 그대로 반환(`cases.ts:3514-3560`), `RESEARCH_EXPORT_TOKEN` 미설정 시 export 공개(`:2999-3012`). 일반 사용자는 화면에서 볼 수 없으나 개발자 도구로는 가능. 교수 평가(연구자 입회)에서는 위험이 낮으므로 **V2 필수 범위 밖**, 선택 개선으로 분류.

### 4-5. 실험 코드 충돌 → V1 기록 오염 위험
- `experiment_code`는 unique partial index(`schema.ts:110-116`). 같은 모드에서 중복 코드면 409 + `resumeStage`를 돌려주고 `CaseInputPage.tsx:797-801`이 **기존 케이스로 이어서 하기**를 제안한다. V2 참가자가 `S1`~`S10`, `S3-1`을 입력하면 V1 참가자 문서를 열어 쓸 수 있다.
- **권고:** V2 진입에서 코드 형식을 분리(예: 교수 `P01`, 후속 학생 `F01`)하고, V2 입력 화면에서 `^S\d+(-\d+)?$`는 거부. 추가로 V2 코드가 `scaffoldVersion`이 다른 기존 문서와 충돌하면 이어서 하기를 막는다.

### 4-6. 연구자 다시 보기(읽기 전용)의 쓰기 가능성
- 쓰기 요청은 클라이언트·서버(헤더 403)에서 막히지만 GET은 통과한다. `GET /:id/sections/:sectionId`는 **studyMode가 아닌 케이스**에서 `ensureAdequacyReview` → `updateCase`(chainCache·performance log 갱신, 캐시 미스 시 LLM 호출)를 수행할 수 있다(`routes/sections.ts:300-345, 711-720`). V1 11건은 studyMode가 아니므로 해당. 1단계 보고서 §5-8의 "재열람 이벤트 오염"과 별개로 **문서 본문이 바뀔 수 있는 경로**다. Phase 2 전 확인 권고(실제로 쓰기가 일어나는지는 미검증).

### 4-7. 기타
- localStorage 키 `research-participant-code`, `research-session-id:scaffold`를 V1·V2가 공유(`utils/research.ts`). 같은 기기에서 V1→V2 전환 시 세션 id 승계 가능 → V2 진입 시 모드 키 분리 또는 리셋.
- 이벤트 로그 cap 2000/4000, `sequenceIndex` 재사용 가능(`:1389, 1394`). V2에서 EMR 검색·리사이즈 이벤트를 추가하지 않으면 영향 없음.
- 쓰기 직렬화는 프로세스 내 메모리 큐(`:57-77`)라 단일 인스턴스 가정(Render 배포 1인스턴스면 문제 없음).

## 5. 교수 평가 실습 범위(치료 개입만) 반영 지점

| 위치 | 현재 | V2 필요 |
|---|---|---|
| `utils/scaffoldUi.ts:217` `STUDY_SECTION_IDS` | TI, FOLLOW_UP_OUTCOMES | V2에서는 TI만(버전별 상수 분기) |
| `ScaffoldSectionPage.tsx:1542-1552` | 완료 1초 후 다음 섹션(추적 관찰) 자동 이동 | TI 완료 후 요약으로 이동 |
| `:2622-2633` "다음 항목" 버튼 | 공개 후 표시 | TI만이면 자동 숨김 |
| `ScaffoldOverviewPage.tsx:1021-1046` 섹션 목록 | 2개 | 1개 |
| `ScaffoldProgressHeader`, `ReadOnlyStageNavigator.tsx:153-155`, `ScaffoldSessionRecord.tsx:197` | `STUDY_SECTION_IDS` 참조 | 같은 상수 분기로 함께 반영 |
| 섹션 `completedAt` | 4개 플래그 모두 true일 때만 | 유지(미수행 섹션은 완료로 집계되지 않음 — 현재도 충족) |
| 세션 `completedAt` / `session_completed` | 12개 섹션 모두 완료 필요 → 실험에서는 절대 발생 안 함 | V2에서는 "실습 대상 섹션 모두 완료"로 조건 변경 검토(세션 종료 시각 확보) |

## 6. 구현 순서 제안 (Phase 2)

| 단계 | 내용 | 난이도 | 선행 조건 |
|---|---|---|---|
| A. 기반 | V2 식별자 저장·판독(§4-1), 코드 형식 분리(§4-5), V1·V2 localStorage 키 분리, `STUDY_SECTION_IDS` 버전 분기(§5), 게이트 정책 적용(§4-3), 저장 필드 등록(정규화·export·프론트 타입, §4-2), 버전 문서 초안(`docs/scaffold_v2_changelog.md`) | 중 | §7-1, 7-2 결정 |
| B. 기록 읽기 단계 | V2-04 메모 회차·분류·필터 → V2-05 추천 세트 재구성(후보 추출 → 연구자 검수 → 확정) + 카드 정보 표시 → V2-06 검색·강조·이동·sticky | 중 | A, §7-4 검수 |
| C. 작성 단계 | V2-07 선택지 설명·이유 입력·스냅샷 보강 → V2-02 예시 데이터(검수) + 기준 박스 접기/고정 → V2-03 분할선 리사이즈 | 중 | A, §7-3 결정 |
| D. 공개 후 | V2-08 안내·번호 연결·게이트 조건 → V2-09 문항 재정렬·자동 저장 | 하~중 | A |
| E. 안내 전체 | V2-01 intro·단계별 안내 문구(기능이 확정된 뒤 작성해야 문구가 맞음) | 하 | B~D |
| F. 검증 | 요청서 §7 16항 E2E(테스트 코드 사용: 신규 V2 코드로 치료 개입 1회 완주, 새로고침 복원, V1 11건 해시 불변 확인, Write 모드 회귀), 기존 테스트 `npm run test:study`, `test:research-export` 실행 | 중 | A~E |

V1 데이터 불변 검증 방법: 개발 시작 전 `exports/student_study_2026-10/00_raw` 고정본(sha256 보유)과 개발 후 DB의 11건을 다시 비교. 단, §4-6 경로를 먼저 닫지 않으면 연구자 다시 보기만으로도 달라질 수 있다.

## 7. Phase 2 착수 전 연구자 결정 필요 사항

1. **버전 값과 표기.** `versionMetadata.scaffoldVersion`에 넣을 값(제안: `'v3.0'`, 문서에 "연구 V2 = 시스템 v3.0") 또는 `'study-v2'` 같은 문자열. 화면 kicker "Scaffold v2"를 V2에서 어떻게 표기할지.
2. **공개 게이트.** V2에서 서버 게이트를 켤지(권고: 켬 + `learnerNotes` 인정 + 완료 게이트에서 전 문장 판정 요구 제거). 문장 검토에 "확인함(기록과 맞음)" 명시 선택지를 추가할지(미표시=수용 해석 금지 원칙과의 관계).
3. **V2-02 예시 범위.** §3 V2-02의 선택지 1~3 중 조합. 특히 9c(치료 변경)를 현재 사례로 줄지.
4. **V2-05 추천 세트.** 치료 개입 중심 재구성에 동의하는지, 추적 관찰용 7개를 V2에서 숨길지, 후보 검수 주체(연구자/임상 교수)와 시점. 공개 방식을 현행(회차별 접힘)으로 유지할지, 회차 안에서 1개씩 추가 공개로 바꿀지.
5. **V2-09 문항 재정렬**로 V1과 문항 의미가 달라지는 것을 수용하는지(필드는 재사용).
6. **코드 형식.** 교수·후속 학생 실험 코드 접두어(§4-5). 후속 학생이 V1 코드와 연결되어야 한다면 매핑 방식(별도 표 vs `studyMetadata.priorCode`).
7. **행동 로그 범위.** 리사이즈·검색·필터 사용을 `interactionEvents`에 남길지(연구계획서상 단순 행동 로그 미수집 — 기본 권고: 남기지 않음).
8. **§4-6 읽기 전용 GET 쓰기 경로**를 Phase 2 범위에 넣어 닫을지.
9. **미커밋 Write 변경(§1-3)** 처리 순서(V2 작업 전 별도 커밋 권고).

## 8. 조사 방법·한계

- 코드 읽기만 수행(세 영역 병렬 조사 후 핵심 지점은 직접 재확인: `cases.ts` 생성 경로·studyConfig, 고정 초안 원문, careElementMap, recordPointers, 테스트 스크립트 목록).
- DB는 열지 않았다. V1 데이터 사실은 1단계 보고서·addendum·`exports/` 고정본 설명에 의존한다.
- `GET /:id/sections/:sectionId`의 실제 쓰기 발생 여부(§4-6)는 Phase 2 초기에 실행으로 확인한다. `buildScaffoldResponse`의 `versionMetadata` 미포함(§4-1)과 `custom` reviewItem의 `note` 보존(§3 V2-07)은 코드로 확인했다.
- 예시·추천 메모의 "직접 작성 형식화" 영향 평가는 V1 자료 비교로 가능하지만 이번 범위 밖이다.
