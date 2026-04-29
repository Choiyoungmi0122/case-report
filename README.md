# CARE 증례보고 초안 작성 시스템

이 프로젝트는 SOAP 형식의 EMR을 입력받아 CARE guideline 기반 증례보고 초안을 생성하고,  
부족한 정보를 AI 질문과 사용자 답변으로 보완한 뒤, 최종 논문 형태의 초안까지 만드는 시스템입니다.

## 프로젝트 목표

핵심 흐름은 다음과 같습니다.

```text
EMR 입력
-> CARE 섹션 초안 생성
-> 부족한 정보 탐지
-> AI 질문 생성
-> 답변 반영
-> 최종 논문 초안 생성
```

즉, 이 시스템은 단순 요약기가 아니라 다음을 지원합니다.

- 임상 기록 기반 초안 작성
- CARE guideline 관점의 누락 정보 점검
- 공통 질문 / 섹션 질문 분리
- 반복적 보완
- 최종 manuscript draft 생성

## 현재 아키텍처

```text
Frontend (React + Vite)
  ->
Backend (Node.js + Express + TypeScript + MongoDB)
  ->
OpenAI structured-output calls
```

참고:

- 과거의 `ai_server` Python 경로는 현재 메인 실행 경로가 아닙니다.
- 현재 파이프라인은 `backend/src/llm` 안에서 동작합니다.
- 이 시스템은 외부 문헌 검색형 RAG보다는, 단계별 상태를 넘겨가며 처리하는 staged LLM pipeline에 가깝습니다.

## 시스템이 하는 일

- 여러 방문의 EMR 입력 받기
- SOAP 텍스트에서 atomic evidence 추출
- CARE 섹션별 narrative draft 생성
- 누락 정보 탐지
- AI 질문 생성
- 답변을 반영해 draft 갱신
- 최종 원고 생성
- 제목 후보, 초록, CARE checklist 평가 제공

## 전체 워크플로우

### 1. 입력

사용자는 보통 SOAP 형식의 EMR을 방문 단위로 입력합니다.

예시:

```text
S: 주호소, 증상, 병력, 환자 진술
O: 진찰 소견, 활력징후, 검사 결과
A: 평가, 진단, 변증
P: 치료, 교육, 추적 계획
```

### 2. 초기 처리

케이스를 처리하면 백엔드에서 다음 체인이 실행됩니다.

1. `Chain1` Extraction
2. `Chain2` Section Assessment
3. `Chain3` Initial Draft
4. `Chain4` Missing Detection
5. `Chain5` Question Generation

### 3. 반복 보완

사용자가 질문에 답하면 다음 흐름으로 동작합니다.

1. `Chain6` Draft Update
2. `Chain4` Missing 재계산
3. `Chain5` Question 재계산

### 4. 최종 원고 생성

본문 섹션이 충분히 보완되면 다음 체인이 실행됩니다.

1. `Chain7` Final Composition

이 단계에서 다음 결과를 만듭니다.

- 최종 섹션별 원고
- 제목 후보
- 초록 제안
- CARE checklist 평가

## 체인 구조

### Chain1: Extraction

역할:

- SOAP 기반 EMR을 atomic evidence card로 분해
- 각 evidence를 CARE 섹션 태그에 연결

원칙:

- hallucination 금지
- 근거 없는 추론 금지
- source text grounding 유지

### Chain2: Section Assessment

역할:

- 현재 evidence만으로 각 코어 섹션이 어느 정도 작성 가능한지 판단

상태:

- `IMPOSSIBLE`
- `INCOMPLETE`
- `READY`

### Chain3: Initial Draft

역할:

- evidence를 바탕으로 CARE 섹션별 초안 문단 생성

특징:

- JSON 느낌이 아니라 서술형 문단 생성
- 섹션 목적에 맞는 문체 유지
- 없는 정보 추가 금지

### Chain4: Missing Detection

역할:

- 현재 초안 기준으로 CARE 작성에 필요한 missing item 탐지

출력:

- `sectionMissing`
- `commonMissing`

의미:

- `sectionMissing`: 특정 섹션만 보완하는 정보
- `commonMissing`: 한 답변이 여러 섹션에 같이 반영될 정보

### Chain5: Question Generation

역할:

- missing item을 의사가 답할 수 있는 자연스러운 질문으로 변환

출력:

- `commonQuestions`
- `sectionQuestions`

UI 연결:

- 왼쪽: 공통 질문
- 오른쪽: 섹션 질문

### Chain6: Draft Update

역할:

- 질문, 답변, 현재 draft, evidence, Q&A history를 기반으로 섹션 draft 갱신

### Chain7: Final Composition

역할:

- 현재까지의 section draft를 바탕으로 최종 원고 조합

출력:

- `fullTextBySection`
- `titleSuggestions`
- `abstractSuggestion`
- `careChecklistEvaluation`

## CARE 섹션 전략

### 질문 단계 섹션

이 섹션들은 질문/답변으로 직접 보완됩니다.

- `PATIENT_INFORMATION`
- `CLINICAL_FINDINGS`
- `TIMELINE`
- `DIAGNOSTIC_ASSESSMENT`
- `THERAPEUTIC_INTERVENTIONS`
- `FOLLOW_UP_OUTCOMES`
- `PATIENT_PERSPECTIVE`

### 최종 자동 생성 섹션

이 섹션들은 UI에서 후반 자동 생성 섹션으로 다룹니다.

- `TITLE`
- `ABSTRACT`
- `INTRODUCTION`
- `DISCUSSION_CONCLUSION`
- `INFORMED_CONSENT`

참고:

- UI에서는 `KEYWORDS`도 최종 단계 섹션처럼 다루고 있지만,
  현재 백엔드 CARE enum/schema에는 아직 완전히 포함되어 있지 않습니다.

## 질문 시스템 원칙

역할 분리는 다음과 같습니다.

- Chain:
  - 생성
  - 추론
  - missing 탐지
  - 질문 생성
- Backend:
  - 저장
  - 상태 관리
  - 공통/섹션 질문 routing
- Frontend:
  - 표시
  - 답변 제출
  - 원고 검토 UI

중요:

- 질문 문구는 코드 템플릿이 아니라 AI 출력이 중심이어야 합니다.
- 공통 질문과 섹션 질문 분리는 파이프라인 설계의 일부입니다.

## 초안 source of truth

현재 메인 초안 원본은 다음입니다.

- `sectionDrafts`

UI 편의를 위한 파생 구조가 있을 수는 있지만,  
실제 draft 흐름은 백엔드의 `sectionDrafts`를 중심으로 돌아갑니다.

## 기술 스택

- Backend: Node.js, Express, TypeScript
- Frontend: React, Vite, TypeScript
- Database: MongoDB
- LLM: OpenAI Chat Completions structured JSON output
- Validation: Zod

## 프로젝트 구조

```text
casereport/
  backend/
    src/
      config/        # CARE rubric 설정
      db/            # DB schema
      llm/           # prompts, schemas, client, chains
      models/        # Mongo model layer
      routes/        # API routes
      types/         # backend types
      index.ts       # server entry
    scripts/         # 로컬 시뮬레이션 스크립트
  frontend/
    src/
      pages/         # 페이지 컴포넌트
      services/      # API layer
      utils/         # draft formatting helper
```

## 환경 설정

### 요구 사항

- Node.js 18+
- npm
- MongoDB 연결 문자열
- OpenAI API key

### backend `.env`

`backend/.env` 파일을 생성합니다.

예시:

```env
OPENAI_API_KEY=your_openai_api_key
LLM_MODEL=gpt-4.1
FAST_LLM_MODEL=gpt-4.1-mini
QUALITY_LLM_MODEL=gpt-4.1
PORT=5000
MONGODB_URI=mongodb://localhost:27017/care
```

필수:

- `OPENAI_API_KEY`
- `MONGODB_URI`

권장:

- `LLM_MODEL=gpt-4.1`
- `FAST_LLM_MODEL=gpt-4.1-mini`
- `QUALITY_LLM_MODEL=gpt-4.1`

설명:

- `FAST_LLM_MODEL`
  - `Chain1`, `Chain2`, `Chain4`, `Chain5` 기본 모델
- `QUALITY_LLM_MODEL`
  - `Chain3`, `Chain6`, `Chain7` 기본 모델
- 필요하면 `CHAIN1_MODEL`, `CHAIN3_MODEL`처럼 체인별 override도 가능합니다.

## 로컬 실행

### Backend

```powershell
cd ..\backend
npm install
npm run dev
```

기본 주소:

```text
http://localhost:5000
```

### Frontend

```powershell
cd ..\\casereport\frontend
npm install
npm run dev
```


## 빌드 및 타입 체크

### Backend

```powershell
cd backend
npm run type-check
npm run build
```

### Frontend

```powershell
cd frontend
npx tsc --noEmit
```

참고:

- Codex desktop 환경에서는 frontend 전체 Vite build가 `spawn EPERM`으로 실패할 수 있습니다.
- 이 경우 TypeScript가 통과했다면 코드 문제라기보다 실행 환경 제한일 가능성이 큽니다.

## API 개요

### Cases

- `POST /api/cases`
  - 케이스 생성
- `GET /api/cases`
  - 케이스 목록 조회
- `GET /api/cases/:id`
  - 케이스 단건 조회
- `POST /api/cases/:id/process`
  - 초기 파이프라인 실행
- `PATCH /api/cases/:id/title`
  - 케이스 제목 업데이트
- `DELETE /api/cases/:id`
  - 케이스 삭제
- `GET /api/cases/:id/common-questions`
  - 공통 질문 조회
- `POST /api/cases/:id/common-questions/answer`
  - 공통 질문 답변 반영
- `POST /api/cases/:id/final-compose`
  - 최종 manuscript 생성/갱신
- `GET /api/cases/:id/export`
  - 텍스트 파일 export

### Sections

- `GET /api/cases/:id/sections`
  - 섹션 overview 조회
- `GET /api/cases/:id/sections/:sectionId`
  - 섹션 detail 조회
- `POST /api/cases/:id/sections/:sectionId/next`
  - 다음 섹션 질문 상태 조회 또는 답변 제출

## 프론트 UX 요약

### Case Input

- 방문 기록 입력
- EMR 제출
- 케이스 처리

### Case Overview

- 질문 단계 섹션은 클릭 가능한 카드로 표시
- 최종 자동 생성 섹션은 별도 블록으로 표시

### Section Detail

- 가운데: 현재 narrative draft
- 왼쪽: 공통 질문
- 오른쪽: 섹션 질문
- 제목/초록/서론/토론 계열 섹션은 질문 단계 섹션으로 다루지 않음

### Final Manuscript

- 자동 생성 섹션과 본문 기반 섹션을 분리해서 표시
- 제목 후보 제공
- 추천 제목 선택 후 현재 케이스 제목으로 저장 가능

## 로컬 시뮬레이션 스크립트

유용한 파일:

- `backend/scripts/runSamplePipeline.js`
- `backend/scripts/sampleInput.hwa-byung.json`
- `backend/scripts/samplePipelineOutput.hwa-byung.json`

샘플 실행 예시:

```powershell
cd ..\casereport\backend
npm run build
node -r dotenv/config scripts/runSamplePipeline.js scripts/sampleInput.hwa-byung.json dotenv_config_path=.env
```

이 스크립트로 다음을 점검할 수 있습니다.

- evidence extraction 품질
- section draft 품질
- missing detection
- common vs section question 동작

## 현재 구현 메모

- 프롬프트 언어는 한국어 중심으로 조정했습니다.
  - 입력 EMR이 한국어
  - 사용자 질문이 한국어
  - draft prose가 한국어
- JSON key와 enum은 구현 안정성을 위해 영어를 유지합니다.
- CARE rubric은 backend config에서 관리하고, 후반 체인들에 주입됩니다.
- 제목 후보는 최종 단계에서 생성됩니다.
- 키워드는 UI 흐름에는 반영했지만, backend schema 지원은 아직 완전히 추가되지 않았습니다.

## 알려진 제약

- 전체 품질은 Chain1 grounding 품질에 크게 영향을 받습니다.
- extraction이 약하면 이후 draft와 question 품질도 함께 흔들립니다.
- PowerShell에서는 한글이 깨져 보일 수 있지만, 실제 파일 내용은 정상일 수 있습니다.
- 제목, 고찰 같은 섹션은 본문 보완 후 생성되므로 일반 질문 단계 섹션처럼 다루면 안 됩니다.

## 보안 주의

- `.env`는 commit 하지 마세요.
- 로그나 스크린샷에 비밀값이 노출되면 즉시 교체하세요.
- 실제 임상 데이터는 반드시 비식별화해서 사용하세요.

## License

ISC
