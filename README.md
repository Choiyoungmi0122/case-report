# EMR 기반 증례보고(CARE) 작성 지원 도구

EMR(전자의무기록) 데이터를 기반으로 CARE(Case Report) 증례보고서 초안을 생성하고, 대화형 Q&A를 통해 보완하는 도구입니다.

## 주요 기능

1. **EMR 입력**: 텍스트 또는 파일 업로드로 EMR 데이터 입력
2. **방문 회차 관리**: 초진/재진을 포함한 다회 방문 기록 관리
3. **자동 비식별화**: 개인정보 자동 마스킹 및 치환
4. **섹션별 매핑**: EMR 정보를 CARE 섹션별로 자동 분류
5. **상태 판정**: 각 섹션의 초안 작성 가능성 자동 평가
6. **초안 생성**: EMR 기반 초안 자동 생성
7. **대화형 보완**: 부족한 정보를 질문-답변으로 수집하여 초안 보완

## 기술 스택

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + TypeScript
- **Database**: MongoDB
- **LLM**: OpenAI GPT-4 (structured output)

## 설치 및 실행

### 사전 요구사항

- Node.js 18+ 
- npm 또는 yarn
- MongoDB (로컬 또는 원격)
- OpenAI API Key

### 1. 환경 변수 설정

#### 1-1. backend/.env

백엔드 디렉토리에 `.env` 파일을 생성하세요.

```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=5000
MONGODB_URI=mongodb+srv://choiyoungmi2252_db_user:YOUR_PASSWORD@v1.cedix7t.mongodb.net/care?retryWrites=true&w=majority
STORE_ORIGINAL_TEXT=false
USE_MOCK=false
FAST_UPDATE_ONLY=true
REFRESH_QUESTIONS_ON_DEMAND=true
```

`FAST_UPDATE_ONLY=true`이면 질문 답변 직후 초안만 먼저 빠르게 갱신하고,
`REFRESH_QUESTIONS_ON_DEMAND=true`이면 다음 질문은 사용자가 다시 요청할 때 계산합니다.

**MongoDB 연결:**
- 로컬 MongoDB: `mongodb://localhost:27017/care`
- MongoDB Atlas: `mongodb+srv://username:password@cluster.mongodb.net/database_name?retryWrites=true&w=majority`
  - `YOUR_PASSWORD`를 실제 MongoDB Atlas 비밀번호로 교체하세요
  - 데이터베이스 이름은 `care`로 설정됩니다
- `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다

**Mock 모드 (LLM API 없이 테스트):**
- `USE_MOCK=true`로 설정하거나 `OPENAI_API_KEY`를 비워두면 Mock 데이터를 사용합니다.
- Mock 모드에서는 샘플 데이터로 전체 워크플로우를 테스트할 수 있습니다.
- 화면 구성과 UI 흐름을 확인하는 데 유용합니다.

### 2. MongoDB 설정

**로컬 MongoDB 설치 (Windows):**
```bash
# MongoDB Community Server 다운로드 및 설치
# https://www.mongodb.com/try/download/community

# 또는 Chocolatey 사용
choco install mongodb
```

**MongoDB 실행:**
```bash
# Windows 서비스로 실행되거나, 수동 실행:
mongod --dbpath C:\data\db
```

**또는 Docker 사용:**
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### 3. 백엔드 설정

```bash
cd backend
npm install
npm run dev
```

백엔드는 `http://localhost:5000`에서 실행됩니다.

### 4. 프론트엔드 설정

새 터미널에서:

```bash
cd frontend
npm install
npm run dev
```

프론트엔드는 `http://localhost:3000`에서 실행됩니다.

## 프로젝트 구조

```
casereport/
├── backend/
│   ├── src/
│   │   ├── llm/             # LLM 체인/프롬프트/스키마
│   │   ├── db/              # 데이터베이스 스키마
│   │   ├── models/          # 데이터 모델
│   │   ├── routes/          # API 라우트 및 route 유틸
│   │   ├── types/           # TypeScript 타입
│   │   └── index.ts         # Express 서버 진입점
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/           # 페이지 컴포넌트
│   │   ├── services/        # API 서비스
│   │   └── App.tsx
│   └── package.json
├── ai_server/               # 과거 Python 체인 구현 (현재 런타임 경로 아님)
└── README.md
```

## API 엔드포인트

### Cases

- `POST /api/cases` - 새 케이스 생성
- `GET /api/cases/:id` - 케이스 조회
- `POST /api/cases/:id/process` - 초기 처리 (evidence split -> section assessment -> initial drafts)
- `GET /api/cases/:id/sections` - 모든 섹션 조회
- `GET /api/cases/:id/common-questions` - 공통 질문 조회
- `POST /api/cases/:id/common-questions/answer` - 공통 질문 답변 반영
- `POST /api/cases/:id/final-compose` - 최종 manuscript 생성/갱신

### Sections

- `GET /api/cases/:id/sections/:sectionId` - 섹션 상세 조회
- `POST /api/cases/:id/sections/:sectionId/next` - 질문 생성/답변 반영(Q&A 1 step)

## CARE 섹션

다음 12개 섹션을 지원합니다:

- TITLE (제목)
- ABSTRACT (요약)
- INTRODUCTION (서론)
- PATIENT_INFORMATION (환자 정보)
- CLINICAL_FINDINGS (임상 소견)
- TIMELINE (타임라인)
- DIAGNOSTIC_ASSESSMENT (진단 평가)
- THERAPEUTIC_INTERVENTIONS (치료 개입)
- FOLLOW_UP_OUTCOMES (추적 결과)
- DISCUSSION_CONCLUSION (토론 및 결론)
- PATIENT_PERSPECTIVE (환자 관점)
- INFORMED_CONSENT (동의)

## 섹션 상태

각 섹션은 다음 5가지 상태 중 하나로 판정됩니다:

- **IMPOSSIBLE**: EMR만으로 섹션 구조 자체 불가
- **PARTIAL_IMPOSSIBLE**: EMR로 일부 가능하지만 추가정보 50% 이상 필요
- **PARTIAL_POSSIBLE**: EMR로 50% 이상 가능, 소수 질문으로 보완
- **POSSIBLE**: EMR로 구조는 가능하나 상세/정확성 보강 필요
- **FULLY_POSSIBLE**: EMR만으로 CARE 필수항목 수준 초안 생성 가능

## LLM API 없이 가능한 단계

**LLM API 없이 가능한 단계:**
- ✅ **1단계: EMR 입력 및 케이스 생성** - 비식별화는 코드로 처리되므로 완전히 가능
- ❌ **초기 처리/질문 답변/최종 원고 생성**: 모두 OpenAI 호출이 필요
- ✅ **Python ai_server / uvicorn 실행**: 더 이상 필요하지 않음

**Mock 모드 사용:**
- `USE_MOCK=true` 설정 시 모든 LLM 체인이 Mock 데이터를 반환합니다.
- 전체 워크플로우와 화면 구성을 확인할 수 있습니다.
- 실제 LLM API 없이도 프론트엔드와 백엔드 통합 테스트가 가능합니다.

## 워크플로우

전체 프로세스는 다음과 같은 단계로 진행됩니다:

### 1단계: EMR 입력 및 케이스 생성

**사용자 액션:**
- 방문 기록 추가 (초진/재진)
- 각 방문의 날짜/시간 입력
- SOAP 텍스트 입력
- "제출 및 처리" 버튼 클릭

**백엔드 처리:**
- `POST /api/cases` - 케이스 생성
  - 입력된 EMR 텍스트 비식별화 처리 (이름, 주민번호, 전화번호, 주소, 병원명, 의료진 정보 마스킹)
  - MongoDB에 케이스 저장
  - `caseId` 반환

**데이터 흐름:**
```
사용자 입력 (원본 EMR)
  ↓
비식별화 처리 (sanitizeEmrText)
  ↓
MongoDB 저장 (sanitizedText만 저장)
  ↓
caseId 반환
```

### 2단계: 자동 처리 (backend TS chains)

**사용자 액션:**
- 자동으로 실행됨 (케이스 생성 직후)

**백엔드 처리 (`POST /api/cases/:id/process`):**
- `runEvidenceSplit()` - 방문 기록을 evidence card로 분해
- `runSectionAssessment()` - 각 섹션의 상태/누락 정보/권장 질문 계산
- `runInitialSectionDrafts()` - 섹션별 초기 초안 생성
- 결과 저장:
  - `sectionDrafts` = 초안 원본
  - `sectionStates` = 상태/질문 원본
  - `evidenceCards` = evidence 원본

**데이터 흐름:**
```
비식별화된 EMR
  ↓
Evidence split
  ↓
Section assessment
  ↓
Initial section drafts
  ↓
MongoDB 업데이트
  ↓
섹션 목록 화면 표시
```

### 3단계: 섹션 목록 확인

**사용자 액션:**
- 섹션 목록 페이지에서 각 섹션의 상태 확인
- 초안 미리보기 확인
- 섹션 클릭하여 상세 페이지로 이동

**백엔드 처리:**
- `GET /api/cases/:id/sections` - 모든 섹션 정보 조회

**표시 정보:**
- 섹션명
- 상태 배지 (색상으로 구분)
- 판정 근거
- 초안 미리보기 (200자)

### 4단계: 섹션 상세 보완 (Q&A 반복)

**사용자 액션:**
- 섹션 상세 페이지에서 현재 초안 확인
- "질문 시작" 버튼 클릭
- 질문에 답변 입력
- 답변 제출

**백엔드 처리:**

#### 질문 조회
- `POST /api/cases/:id/sections/:sectionId/next`
- 현재 `sectionStates.recommendedQuestions`, `missingInfoBullets`, `qnaHistory`를 바탕으로 다음 질문을 계산/표시

#### 답변 제출 및 초안 업데이트
- `POST /api/cases/:id/sections/:sectionId/next`
- **입력**: 사용자 답변, 현재 초안, 현재 섹션 evidence, 최근 Q&A, 남은 부족 항목
- **처리**:
  1. Q&A 히스토리에 답변 추가
  2. fast local section update로 현재 섹션 초안 우선 갱신
  3. 필요 시 사용자가 다시 "다음 질문 보기"를 눌렀을 때 질문을 재조회
- **출력**: 업데이트된 초안, 남은 부족 항목, 필요 시 다음 질문
- **특징**: 전체 문서 재계산보다 partial update를 우선하여 즉시 반영 속도를 개선

#### 공통 질문 답변
- `POST /api/cases/:id/common-questions/answer`
- 질문과 관련된 섹션만 골라 multi-section fan-out update 수행

**반복 프로세스:**
```
질문 조회
  ↓
사용자 답변 입력
  ↓
초안 빠른 업데이트
  ↓
완료 여부 확인
  ↓
[미완료] → 필요 시 다음 질문 다시 조회
[완료] → 종료
```

**중요 규칙:**
- 사용자가 제공하지 않은 정보는 절대 추가하지 않음
- 외부 의학지식으로 메우지 않음
- 문장 연결/형식 정리만 허용
- 현재는 backend local LLM chain이 draft update를 수행

### 5단계: 최종 검토 및 완성

**사용자 액션:**
- 모든 섹션의 초안 확인
- 필요시 추가 질문-답변 반복
- 최종 초안 완성

**데이터 저장:**
- 초안 원본: `sectionDrafts`
- 상태/질문 원본: `sectionStates`
- Q&A 히스토리: `section_interactions` 컬렉션
- 최종 manuscript: `finalDraft`
- `draftsBySection`은 응답용 derived/cache 필드

## 전체 워크플로우 다이어그램

```
[사용자] EMR 입력
    ↓
[백엔드] 비식별화 → 케이스 생성
    ↓
[백엔드] Evidence split
    ↓
[백엔드] Section assessment + initial drafts
    ↓
[사용자] 섹션 목록 확인
    ↓
[사용자] 섹션 선택
    ↓
[반복]
    ├─ [백엔드] 질문 조회
    ├─ [사용자] 답변 입력
    ├─ [백엔드] fast local draft update
    └─ [완료 여부 확인]
         ├─ 미완료 → 다음 질문
         └─ 완료 → 종료
```

## 사용 방법

1. **EMR 입력**: 메인 페이지에서 방문 기록을 추가하고 SOAP 텍스트를 입력합니다.
2. **처리**: "제출 및 처리" 버튼을 클릭하여 자동 처리합니다.
3. **섹션 확인**: 섹션 목록에서 각 섹션의 상태와 초안 미리보기를 확인합니다.
4. **상세 보완**: 섹션을 클릭하여 상세 페이지로 이동하고, 질문에 답변하여 초안을 보완합니다.
5. **최종 원고 검토**: "최종 원고 보기" 화면에서 전체 manuscript를 검토하고 필요한 섹션으로 다시 이동합니다.

## 비식별화 규칙

다음 정보가 자동으로 마스킹됩니다:

- 이름 (한글 2~4자) → `[NAME]`
- 주민번호/식별번호 → `[ID]`
- 전화번호 → `[PHONE]`
- 주소 → `[ADDRESS]`
- 병원/기관명 → `[HOSPITAL]`
- 의료진 이름/서명 → `[CLINICIAN]`

## 주의사항

- **Hallucination 방지**: LLM이 사용자가 제공하지 않은 정보를 추가하지 않도록 prompt/structured output 기반 제약을 둡니다.
- **데이터 보안**: 기본적으로 원본 텍스트는 저장하지 않습니다 (`STORE_ORIGINAL_TEXT=false`).
- **API 비용**: OpenAI API 사용량에 따라 비용이 발생할 수 있습니다.
- **Python ai_server**: 현재 메인 런타임 경로에서는 사용하지 않습니다. `uvicorn` 실행은 필요 없습니다.

## 라이선스

ISC
