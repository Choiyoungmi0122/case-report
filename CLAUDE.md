# casereport 작업 규칙

## Scaffold / Write 프롬프트는 분리되어 있다 (2026-10-12)
- Scaffold 모드 프롬프트: `backend/src/llm/prompts/scaffold/`. Write 모드(일반·실험용 Write) 프롬프트: `backend/src/llm/prompts/` 바로 아래, 용어 판정기는 `backend/src/rag/openAILlmResolver.ts`.
- 자기 모드의 파일만 고치고, 고친 체인의 버전을 `backend/src/llm/promptRegistry.ts`에서 올린다(Scaffold는 `SCAFFOLD_*`, Write는 `CHAIN*`·`REVIEW`·`SW_*`).
- 공유 코드(`llm/client.ts`, `llm/schemas/`, `llm/chains.ts`, `config/careSectionRubric.ts`, `deid/`, `rag/` 매칭 코드)를 고치면 두 모드에 다 영향이 간다. 자세한 규칙과 돌릴 테스트: `docs/prompt_sets_scaffold_write_v1.md`.

## 연구 자료 보호
- 학생 V1(S1~S10, S3-1) 기록은 수정·삭제하지 않는다. 고정 연구 사례를 다시 얼리지 않는다(`npm run study:freeze`는 `ALLOW_STUDY_REFREEZE=1` 없이는 막혀 있다). 출처: `docs/study_ai_draft_prompt_provenance_v1.md`.
- `backend/data/llm_usage.jsonl`은 비용 산정 자료다. 테스트는 가짜 클라이언트(`__setOpenAIClientForTests`) 또는 `LLM_USAGE_LOG_DISABLED=1`로 기록을 끈다.

## 공유 작업 트리
- 여러 세션이 같은 작업 트리를 쓴다. 자기 파일만 `git add -- <경로>`로 커밋하고, `git stash`·`git add -A`를 쓰지 않는다.
