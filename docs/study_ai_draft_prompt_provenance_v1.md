# 고정 연구 사례 AI 자료의 출처 (프롬프트·모델·생성 시점)

학생 V1(S1~S10, 2026-10-05~08)과 Scaffold V2(교수 평가·학생 후속) 참가자가 보는 AI 초안, 근거 카드, 섹션 판정, 적정성 검토는 **2026-10-04에 한 번 생성해 고정한 결과**다. 세션 중에는 LLM을 돌리지 않는다. 논문의 방법·부록에 프롬프트를 실을 때는 이 문서의 커밋을 기준으로 한다. **현재 저장소의 프롬프트 파일은 그 뒤에 바뀌었으므로 그대로 싣지 않는다.**

## 1. 고정 파일과 생성 메타데이터

| 항목 | 값 |
|---|---|
| 고정 파일 | `backend/src/study/cases/defaultStudyCaseProcessed.generated.ts` (출처 케이스 DRY-02 `case_1791123901892_xi64wwq3o`, `frozenAt` 2026-10-04T14:35:52Z) |
| 선택 기준 | EMR 본문 해시(`studyCaseFrozen.ts`). 프롬프트가 바뀌어도 이 결과가 쓰인다 |
| 치료 개입 AI 초안 | 504자, sha256 `5563210818a65fb4…`. 11명 학생 전원 + V2 테스트 케이스에서 동일 확인(2026-10-11) |
| 초안 생성 체인 | CHAIN3 (`runInitialSectionDrafts`), 모델 `gpt-4.1`, temperature 0, `promptVersion` `CHAIN3:v1`, `promptTemplateHash` `e4e8702303adcfa17f9b27bd62418b144ec68d119269d22ff1f988b7748a9aa2`, `generatedAt` 2026-10-04T14:26:14.864Z |
| 근거 카드·섹션 판정 | CHAIN1·CHAIN2, 모델 `gpt-4.1-mini` (스냅샷 `defaultStudyCaseAnalysis.generated.ts`) |
| 적정성 검토 | 치료 개입 섹션 1건(REVIEW), 고정 파일에 포함 |
| 메모 추천·원문 인용·CARE 정리표 | LLM이 아니라 코드 상수(`defaultStudyCase.ts`, `defaultStudyCaseMemoSuggestionsV2.ts`). 근거 문서 `memo_suggestions_basis.md`, `memo_suggestions_v2_basis.md` |

## 2. 그때의 프롬프트를 보는 방법

고정 초안을 만든 프롬프트는 커밋 `c18c6e5` (2026-10-04, "AI 프롬프트와 비식별화 규칙 개선") 시점의 파일이다.

```bash
git show c18c6e5:backend/src/llm/prompts/chain3_draft.ts
```

같은 커밋의 `chain1_splitTag.ts`, `chain2_assess.ts`, `section_adequacy_review.ts`가 근거 카드·판정·검토의 프롬프트다. 템플릿 해시는 `sha256("CHAIN3:v1" + "\n\n---\n\n" + 시스템 프롬프트)`로 계산되며, 위 값과 일치하는지 확인할 수 있다.

## 3. 그 뒤의 변경 (참가자 자료에는 영향 없음)

- 2026-10-11 `0a56cfa`: CHAIN1~7·검토 프롬프트를 공통 원칙(P1~P7) 구조로 다시 씀. 프롬프트 레지스트리에서 이 상태를 **v2**로 소급 표기했다(`backend/src/llm/promptRegistry.ts`). 현재 chain3 템플릿 해시는 `b43305e0…`으로 고정 초안의 해시와 다르다.
- 2026-10-11: CHAIN6 충돌 정책 통일(v3), 실험용 Write 프롬프트 공통 원칙 통일(SW-Q2 v3, SW-D v3, SW-R v3, SW-C v2).
- 2026-10-12: 프롬프트 본문 변경 없음(버전 그대로). 모델 출력 **검증**을 관대하게 바꾸고(섹션 id 변형 정규화, 배열 상한 잘라내기), 형식 오류 시 같은 프롬프트 재시도 대신 수정 호출 1회, 체인별 시간·토큰 상한, 근거 범위 `tags ∪ sectionHints` 통일(`docs/prompt_chain_review_v1.md` §5-3). 실시간 체인(일반 Write, 실험용 Write)에만 해당한다.
- 2026-10-12 (3순위): 용어 판정기 프롬프트 한국어화(`TERM:v2`), CHAIN1 카드 본문 비치환, CHAIN7 저자 원문 보존 등(`docs/prompt_chain_review_v1.md` §5-4). 고정 사례는 저장된 CHAIN1 스냅샷을 쓰므로 영향이 없다.
- 2026-10-12: Scaffold / Write 프롬프트 분리. Scaffold 모드는 `backend/src/llm/prompts/scaffold/`를 쓴다(`docs/prompt_sets_scaffold_write_v1.md`). 공개 단계 `CHAIN3_STUDY_REVEAL`은 Scaffold 사본을 가리키지만 본문이 같아 템플릿 해시가 `f59a93a0…` 그대로다. 앞으로 Scaffold 쪽 프롬프트의 이력은 `SCAFFOLD_*` 버전으로 따로 남는다.
- 2026-10-12: Scaffold CHAIN3 개선을 적용했다(`SCAFFOLD-CHAIN3:v3`, 공개 단계 `CHAIN3_STUDY_REVEAL:v3`, 템플릿 해시 `00406d6d…`, `docs/scaffold_prompt_improvement_phase1.md`). 공개 단계는 고정 초안이 있으면 그것을 먼저 돌려주므로 참가자 초안은 그대로다.
- 2026-10-12: Scaffold CHAIN3 v4(규칙 11~13 추가)를 적용하고, 공개 단계 실시간 생성을 공개 섹션 전용으로 바꿨다(`CHAIN3_STUDY_REVEAL:v4`, 해시 `c9c8ca48…`). 고정 초안이 있으면 그것을 먼저 돌려주므로 참가자 초안은 그대로다.
- 고정 결과는 EMR 본문 해시로만 선택되므로 위 변경과 무관하게 그대로 쓰인다. 고정 파일의 `unsupportedClaims.reason` 문구도 저장된 그대로다.

## 4. 지켜야 할 것

1. **`npm run study:freeze`를 다시 실행하지 않는다.** 실행하면 현재 프롬프트로 다른 초안이 만들어져 참가자 간 비교가 깨진다. 스크립트는 `ALLOW_STUDY_REFREEZE=1` 없이는 실행되지 않게 막아 두었다. 의도적으로 다시 얼릴 때는 이 문서의 §1을 새 값으로 갱신하고 변경 이력에 날짜를 적는다.
2. 고정 사례 EMR 본문(`defaultStudyCase.ts`)을 한 글자라도 바꾸면 고정 결과가 선택되지 않고 실시간 생성으로 떨어진다. 바꾸지 않는다.
3. 실험용 Write(교수 전문가 실험)는 고정 결과가 없고 실시간으로 돈다. 2026-10-11부터 회차·초안 이력에 `promptTemplateHash`가 남으므로, 참가자별로 어떤 프롬프트가 쓰였는지 그 값으로 확인한다. 실험 시작 전에 커밋을 고정하고 그 해시를 세션 대본에 적어 둔다.
