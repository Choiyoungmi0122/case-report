# Scaffold V2 변경 이력 (버전 관리 문서)

- 연구에서 "Scaffold V2"로 부르는 교육용 Scaffold의 **시스템 버전 값은 `scaffoldVersion: 'v3.0'`** 이다.
  학생 V1(S1~S10, 2026-10-05~08) 기록이 이미 `scaffoldVersion 'v2.0'`, `caseMap.version 'scaffold-v2'`로 저장되어 있어 "v2"라는 값을 다시 쓸 수 없다. 코드·DB·내보내기에서 `v3.0`을 보면 연구 V2다.
- 분석 기준 문서: `docs/scaffold_v2_phase1_analysis.md`(Phase 1), 요청서는 연구자 보관.
- 원칙: 학생 V1 문서(`experiment_code` `^S\d+(-\d+)?$`)는 읽기만 하며 수정·마이그레이션하지 않는다. Write 모드는 수정하지 않는다. 교수 평가용 V2를 고정한 뒤에는 학습 흐름이 달라지는 수정을 하지 않는다.

## 적용 시점과 고정 상태

| 날짜 | 상태 | 내용 |
|---|---|---|
| 2026-10-11 | 개발 중 (A단계) | 기반: 버전 식별자, V2 진입 경로, 섹션 범위, 공개 게이트 정책, 저장 필드, V1 보호 |
| 2026-10-11 | 개발 중 (B단계) | 기록 읽기 단계: 메모 출처·분류·필터(V2-04), 치료 개입 중심 추천 22개(V2-05), EMR 검색·강조·이동(V2-06) |
| (예정) | C~E단계 | 작성(V2-07/02/03) → 공개 후(V2-08/09) → 안내(V2-01) |
| (예정) | 교수 평가용 고정 | 고정 커밋 해시와 날짜를 여기에 적는다. 이후 평가 중 흐름 변경 금지 |

## A단계 (2026-10-11) — 기반

### 진입과 식별
- 첫 화면 "실험용 Scaffold V2 시작" → `/study/scaffold-v2`(실험번호 입력) → `/study/scaffold-v2/input`(기록 입력). 이후 화면은 V1과 같은 `/study/scaffold/cases/:caseId/...` 경로를 쓰고, **케이스에 저장된 `versionMetadata.scaffoldVersion`으로 V2 여부를 판단**한다(`frontend/src/utils/scaffoldVersion.ts`, `backend/src/config/researchMetadata.ts`).
- 케이스 생성 요청에 `versionMetadata.scaffoldVersion = 'v3.0'`과 `studyConfig.studyMode = true`를 함께 보낸다. `GET /cases/:id/scaffold` 응답에 `versionMetadata`가 추가됐다.
- 실험번호 입력 화면 제목이 "Study Scaffold V2"로 바뀌고 안내 문구가 "치료 개입 항목 하나" 실습임을 알린다.

### 공개 게이트 (V1과 다른 점)
- V1 학생 세션은 `studyConfig`가 비어 있어 서버 게이트가 꺼진 채 진행됐다. V2는 `studyMode=true`로 게이트를 켠다.
- 게이트 조건 수정(V2 케이스에만 적용):
  - AI 공개 전 활동으로 **내 초안(`learnerNotes`) 작성**을 인정한다(경로 `own_draft`). V1 게이트는 근거 선택·핵심 정보·"관련 근거 없음" 확인만 인정했다.
  - 섹션 완료 조건에서 **모든 AI 문장에 판정을 요구하지 않는다**(`requireAllDraftJudgments=false`). "의심되는 문장만 표시" 방식이며, 표시하지 않은 문장은 수용으로 해석하지 않고 레코드도 만들지 않는다.
  - 그 외(`section_purpose_viewed` 이벤트, 충분성 3문항 저장, 공개 전 스냅샷 1회 생성·불변, 회고 필수 1문항)는 V1과 같다.

### 섹션 범위
- V2 케이스의 실습 섹션은 `THERAPEUTIC_INTERVENTIONS`만(`STUDY_SECTION_IDS_V2`). 개요 목록, 다음 항목 이동, 진행 헤더, 연구자 다시 보기, 연구 기록 화면이 모두 이 목록을 쓴다. V1 케이스는 기존 2개(치료 개입, 추적 관찰 및 결과) 그대로.
- 세션 `completedAt`: V2는 실습 대상 섹션이 모두 완료되면 채워진다(V1은 12개 섹션 전부를 요구해 실험에서는 채워지지 않았다).

### 저장 필드 (새 문서에만 생김, V1 문서 불변)
- `scaffoldState.caseMap.caseNotes[]`: `visitIndex?`(1부터), `careItems?`(9a/9b/9c 등), `origin?`('own' | 'ai_suggestion'), `suggestionId?`, `updatedAt?`. 값이 없으면 키를 넣지 않는다. 메모 상한 30 → 100.
- `preRevealSnapshots[].reviewItemJudgments[].note?`: 충분성 판단 이유(선택 입력). 이유가 없으면 키 없음.
- 연구 export의 `caseMap` sanitizer skipKeys에 `origin`, `suggestionId`, `careItems` 추가(코드 값이라 비식별 처리 대상이 아님).
- 화면 입력란(회차 선택·분류·이유)은 B·C단계에서 붙인다. A단계에서는 저장·정규화·내보내기 경로만 열어 두었다.

### 기존 데이터 보호
- V2 진입에서 학생 V1 코드 형식(`S1`, `S3-1` …)을 거부한다(화면과 서버 모두). 같은 코드로 만들면 unique 충돌 뒤 "이어서 하기"가 V1 참가자 문서를 열어 쓰게 되기 때문이다.
- 같은 코드가 **다른 Scaffold 버전**의 기존 케이스와 겹치면 409를 돌려주되 `existingCaseId`를 주지 않아 이어서 하기 버튼이 뜨지 않는다(`versionConflict: true`).
- localStorage 세션 키를 `research-session-id:scaffold-v2`로 분리해 같은 기기의 V1 세션 id를 물려받지 않는다.
- 연구자 "다시 보기(읽기 전용)"의 `GET /cases/:id/sections/:sectionId`가 비연구 케이스(V1 학생 11건 포함)에서 적정성 검토 캐시·성능 로그를 갱신하던 쓰기 경로를 닫았다. 읽기 전용 헤더가 있으면 저장된 검토만 돌려준다.

### 검증 (A단계 시점)
- `npm run test:study`에 V2 게이트·메모 필드·스냅샷 note 단언을 추가해 통과. `test:research-export`, `test:research-session` 통과. 프론트·백엔드 `tsc` 통과.
- 실제 V2 케이스 생성 → 치료 개입 완주 → 새로고침 복원 → V1 11건 불변 확인은 F단계(E2E)에서 수행한다.

## B단계 (2026-10-11) — 기록 읽기 단계 (V2 케이스 화면에만 적용, V1 화면 불변)

### V2-04 메모 출처·분류·필터 (`frontend/src/components/scaffold/CaseNotesV2.tsx`)
- 메모 작성란에 **회차 선택**(기본 미지정)과 **관련 항목**(9a 치료 종류 / 9b 용량·기간·빈도 / 9c 치료 변경·이유, 복수 선택) 추가. 방문 카드의 **"이 회차에 메모"** 버튼으로 회차를 지정하면서 작성란으로 이동한다. 회차를 자동으로 추정해 채우지 않는다.
- 메모 카드에 종류·출처(직접 쓴 메모 / AI 추천에서 가져옴)·회차 배지. 회차 배지 **"N회차 · 원문 보기"**를 누르면 그 회차로 이동하고, AI 추천에서 가져온 메모는 추천이 가리키는 구절을 강조한다. 카드에서 회차·항목을 바꾸면 즉시 저장, 글 수정은 1.5초 멈추면 자동 저장(V1은 버튼으로만 저장).
- 필터: 회차(전체/1~6/미지정), 항목(전체/9a/9b/9c/분류 없음), 출처(전체/직접/AI). 정렬: 작성순/회차순. 필터·정렬 상태는 저장하지 않는다.
- 저장 모양: 직접 메모 `{origin:'own', visitIndex?, careItems?}`, 채택 메모 `{origin:'ai_suggestion', suggestionId, visitIndex, careItems:[careItem]}`. 작성 화면(섹션 페이지)의 "읽으며 남긴 메모" 묶음은 `visitIndex`를 먼저 보고, 없으면(V1 메모) id 접두어로만 복원하며, 항목 태그를 `[9b]`처럼 함께 표시한다.

### V2-05 AI 추천 메모 (`backend/src/study/cases/defaultStudyCaseMemoSuggestionsV2.ts`, 근거 `docs/memo_suggestions_v2_basis.md`)
- V2 케이스에는 **치료 개입(9a/9b/9c) 전용 22개**(회차당 3~4개, id `ti-회차-번호`)를 내려준다. V1 케이스는 기존 12개를 기존 모양 그대로 받는다. 고정 데이터이며 세션 중 생성하지 않는다.
- 응답에 `careItem`, `careItemLabel`, `recordAnchor`(원문에 그대로 있는 구절), `targetSectionIds`가 추가된다. 카드에 CARE 배지와 **"원문에서 보기"**(해당 회차로 이동 + 구절 강조)가 붙는다. 공개 방식(회차별 접힘, 눌러야 보임)과 "내 메모에 추가"는 그대로다.
- `npm run test:study`가 22개 모두 **원문에 글자 그대로 있는 구절**을 가리키는지, 9a/9b/9c만인지, 회차당 3~4개인지 검사한다.
- **검수 전 상태.** 교수 평가용 고정 전에 연구자·임상 전문가 검수가 필요하다(근거 문서 §2, §5).

### V2-06 EMR 검색·강조·이동 (`frontend/src/components/scaffold/emrSearch.tsx`)
- 1단계 방문 기록 열과 섹션 페이지 왼쪽 원기록 패널에 **검색창**(부분 일치, 대소문자 무시), 일치 수 "N/M", 이전/다음(Enter/Shift+Enter), 지우기. 일치는 `<mark>`로 표시하고 현재 일치는 진하게. 회차 버튼·방문 제목에 회차별 일치 수 배지.
- 결과 이동 시 접힌 방문을 펼치고 목록 안에서 그 위치로 스크롤한다. 원문 데이터는 바꾸지 않고 표시만 나눈다.
- 1단계 방문 기록 열을 넓은 화면(900px 이상)에서 **화면에 고정(sticky)** 해 메모를 길게 써도 검색창·회차 버튼이 보인다. 좁은 화면은 기존 1열 배치.
- 검색어·필터·정렬·이동은 이벤트로 남기지 않는다. 기존 `visit_jump`(회차 이동)만 남고, 메모·추천에서의 이동은 같은 이벤트에 `source: 'memo' | 'suggestion'`이 붙는다.

### 검증 (B단계 시점)
- 로컬 개발 서버(백엔드 5066, 프론트 3066)에서 V2 케이스 `V2-DEV-01`을 만들어 확인: V1 코드(`S3`) 거부, 케이스에 `scaffoldVersion v3.0`·`studyMode true` 저장, 추천 22개 수신, 검색 7건·강조·이동, 추천 "원문에서 보기" 구절 강조, 추천 채택 메모의 회차·항목·출처 저장, 직접 메모(2회차·9b) 저장, 새로고침 후 복원, 출처 필터, 글 수정 자동 저장, 섹션 페이지 검색 13건과 회차별 메모 묶음. **이 테스트 케이스는 연구 DB에 남아 있다**(실험 코드 `V2-DEV-01`, 분석 필터 대상 아님).
- `tsc` 프론트·백엔드 통과, `npm run test:study` 통과.

## V1 자료와 함께 분석할 때 주의
- V1: `scaffoldVersion 'v2.0'`, 섹션 2개(추적 관찰은 연구자가 생략), 게이트 꺼짐, 메모에 회차·출처 필드 없음, 충분성 판단 이유 없음.
- V2: `scaffoldVersion 'v3.0'`, 섹션 1개, 게이트 켬(own_draft 인정), 메모 회차·분류·출처 있음(없으면 미지정), 판단 이유 선택 입력.
- V2-09 회고 문항 재정렬(D단계 예정)로 `postAiReflection` 세 필드의 의미가 V1과 달라진다. 적용 후 이 문서에 매핑을 적는다.
