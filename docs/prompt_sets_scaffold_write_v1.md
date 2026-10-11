# Scaffold / Write 프롬프트 분리 (2026-10-12)

Scaffold 개발과 Write 개발을 따로 진행하기 위해 프롬프트를 두 세트로 나눴다. 한쪽 프롬프트를 고쳐도 다른 쪽 화면·연구 자료의 AI 출력은 바뀌지 않는다.

## 1. 어느 세트를 쓰는가

사례의 `mode`로 정한다(`backend/src/llm/promptSets.ts`의 `promptSetForCase`). `mode`가 `scaffold`이면 Scaffold 세트, 그 밖에는 Write 세트다.

| 세트 | 파일 | 레지스트리 키(버전 라벨) | 쓰는 곳 |
|---|---|---|---|
| Scaffold | `backend/src/llm/prompts/scaffold/` 의 `chain1_splitTag.ts`, `chain2_assess.ts`, `chain3_draft.ts`, `chain4_missing.ts`, `chain5_questions.ts`, `section_adequacy_review.ts`, `common.ts`, `terminology_resolver.ts` | `SCAFFOLD_CHAIN1~5`, `SCAFFOLD_REVIEW` (`SCAFFOLD-CHAIN3:v2` 등), 판정기 `SCAFFOLD-TERM:v2` | Scaffold 사례 처리(CHAIN1~5, 용어 판정기), 섹션 조회의 적정성 검토, 실험용 Scaffold 공개 단계(`CHAIN3_STUDY_REVEAL`) |
| Write | `backend/src/llm/prompts/` 바로 아래 파일 전부 (`chain1~7`, `section_adequacy_review.ts`, `common.ts`, `studyWrite_*.ts`), 판정기는 `backend/src/rag/openAILlmResolver.ts` | `CHAIN1~7`, `REVIEW`, `SW_Q2`, `SW_D`, `SW_R`, `SW_C`, 판정기 `TERM:v2` | 일반 Write, 실험용 Write(교수 전문가 실험) |

CHAIN6(답변 반영)·CHAIN7(최종 원고)·SW-*는 Write에서만 쓰므로 Scaffold 사본이 없다.

## 2. 분리 시점의 상태

- Scaffold 사본은 커밋 `a53e34c`의 Write 프롬프트를 그대로 복사했다. 본문은 같고, 버전 라벨이 달라 템플릿 해시는 다르다.
- 기존 키의 템플릿 해시는 하나도 바뀌지 않았다. 특히 공개 단계 `CHAIN3_STUDY_REVEAL`은 Scaffold 사본을 가리키지만 본문이 같아 해시가 `f59a93a0…` 그대로다(`npm run test:prompt-sets`가 확인).
- 학생 V1(S1~S10, S3-1)과 Scaffold V2 참가자가 보는 AI 자료는 고정 결과라 영향이 없다(`docs/study_ai_draft_prompt_provenance_v1.md`).
- 일반 Scaffold 사례(고정 사례가 아닌 것)는 캐시 지문이 Scaffold 키로 바뀌어, 다음 처리 때 CHAIN1~5와 검토가 한 번 다시 돈다. 지문이 없는 옛 문서(학생 V1 포함)는 그대로 적중한다.
- LLM 호출 라벨에 `[scaffold]`가 붙는다(예: `CHAIN3 draft [scaffold]`). 비용 기록(`backend/data/llm_usage.jsonl`)에서 두 세트를 구분할 수 있다.

## 3. 규칙

1. **Scaffold 작업**은 `prompts/scaffold/`만 고치고, 고친 체인의 `SCAFFOLD_*` 버전을 `promptRegistry.ts`에서 올린다. CHAIN3를 고치면 공개 단계 해시도 바뀌므로 `CHAIN3_STUDY_REVEAL` 버전도 올리고 `tests/llm/promptSets.test.ts`의 해시를 갱신한다.
2. **Write 작업**은 `prompts/` 바로 아래 파일과 `rag/openAILlmResolver.ts`의 프롬프트만 고치고, `CHAIN*`·`REVIEW`·`SW_*` 버전을 올린다.
3. 한쪽에서 좋은 수정이 나와 다른 쪽에도 넣고 싶으면, 그쪽 파일에 따로 옮기고 그쪽 버전을 올린다. 자동으로 따라가지 않는다.
4. **아직 공유하는 것**은 고치면 두 모드에 다 영향이 간다. 고칠 때는 아래 테스트를 모두 돌린다.
   - 호출 정책 `llm/client.ts`, 출력 스키마 `llm/schemas/`, 체인 실행 코드 `llm/chains.ts`, 근거 범위 `llm/evidenceScope.ts`, CHAIN4→5 갱신 `questions/questionState.ts`
   - **CARE 루브릭 `config/careSectionRubric.ts`**: 사용자 프롬프트에 그대로 들어간다. 바꾸면 두 세트의 출력이 함께 바뀐다
   - 비식별(`deid/`), 용어 사전·매칭 코드(`rag/termNormalizer.ts`, `rag/retriever.ts`, 사전 데이터), 의미 검색(임베딩, 프롬프트 없음)
   - 테스트: `npm run test:prompt-sets`, `test:prompt-registry`, `test:study`, `test:study-integration`, `test:llm-client`, `test:chain-hygiene`, `test:deid`, `test:privacy`, `test:privacy-payload`
5. 공유 작업 트리에서 두 세션이 함께 일할 때는 자기 파일만 커밋하고 `git stash`를 쓰지 않는다.

## 4. 테스트와 비용 기록

2026-10-12까지 가짜 OpenAI 클라이언트를 쓰는 테스트도 비용 기록 파일 `backend/data/llm_usage.jsonl`에 기록을 남겼다. 이런 기록은 소요 시간이 50ms 미만이고 토큰이 1~15개인 것으로, 2026-10-12 기준 72건이다. 파일은 지우거나 고치지 않았다. 세션별 비용을 셀 때 이 기록을 빼야 한다.

이제 `__setOpenAIClientForTests`로 가짜 클라이언트를 끼운 동안과 `LLM_USAGE_LOG_DISABLED=1`일 때는 기록하지 않는다. OpenAI 모듈 자체를 바꾸는 두 테스트(`tests/privacy/outboundPayload.test.ts`, `highRiskGate.test.ts`)는 이 환경변수를 켠다.
