# CARE Case Report Writer

EMR 기록을 바탕으로 CARE guideline 형식의 증례보고 초안을 만들고, 부족한 정보를 질문과 검토 흐름으로 보완한 뒤 최종 manuscript draft까지 정리하는 웹 애플리케이션입니다.

## 구성

```text
frontend/  React + Vite + TypeScript
backend/   Node.js + Express + TypeScript + MongoDB
```

## 주요 기능

- 여러 방문의 SOAP 형식 EMR 입력
- 근거 카드(evidence) 추출
- CARE 섹션별 초안 생성
- 누락 정보 탐지 및 질문 추천
- 답변 반영 후 섹션 초안 갱신
- 최종 manuscript draft 생성
- DOCX 내보내기
- Scaffold 학습 모드 지원
- Manuscript review import 지원

## 실행 환경

- Node.js 20 권장
- npm
- MongoDB
- OpenAI API key

## 환경 변수

백엔드는 `backend/.env` 파일을 사용합니다.

```env
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=mongodb://localhost:27017/care
PORT=5000
HOST=0.0.0.0
LLM_MODEL=gpt-4.1
FAST_LLM_MODEL=gpt-4.1-mini
QUALITY_LLM_MODEL=gpt-4.1
```

배포 환경에서 추가로 쓸 수 있는 값:

```env
CORS_ORIGIN=https://your-frontend-domain.com
```

- `OPENAI_API_KEY`: 필수
- `MONGODB_URI`: 필수
- `CORS_ORIGIN`: 프론트와 백엔드를 서로 다른 도메인으로 분리 배포할 때 권장

프론트엔드는 기본적으로 같은 도메인의 `/api`를 사용합니다. 별도 API 주소를 쓰고 싶다면 프론트 빌드 시 아래 값을 설정할 수 있습니다.

```env
VITE_API_BASE_URL=https://your-api-domain.com/api
```

## 로컬 실행

### 1. 의존성 설치

```powershell
npm run install:all
```

### 2. 백엔드 실행

```powershell
cd backend
npm run dev
```

기본 주소:

```text
http://localhost:5000
```

### 3. 프론트엔드 실행

```powershell
cd frontend
npm install
npm run dev
```

기본 주소:

```text
http://localhost:3000
```

개발 환경에서는 Vite 프록시가 `/api` 요청을 백엔드 `http://localhost:5000`으로 전달합니다.

## 배포 방식

현재 프로젝트는 단일 서비스 방식으로 바로 배포할 수 있습니다.

- 프론트엔드를 빌드한 뒤
- 백엔드가 `frontend/dist` 정적 파일을 함께 서빙하고
- `/api/*` 요청은 같은 서버의 API 라우트가 처리합니다

이 방식의 장점:

- 프론트와 백엔드 도메인을 따로 맞출 필요가 거의 없음
- `VITE_API_BASE_URL` 없이도 동작 가능
- 운영 시 배포 구성이 단순함

## 배포용 스크립트

루트에서 아래 명령으로 한 번에 처리할 수 있습니다.

```powershell
npm run install:all
npm run build
npm run start
```

의미:

- `npm run install:all`: 프론트와 백엔드 의존성 설치
- `npm run build`: 프론트 빌드 후 백엔드 빌드
- `npm run start`: 백엔드 실행, 빌드된 프론트까지 함께 서비스

헬스체크:

```text
/health
```

## Render 배포

`render.yaml` 파일이 포함되어 있어 Render에서 바로 사용할 수 있습니다.

### Render에서 필요한 값

- `MONGODB_URI`
- `OPENAI_API_KEY`
- `PORT`
- `CORS_ORIGIN` (프론트/백엔드 분리 배포 시)

### Render 배포 순서

1. Git 저장소를 Render에 연결합니다.
2. Blueprint 또는 Web Service로 `render.yaml`을 읽게 합니다.
3. 환경 변수 `MONGODB_URI`, `OPENAI_API_KEY`를 설정합니다.
4. 배포가 끝나면 `/health`로 상태를 확인합니다.

단일 서비스 배포라면 보통 `CORS_ORIGIN`은 비워둬도 됩니다.

## 분리 배포 시 주의점

프론트와 백엔드를 다른 서비스에 올린다면:

- 프론트 빌드 시 `VITE_API_BASE_URL` 설정
- 백엔드에 `CORS_ORIGIN` 설정

예시:

```env
VITE_API_BASE_URL=https://api.example.com/api
CORS_ORIGIN=https://app.example.com
```

## 빌드 및 타입 체크

### 루트

```powershell
npm run type-check
npm run build
```

### 백엔드

```powershell
cd backend
npm run type-check
npm run build
```

### 프론트엔드

```powershell
cd frontend
npx tsc --noEmit
npm run build
```

## API 개요

주요 라우트:

- `GET /health`
- `POST /api/cases`
- `POST /api/cases/:caseId/process`
- `GET /api/cases/:caseId`
- `GET /api/cases/:caseId/sections/:sectionId`
- `POST /api/cases/:caseId/sections/:sectionId/review`
- `POST /api/cases/:caseId/final-compose`
- `POST /api/cases/:caseId/export-docx`
- `GET /api/cases/:caseId/scaffold`
- `POST /api/manuscript-review/import`

## 프로젝트 구조

```text
casereport/
  backend/
    src/
      db/
      llm/
      models/
      routes/
      types/
  frontend/
    src/
      components/
      pages/
      services/
      utils/
```

## 보안 주의

- `.env` 파일은 커밋하지 않습니다
- 운영용 MongoDB는 인증과 IP 제한을 권장합니다
- 로그와 내보내기 파일에 민감 정보가 남지 않도록 주의해야 합니다
- 실제 환자 데이터는 반드시 비식별화 후 사용해야 합니다

## License

ISC
