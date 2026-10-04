# Master Protocol — 증례보고 작성 지원 Human-AI 시스템 실험

> **문서 성격** 연구자 본인이 실험 준비·진행·분석에 사용하는 실행 매뉴얼입니다.
> 교수님 미팅용 요약은 `meeting_brief_experiment_design.md`에 별도로 있습니다. 두 문서는 합치지 않습니다.
> **작성일** 2026-08-31 · **버전** v1.0 (draft)
>
> **표기 규칙**
> `[결정 필요]` 아직 확정하지 않았고, 임의로 확정하지 않은 항목
> `[파일럿 후 확정]` Student Pilot 결과를 보고 정하는 항목
> `확정` 현재 설계 기준으로 고정된 항목

---

# PART I. 연구 전체 구조

## 1. Research Logic

### 1.1 연구 문제

EMR/SOAP는 증례보고 구조로 기록되어 있지 않다. 작성자는 (a) 흩어진 기록에서 이 증례의 핵심 정보를 선별하고, (b) 시간적 경과를 재구성하고, (c) CARE guideline [1]의 항목 구조로 옮기고, (d) 기록에 없는 정보를 누락으로 인식해야 한다. 초보 작성자에게는 (a)–(d) 전체가 학습 대상이다 [2].

생성형 AI는 (a)–(c)를 즉시 수행할 수 있다. 그러나 초보 작성자가 AI 초안을 먼저 받으면 원기록 탐색·판단 경험 없이 결과만 얻고, hallucination과 과잉해석을 검증할 기준을 갖지 못한다. 임상 의사결정 지원에서의 automation bias [5]와 부적절한 의존 [4]이 여기에 해당한다.

### 1.2 Write의 역할

**실제 한의사의 증례보고 작성 지원 도구.** Scaffold를 위한 probe가 아니라, 그 자체로 practical utility를 formative하게 평가하는 대상이다. Expert Study에서 확인하는 것:

1. 실제 증례보고 작성에 도움이 되는가
2. EMR → CARE 구조화가 유용한가
3. AI 초안을 실제 원고의 출발점으로 활용할 수 있는가
4. Missing Information / 질문이 도움이 되는가
5. workflow burden을 줄일 가능성이 있는가
6. AI 오류를 검증할 수 있는가
7. 실제 사용 의향이 있는가
8. 필요한 / 불필요한 기능은 무엇인가

### 1.3 Scaffold의 역할

**논문의 Main Contribution.** 증례보고 경험이 적은 학습자가 AI 초안을 바로 받지 않고 다음 순서를 수행하도록 지원하는 educational Human-AI Scaffold.

```
EMR/SOAP 탐색 → 필요한 정보 판단 → 누락·추가확인 정보 판단
→ AI 공개 전 자신의 판단 형성 → AI 초안 확인
→ 자신의 판단 / AI / 원기록 비교 → AI 결과 검토
```

**AI 공개 시점을 핵심 interaction mechanism으로 설계**하며, AI 노출 이전에 사용자의 독립적 판단을 유도한다는 점에서 cognitive forcing 접근과 **개념적으로 연결**된다 [6]. **본 연구가 해당 intervention을 그대로 재현하거나 그 효과를 검증하는 것은 아니다.** Human-AI interaction 설계 원칙 [3]도 개념적 근거로 참고한다.

### 1.4 Expert Formative Study의 역할

효과 검증이 아니라 **설계 근거 확보**. 두 축을 각각 평가하며 서로 비교하지 않는다.

- **Write Practical Utility & Requirements** (E3)
- **Scaffold Educational Utility & Requirements** (E4)

### 1.5 Student Main Study의 역할

Scaffold **단일군(single-arm)**에서 학습자의 정보 탐색·판단 과정, AI 공개 전후 검토 행동, 주관적 평가를 기술한다.

**하지 않는 것:** Write vs Scaffold 비교 · 3개 실험군 · section category를 실험군으로 사용 · AI vs No-AI 비교 · pre-post 학습효과 실험 · Student Case A/B를 조건처럼 사용.

### 1.6 Contribution

| | 내용 | 위치 |
|---|---|---|
| C1 | EMR–CARE 기반 단계적 authoring scaffold | main |
| C2 | AI 공개 전 독립적 판단을 유도하는 Human-AI interaction | main |
| C3 | Domain-expert-informed scaffold design (traceable) | main |
| (secondary) | 실제 EMR 기반 Write의 실무 활용 가능성 및 요구사항 | practical, secondary |

### 1.7 Claim Boundary (요약 — 상세는 PART XIV)

단일군 설계에서 **학습효과 향상·우월성·장기 역량 향상을 주장하지 않는다.** 표현은 *educational utility / learning support / educational applicability*로 통일한다.

---

# PART II. Expert Formative Study

## 2. 참가자

### 2.1 Inclusion
- 한의사 면허 보유
- **증례보고 작성 경험 보유** (학술지 게재 또는 학회 발표 수준 이상 1편 이상)
- 한국어로 인터뷰 가능

### 2.2 Exclusion
- 본 시스템의 개발·설계에 직접 참여한 자
- 세션 소요시간(45~60분)을 확보할 수 없는 자

### 2.3 N Rationale — `최소 5 / 목표 8 / 최대 10`

소규모 formative usability 연구에 관한 기존 논의 [7][8]와 표본 크기를 자료의 정보력으로 판단하는 관점 [9]을 함께 고려하여, **최소 5명, 목표 8명으로 계획하고 모집 가능성에 따라 최대 10명까지 확대**한다. 대상이 좁고(한의학 + 증례보고 작성 경험) 세션당 자료 밀도가 높아 information power가 높은 편이라는 서술까지만 한다.

**쓰지 않는 표현:** "5명이면 충분하다" · "5명에서 포화(saturation)에 도달한다" · "5명이 대부분의 문제를 반드시 발견한다".

### 2.4 Participant Code

- 형식: `E##` (예: `E01`)
- 실명·이메일·소속 등 식별정보와 코드의 연결표는 **연구자 로컬에서만** 관리하며 시스템에는 저장하지 않는다.
- 시스템에는 `participantCode`와 `sessionId`만 전달된다.
- **연구 참여자(전문가)의 개인정보와, 증례 속 환자 정보는 분리해서 관리한다.**

### 2.5 모집 시 확인할 background variables

| 변수 | 형식 |
|---|---|
| 임상 경력 | 년 |
| 소속 유형 | 한방병원 / 한의원 / 대학·연구기관 / 기타 |
| 전문 진료 영역 | 자유기재 |
| 증례보고 작성 편수 | 게재 / 발표 구분 |
| 증례보고 지도 경험 | 유·무, 유일 경우 대상(학생/수련의) |
| 생성형 AI 사용 빈도 | 전혀 없음 ~ 거의 매일 (5단계) |
| 학술 글쓰기에 AI 사용 경험 | 유·무 |

## 3. 세션 절차

### 3.1 60분 기본안 `확정 (교수님 승인 대기)`

| 시각 | 단계 | 내용 | 산출 |
|---|---|---|---|
| 0–7′ | 도입 + 기존 경험 | 동의 확인, 배경 문항, 기존 증례보고 작성 방식과 어려움 | E1 |
| 7–27′ | **Write 직접 사용** | 본인 비식별 사례로 전체 workflow 수행 (§4) | E3, system log |
| 27–35′ | Write retrospective | Q1–Q7 인터뷰 (§7) + Write CRF (§6) | E3 |
| 35–40′ | Core competency | 12개 후보 역량 중요도 + Top 3 (§9) — **Scaffold 노출 전** | E2 |
| 40–50′ | Scaffold | Clinical Findings 직접 + DA/Introduction walkthrough (§10) | E4, system log |
| 50–58′ | Scaffold / 전체 자문 | Scaffold CRF (§11) + 인터뷰 (§12) + 전체 평가 (§13) | E4, E5 |
| 58–60′ | 마무리 | Student case 적합성 조건, 추가 의견 | E6 |

### 3.2 45분 fallback

| 시각 | 단계 | 축약 방법 |
|---|---|---|
| 0–5′ | 도입 | 배경 문항을 사전 설문으로 이전 |
| 5–20′ | Write 직접 사용 | 자유 탐색 시간 축소, 필수 step만 수행 |
| 20–27′ | Write retrospective | Q1–Q4만 구두, Q5–Q7은 CRF 자유기재로 대체 |
| 27–31′ | Core competency | 중요도 평정을 사전 설문으로 이전, 세션에서는 Top 3만 |
| 31–38′ | Scaffold | walkthrough 2개를 1개(Diagnostic Assessment)로 축소 |
| 38–43′ | 자문 | Q8·Q10·Q14만 |
| 43–45′ | 마무리 | 동일 |

**운영 판단:** AI 최초 처리에 실측 1~2분이 소요되므로 45분안에서는 Write 자유 탐색이 실질적으로 사라진다. 60분안을 우선한다.

### 3.3 세션 환경
- 대면 또는 화상. 화상일 경우 참가자 본인 기기에서 시스템 접속(본인 EMR을 다루므로 화면 공유 방식은 참가자가 선택).
- 녹음: 음성. 화면 녹화 여부 `[결정 필요]` — 본인 임상기록이 화면에 나타나므로 별도 동의 항목 필요.
- 연구자는 관찰 노트를 실시간 작성한다 (§30 체크리스트).

---

## 4. Write Task Protocol

### 4.1 Step 체크리스트

| | Step | 필수/자유 | 확인 방법 |
|---|---|---|---|
| ☐ | EMR/SOAP 입력 (본인 비식별 사례 또는 연구용 fallback) | **필수** | 화면 |
| ☐ | 비식별화 결과 확인 (플레이스홀더 검토) | **필수** | 화면 |
| ☐ | 작성 시작 (process) | **필수** | `case_processed` |
| ☐ | CARE overview 전체 확인 | **필수** | `section_opened` ≥1 |
| ☐ | 관심 section 자유 탐색 | 자유 | `section_opened` |
| ☐ | Evidence 확인 | **필수** ≥1회 | `evidence_opened` |
| ☐ | Missing Information / 질문 확인 | **필수** | `question_viewed` |
| ☐ | 답변 가능한 질문 **1개 이상** 답변 | **필수** | `question_answered` |
| ☐ | Draft Update 결과 확인 | **필수** | `draftTrajectory` step ≥1 |
| ☐ | Review AI 실행 및 결과 확인 | **필수** ≥1회 | `review_ai_requested` |
| ☐ | Final Manuscript 확인 | **필수** | `final_output_viewed` |
| ☐ | Word 결과물 확인 | **필수** | `export_requested` |
| ☐ | 세션 종료 처리 | **필수** | `session_completed` |

**12개 section을 모두 의무 수정하게 하지 않는다.** 목적은 전체 workflow 경험이다. 어떤 section을 깊게 볼지는 참가자가 선택한다 (그 선택 자체가 E3 자료다).

### 4.2 사례 준비

| 우선순위 | 방식 |
|---|---|
| 1 | 전문가 **본인의 실제 임상 사례** — 세션 현장에서 직접 입력, 시스템 내부에서 비식별화 |
| 2 | 연구자 제공 **연구용 사례** (fallback) |

- 원본 환자자료를 이메일·메신저 등으로 **사전 제출하도록 요구하지 않는다.**
- 사전 준비를 원하는 참가자에게는 "본인이 접근 가능한 사례 1건을 미리 골라두고, 세션 중 직접 입력한다"까지만 안내한다.
- fallback 사례는 실제 사례와 동등한 구조(다회 내원, SOAP)여야 한다. `[결정 필요]` fallback 사례의 출처와 편수.

### 4.3 연구자 개입 규칙
- 시스템 오류·멈춤일 때만 개입한다.
- 참가자가 "이 다음에 뭘 해야 하나요"라고 물으면 **답을 알려주지 않고** "화면에서 하실 수 있다고 생각되는 것을 해보세요"라고 응답한 뒤, 그 지점을 관찰 노트에 기록한다 (E3 usability finding).
- 필수 step을 20분 내 도달하지 못하면 해당 step만 연구자가 안내하고 기록한다.

---

## 5. Write에서 수집할 Metrics

데이터 출처 표기:
`EVT` = `researchState.interactionEvents`
`TIM` = export의 `timing` 요약
`TRJ` = `draftTrajectory` (`answerUndoStack` 기반)
`CASE` = case document 필드
`OBS` = 연구자 관찰 노트
`INT` = 인터뷰 전사

| Metric | 의미 | 데이터 출처 | 계산 방법 | 분석 목적 | 상태 |
|---|---|---|---|---|---|
| write_session_duration | Write 세션 총 소요 | TIM `totalSessionMs` | `session_completed − session_start` | 60분안 타당성, 실제 소요 | 확정 |
| initial_process_duration | 최초 AI 처리 시간 | TIM `timeToProcessedMs`, `chainDurationsMs` | `case_processed − session_start`; chain별 분해 | 대기시간 부담, 개선 우선순위 | 확정 |
| time_to_final_manuscript | 최종 원고 도달까지 | TIM `timeToFinalManuscriptMs` | `final_output_viewed − session_start` | 전체 workflow 소요 | 확정 |
| section_opened_count | 열어본 section 수 | TIM `sectionOpenCount` / EVT | `section_opened`의 distinct `sectionId` | 어느 section에 관심이 가는가 | 확정 |
| section_open_events | 재방문 포함 열람 횟수 | EVT | `section_opened` 총 건수 | 반복 확인이 필요한 section 식별 | 확정 |
| section_dwell_time | section별 체류시간 | EVT | 연속한 `section_opened` 간 간격; 마지막은 다음 상위 이벤트까지 | 어느 section이 어려운가 | 후보 |
| evidence_open_count | Evidence 확인 횟수 | EVT | `evidence_opened` 건수 (section별 집계) | AI 결과의 근거 확인 행동 | 확정 |
| evidence_open_rate | 근거 확인을 동반한 section 비율 | EVT | `evidence_opened`가 1회 이상 있는 section / 열어본 section | 검증 행동의 범위 | 후보 |
| question_viewed_count | 확인한 질문 수 | EVT | `question_viewed` distinct 질문 | 질문 기능 도달률 | 확정 |
| question_answered_count | 답변한 질문 수 | TIM `questionsAnsweredCount` | `question_answered` 건수 | 질문의 실제 활용 | 확정 |
| question_skip | 확인했으나 답하지 않은 질문 | EVT | `viewed` − `answered`, 질문 텍스트와 함께 | **어떤 질문이 답하기 어려운가** (E3 핵심) | 확정 |
| draft_update_count | 초안 갱신 횟수 | TRJ | `draftTrajectory.steps` 길이 | 반복 보완 정도 | 확정 |
| draft_delta | 답변 전후 초안 변화 | TRJ | `draftsBeforeAnswer` ↔ 최종 `sectionDrafts` 텍스트 비교 (수동 정성 코딩) | 답변이 초안을 실제로 개선하는가 | 후보 |
| review_ai_count | Review AI 실행 횟수 | EVT | `review_ai_requested` 건수 | 검토 기능 활용 | 확정 |
| review_ai_result_viewed | 결과 확인 여부 | EVT | `review_ai_result_viewed` 존재 | 실행만 하고 안 보는지 | 후보 |
| final_reached | 최종 원고 도달 여부 | EVT | `final_output_viewed` 존재 | 완주율 | 확정 |
| export_performed | Word 저장 수행 여부 | EVT / `exportLogs` | `export_requested` 존재 | 완주율 | 확정 |
| feature_coverage | 기능별 이용 여부 | EVT | 기능 12종 × 사용 여부 이진표 | 안 쓰이는 기능 식별 (E3) | 확정 |
| ai_unsupported_instances | 근거 없는/과잉해석 AI 서술 | OBS + INT + `sectionAdequacyReviews` | 전문가가 지적한 문장을 원문·section과 함께 수집 | **AI 안전성 (E5)** | 확정 |
| expert_edits | 전문가가 수정·지적한 내용 | OBS + `sectionDrafts` 최종본 | 수정 지점의 유형 분류 (사실오류 / 표현 / 구조 / 누락) | 초안 활용 가능성 (E3) | 확정 |
| navigation_stumbles | 진행이 막힌 지점 | OBS | 참가자가 다음 행동을 찾지 못한 지점·소요시간 | usability finding | 확정 |
| chain_cache_hit | 캐시 재사용 여부 | TIM `chainDurationsMs[].cacheHit` | 불리언 | 소요시간 해석 시 보정 | 확정 |

### 5.1 해석 주의
- N ≤ 10, 사례가 참가자마다 다르므로 **모든 metric은 기술통계(중앙값·범위·개인별 표)로만 제시**한다. 집단 간 검정을 하지 않는다.
- 소요시간은 사례 길이(내원 횟수·SOAP 분량)에 크게 좌우되므로 **사례 규모를 함께 보고**한다.
- 시스템 로그는 정성 자료의 보조다. 로그 단독으로 utility를 주장하지 않는다.

---

## 6. Write Subjective Evaluation (Expert CRF — Write 영역)

**척도:** 5점 (1 전혀 그렇지 않다 ~ 5 매우 그렇다). **모두 Custom 문항이며 validated scale이 아니다.**

| # | 문항 | Domain |
|---|---|---|
| W1 | 이 시스템은 실제 임상기록을 증례보고 초안으로 구성하는 데 유용하다. | 구조화 지원 |
| W2 | 생성된 초안은 실제 증례보고 작성의 출발점으로 활용할 수 있는 수준이다. | draft usability |
| W3 | 질문 및 보완 workflow는 실제 작성에 필요한 정보를 확인하는 데 도움이 된다. | missing info |
| W4 | 현재 상태의 시스템을 실제 나의 증례보고 작성에 사용할 의향이 있다. | adoption intention |

자유기재 1문항: **"Write에서 가장 개선이 필요한 점 한 가지"**

> CRF 전체는 Write 4 + Scaffold 4 + 공통 4 = **12문항 내외**로 유지한다. 기존 승인본 CRF가 있을 경우 문항 번호·척도를 그쪽에 맞춘다 — 현 repository에서 CRF 원본을 확인하지 못했으므로 **위 문항은 제안이며 승인본을 대체하지 않는다.**

---

## 7. Write Retrospective Interview

> **운영 원칙 (§7·§12·§13 공통)**
> **60분 기본 세션에서 Q1~Q17을 모두 순서대로 질문하지 않는다.** 각 파트의 **Core Question**을 우선 질문하고, 나머지는 응답 내용과 남은 시간에 따라 **probe 또는 question bank**로 사용한다. 참가자가 Core Question에 답하면서 이미 다룬 내용은 다시 묻지 않는다.

| 파트 | Core | Optional / Question Bank |
|---|---|---|
| Write (§7) | Q1 · Q2 · Q4 · Q5 · Q7 | Q3 · Q6 |
| Scaffold (§12) | Q8 · Q9 · Q10 · Q12 · Q13 | Q11 (Q10·Q13의 probe로 통합 가능) |
| System-wide (§13) | Q14 · Q15 · Q16 | Q17 (시간이 허용될 때) |

각 질문: **Main question / Purpose / Probe**.

### Q1 — 전반적 유용성 `Core`
- **Main** 방금 사용해 보신 과정에서, 실제 증례보고를 쓰실 때 가장 도움이 될 것 같은 단계는 어디였습니까?
- **Purpose** E3 — 어느 단계에 practical utility가 있는지 특정
- **Probe** 반대로 도움이 되지 않았거나 오히려 번거로웠던 단계는? / 그 단계를 빼면 어떻게 됩니까?

### Q2 — 초안 활용 가능성 `Core`
- **Main** 생성된 초안을 실제 원고의 출발점으로 쓸 수 있다고 보십니까? 쓸 수 있다면 어느 정도 수정이 필요합니까?
- **Purpose** E3 — draft usability의 실제 수준
- **Probe** 어느 section이 가장 쓸 만했고, 어느 section이 가장 손이 많이 갑니까? / 처음부터 직접 쓰는 것과 비교하면?

### Q3 — 구조화 `Optional`
- **Main** EMR을 CARE 구조로 나눠준 결과가 선생님이 생각하시는 구조와 맞았습니까?
- **Purpose** E3 + E5 — CARE 구조화 적합성
- **Probe** 잘못 배치된 정보가 있었습니까? / 한의학 증례에서 이 구조가 잘 안 맞는 지점이 있습니까?

### Q4 — 누락정보 / 질문 `Core`
- **Main** 시스템이 제시한 누락정보와 질문은 실제 작성에서 확인해야 할 것들이었습니까?
- **Purpose** E3 — missing information 기능의 타당성
- **Probe** 답하기 어려웠던 질문은 왜 어려웠습니까? / 시스템이 물어야 했는데 묻지 않은 것은?

### Q5 — AI 안전성 `Core`
- **Main** AI가 쓴 내용 중 기록과 다르거나 과하게 해석한 부분을 발견하셨습니까? 그것을 발견할 수 있게 되어 있었습니까?
- **Purpose** E3 + E5 — verification affordance
- **Probe** 어떻게 발견하셨습니까(근거 카드/원문 대조/임상 지식)? / 경험이 적은 사람도 발견할 수 있었을까요?

### Q6 — Workflow fit `Optional`
- **Main** 이 도구가 선생님의 실제 작성 과정 어디에 들어가면 맞겠습니까? 작성 부담이 줄어들 여지가 있습니까?
- **Purpose** E3 — workflow burden
- **Probe** 진료 중 / 진료 후 / 투고 준비 중 어느 시점입니까? / 지금 방식 대비 시간이 줄겠습니까 늘겠습니까?

### Q7 — 도입 의향과 요구 `Core`
- **Main** 지금 상태로 실제 사용하실 의향이 있습니까? 없다면 무엇이 갖춰져야 합니까?
- **Purpose** E3 — adoption requirement
- **Probe** 꼭 필요한 기능 / 없어도 되는 기능은? / 어떤 상황이면 절대 쓰지 않으시겠습니까?

---

# PART III. Core Competency

## 8. Candidate Competencies

본 목록은 **문헌을 바탕으로 연구자가 구성한 candidate competencies**이다. 검증된 competency framework가 아니며, 전문가 평정(§9)을 통해 중요도와 누락 여부를 확인하는 대상이다.

**평정 시점: Scaffold를 보여주기 전.** Scaffold를 본 뒤에 물으면 시스템이 제공하는 활동 쪽으로 응답이 끌린다.

| # | 후보 역량 | 정의 | 본 연구에서 후보로 둔 이유 | 참고 문헌 | 연결되는 Scaffold activity |
|---|---|---|---|---|---|
| 1 | 핵심 임상정보 파악 | 기록에서 이 증례를 성립시키는 정보를 선별 | CARE의 각 항목은 정보 선별을 전제로 함 | [1] | 학습자 key information 직접 기재 |
| 2 | 증례의 초점 설정 / problem representation | 이 증례가 무엇에 관한 것인지 규정 | 초점이 없으면 정보 선별 기준이 없음. **`[추가 임상추론 문헌 검토 필요]` — problem representation 개념은 [1][2]만으로 충분히 뒷받침되지 않는다** | [1][2] | case focus 판단 (선택) |
| 3 | 시간적 경과 구성 | 내원·중재·반응을 시간축으로 재구성 | CARE Timeline 항목의 요구 | [1] | Timeline section 활동 |
| 4 | CARE 기반 정보 구조화 | 정보를 해당 항목에 배치 | 보고 표준 준수 | [1] | section별 분리 진행 |
| 5 | 진단 근거 구성 | 진단에 이르는 근거를 기록에서 구성 | Diagnostic Assessment 항목이 요구하는 내용. **`[추가 임상추론 문헌 검토 필요]` — diagnostic reasoning 자체에 대한 근거는 보강 필요** | [1] | DA section 판단 활동 |
| 6 | 치료–결과 관계 파악 | 중재와 경과의 연결을 서술 | Intervention/Outcome 항목 | [1] | Follow-up/Outcomes 활동 |
| 7 | 누락정보 인식 | 기록에 없는 필수 정보를 인지 | CARE 충족 여부를 판단하는 데 필요한 후보 역량 | [1][2] | missing information 판단 |
| 8 | 추가 확인 필요성 판단 | 확인하면 얻을 수 있는 정보인지 구분 | 누락과 추가확인의 구분이 작성 결정에 영향 | [2] | `needs_additional_confirmation` 판단 |
| 9 | 사실과 임상적 해석 구분 | 기록된 사실과 저자의 해석 분리 | 과잉해석을 피하기 위해 필요한 후보 역량 | [1] | draft 문장별 근거 판단 |
| 10 | 증례의 학술적 의의 파악 | 왜 보고 가치가 있는지 | Introduction/Discussion 서술에 필요 | [1][2] | Introduction walkthrough |
| 11 | AI 결과 검증 | AI 서술을 원기록과 대조 | 과의존 관련 논의에서 도출한 후보 역량 | [4][5][6] | 원기록 ↔ AI 비교 |
| 12 | AI 오류·과잉해석 탐지 | 근거 없는 서술을 식별 | 동일 | [5][6] | `supported_by_record` 판단 |

> **문헌 연결 주의** 위 "참고 문헌"은 해당 역량이 그 문헌에서 **검증되었다는 뜻이 아니라**, 후보를 구성할 때 참조한 근거라는 의미다. `[추가 임상추론 문헌 검토 필요]` 표시 항목은 현재 문헌만으로 강하게 주장하지 않는다. **이번 작업에서 새로운 문헌을 추가하지 않았다.**
## 9. Expert Competency Evaluation

**형식**
- 중요도 **1~4** (1 중요하지 않음 / 2 다소 중요 / 3 중요 / 4 매우 중요) — 중립점을 없애기 위해 4점 척도
- **Top 3** 선택 (순위 없음)
- **누락 역량 자유서술** 1문항

**분석**
- 역량별 중앙값 및 분포(4점 응답 수)
- Top 3 선택 빈도
- 자유서술 및 인터뷰 중 언급을 근거로 한 정성 rationale
- **정식 CVI validation으로 확대하지 않는다.** I-CVI/S-CVI를 계산하거나 content validity가 확립되었다고 주장하지 않는다.

**산출** E2 — 이후 Scaffold activity 개정의 근거. 어느 역량이 현재 Scaffold에서 다뤄지지 않는지를 gap으로 정리한다.

---

# PART IV. Scaffold Expert Review

## 10. Expert Scaffold Procedure

전체 section을 수행하지 않는다. **대표 1개 직접 + 2개 유형 walkthrough.**

| Section | 방식 | 이 유형을 고른 이유 | 전문가가 봐야 할 것 |
|---|---|---|---|
| **Clinical Findings** | **전문가 직접 사용** | 기록에서 바로 구성 가능한 정보가 많아 "탐색 → 판단 → AI 비교" 전 과정을 짧은 시간에 경험할 수 있다 | 원기록 탐색 단계의 부담, 판단 항목의 적절성, AI 공개 시점, 비교 화면의 이해도 |
| **Diagnostic Assessment** | researcher walkthrough | 기록만으로는 구성되지 않고 임상적 추론이 필요한 유형 | 추론이 필요한 section에서 사전 판단을 요구하는 것이 타당한지, 학습자가 무엇을 판단할 수 있는지 |
| **Introduction** | researcher walkthrough | 원기록에 근거가 거의 없고 학술적 맥락 판단이 필요한 유형 | 이 유형에도 같은 scaffold를 적용해야 하는지, section별 차등이 필요한지 |

**직접 사용 section의 진행 순서 (관찰 항목)**

| | 단계 | 관찰 |
|---|---|---|
| ☐ | section 목적 확인 | 목적 설명이 이해되는가 |
| ☐ | 원기록 탐색 | 어디를 먼저 보는가, 얼마나 걸리는가 |
| ☐ | 핵심정보 기재 | 무엇을 적는가, 막히는 지점 |
| ☐ | 누락·추가확인 판단 | 판단 카테고리 4종이 구분 가능한가 |
| ☐ | 사전 판단 확정 | AI를 먼저 보고 싶다는 반응이 나오는가 |
| ☐ | AI 초안 공개 | 첫 반응 |
| ☐ | 원기록 ↔ AI 비교 | 원기록으로 되돌아가는가 |
| ☐ | 문장별 판단 | 판단 기준을 무엇으로 삼는가 |

## 11. Scaffold Educational Utility Survey (Expert CRF — Scaffold 영역)

**척도:** 5점. **모두 Custom.**

| # | 문항 | Domain |
|---|---|---|
| S1 | Scaffold는 증례보고 경험이 적은 학습자가 원기록에서 필요한 정보를 직접 탐색하도록 지원한다. | 정보 탐색 지원 |
| S2 | AI 초안 공개 전에 학습자의 독립적 판단을 요구하는 과정은 교육적으로 적절하다. | pre-AI reasoning |
| S3 | 원기록과 AI 초안을 비교하는 과정은 AI 결과를 비판적으로 검토하는 데 도움이 된다. | critical AI review |
| S4 | Scaffold는 수련의 증례보고 교육 또는 교수자 피드백에 활용할 수 있다. | instructional applicability |

자유기재 1문항: **"Scaffold에서 가장 개선이 필요한 점 한 가지"**

## 12. Scaffold Interview

### Q8 — educational utility `Core`
- **Main** 이 방식이 증례보고 경험이 없는 수련의에게 도움이 될 것 같습니까?
- **Probe** 어떤 수준의 학습자에게 맞습니까? / 오히려 부담이 될 학습자는?

### Q9 — pre-AI reasoning `Core`
- **Main** AI를 보기 전에 학습자가 직접 판단하게 하는 것이 필요하다고 보십니까?
- **Probe** 그 판단을 실제로 할 수 있겠습니까? / 어떤 도움이 있어야 가능합니까? / 형식적으로 넘길 위험은?

### Q10 — AI reveal timing `Core`
- **Main** AI 초안을 언제 보여주는 것이 교육적으로 적절합니까?
- **Probe** 지금 시점(사전 판단 완료 후)이 이릅니까 늦습니까? / 부분 공개나 힌트가 필요합니까? / 학습자가 건너뛰려 하면 허용해야 합니까?

### Q11 — instructor intervention `Optional`
- **Main** 교수자는 이 과정 어디에 개입해야 합니까?
- **Probe** 실시간 개입 vs 사후 피드백? / '교수자 검토 필요'로 표시된 항목이 실제 지도에 쓸 만합니까?
- **통합 가능** 시간이 부족하면 Q10(AI reveal timing) 또는 Q13(불필요/누락 활동)의 probe로 흡수한다.

### Q12 — section-specific scaffold `Core`
- **Main** 모든 section에 같은 방식을 적용해야 합니까?
- **Probe** Introduction처럼 기록 근거가 적은 section도 같은 절차가 맞습니까? / 어느 section을 먼저 하게 해야 합니까?

### Q13 — 불필요 / 누락 활동 `Core`
- **Main** 학습 활동 중 없어도 되는 것, 반대로 꼭 있어야 하는데 없는 것은 무엇입니까?
- **Probe** 학습자가 지칠 지점은? / 핵심역량 중 이 시스템이 연습시키지 못하는 것은?

*(critical AI use는 Q10·S3 및 §13 C2와 중복되므로 별도 질문을 두지 않는다.)*

---

# PART V. Expert 전체 공통 평가

## 13. System-wide Safety & Applicability

Write·Scaffold 문항과 중복되지 않도록, **두 모드를 모두 경험한 뒤에만 답할 수 있는 것**만 남긴다.

**CRF 공통 영역 (5점, Custom)**

| # | 문항 | 중복 회피 근거 |
|---|---|---|
| C1 | 이 시스템은 CARE guideline에 맞게 정보를 구조화하도록 지원한다. | W1은 "초안 구성 유용성", C1은 "표준 적합성" |
| C2 | AI가 생성한 내용 중 기록과 다르거나 과도하게 해석된 부분을 확인할 수 있었다. | W·S 문항에 없는 안전성 축 |
| C3 | 이 시스템은 한의학 임상 맥락에 적합하게 작동한다. | 도메인 적합성 — 두 모드 공통 |
| C4 | 이 시스템은 교육 또는 임상 현장에 도입할 수 있다고 본다. | W4(개인 사용 의향)와 달리 조직·현장 수준 |

**인터뷰 (전체 시스템)**

### Q14 — hallucination / 과잉해석 위험 `Core`
- **Main** 이 시스템을 실제로 쓸 때 가장 위험하다고 보시는 지점은 어디입니까?
- **Probe** 경험이 없는 사람이 쓰면 어떤 문제가 생기겠습니까? / 어떤 안전장치가 필요합니까?

### Q15 — 한의학 맥락 적합성 `Core`
- **Main** 한의학 증례보고 특성상 이 시스템이 맞지 않는 부분이 있습니까?
- **Probe** 변증·처방·경혈 등 표현 처리는? / 서양의학 증례보고 기준과 다른 점은?

### Q16 — 현장 적용 `Core`
- **Main** 실제 교육 현장 또는 진료 현장에 도입한다면 무엇이 걸림돌입니까?
- **Probe** 개인정보·기관 승인·시간·교수자 부담 중 무엇이 가장 큽니까?

### Q17 — Student case 조건 (E6) `Optional — 시간이 허용할 때`
- **Main** 증례보고를 처음 쓰는 수련의에게 연습용으로 적절한 증례는 어떤 조건을 갖춰야 합니까?
- **Probe** 내원 횟수·질환·경과 명확성? / 피해야 할 증례 유형은?
- **주의** 본 세션에서 **사례 제공을 요청하지 않는다.** 제공 의향 확인은 세션 종료 후 별도 절차로 분리한다. `[결정 필요]` 별도 요청 시점과 방식.

---

# PART VI. Expert Qualitative Analysis

## 14. Thematic Analysis

Braun & Clarke의 6단계 [10]를 연구 규모(N ≤ 10, 세션당 45~60분)에 맞춰 적용한다. **거대한 qualitative methodology를 만들지 않는다.**

| 단계 | 실제 수행 |
|---|---|
| 1. Familiarisation | 전사 후 통독, 세션별 요약 메모 1장 |
| 2. Initial coding | 발화·관찰 단위 코딩. Write·Scaffold·전체를 구분해 코딩하되 코드북은 하나로 유지 |
| 3. Searching for themes | 코드를 후보 theme로 묶음 |
| 4. Reviewing themes | 원자료로 되돌아가 확인, 중복 theme 병합 |
| 5. Defining/naming | theme별 정의 1–2문장 + 대표 인용 |
| 6. Writing up | E1–E6 산출물에 배치 |

**접근** 주로 귀납적 코딩. 단, AI 검토 행동 관련 코드는 automation bias·appropriate reliance·cognitive forcing 개념 [4][5][6]을 sensitising concept로 사용한다 (연역적 코드북을 미리 고정하지는 않는다).

**신뢰성 확보** `[결정 필요]` — 2차 코더 확보 가능 여부. 확보 시: 전체의 20~30%를 독립 코딩하고 불일치를 논의로 해소한다. **κ 등 신뢰도 계수를 목표치로 제시하지 않는다** (theme 도출형 분석에 부적절).

**Traceability (필수)**

```
Raw Quote / Observation
 → Code
 → Theme / Expert Finding
 → Design Implication
 → Design Requirement
 → Write / Scaffold Revision
```

이 사슬을 표로 유지한다. 각 Design Requirement에는 근거가 된 참가자 코드(E01 등)와 빈도를 기록한다. **Scaffold 관련 revision이 논문의 main design contribution**이며, Write revision은 secondary로 보고한다.

## 15. E1–E6 Mapping

| 산출물 | 주 데이터 | 보조 데이터 |
|---|---|---|
| **E1** Case-report Writing Difficulties | 도입부 인터뷰 | Q1, Q6 |
| **E2** Core Competencies | §9 중요도·Top 3·자유서술 | Q8, Q13 |
| **E3** Write Practical Utility & Requirements | Q1–Q7, CRF W1–W4 | Write system log(§5), 관찰 노트 |
| **E4** Scaffold Educational Utility & Requirements | Q8–Q13, CRF S1–S4 | Scaffold 직접 사용 관찰·로그 |
| **E5** System-wide Safety & Applicability | Q14–Q16, CRF C1–C4 | `ai_unsupported_instances`, `expert_edits` |
| **E6** Student Study Resources | Q17 | 사례 적합성 관련 언급 전체 |

**E3와 E4는 분리해서 보고한다.** 두 산출물을 하나의 "시스템 평가"로 합치지 않는다.

---

# PART VII. Student Case / Expert Reference

## 16. Student Case 선정

**원칙: 전문가가 Write에서 사용한 사례를 Student Case로 자동 사용하지 않는다.** 전문가 세션의 목적은 사례 수집이 아니며, 사례 제공 동의 범위가 다르다.

```
후보 사례 수집
 → 임상적 suitability review
 → eligible pool
 → Pilot Case
 → Main Case (1개)
```

**적합성 기준 (초안)**

희귀·특이 사례 자체는 증례보고의 자연스러운 대상이므로 **일괄 배제하지 않는다.** 배제는 아래 표의 기준에 따른다.

| 기준 | 조건 |
|---|---|
| 내원 횟수 | 경과가 드러나되 과도하지 않은 범위 `[결정 필요]` (예: 3~6회) |
| 질환 | 한의 임상에서 일반적이고, 수련의가 배경지식을 가진 영역 |
| 경과 명확성 | 중재와 반응의 시간적 연결이 기록에서 확인 가능 |
| 기록 완결성 | S/O/A/P가 일정 수준 채워져 있을 것 |
| 누락정보 존재 | **의도적으로 완벽하지 않아야 한다** — 누락 인식 과제가 성립해야 함 |
| 비식별 가능성 | 시스템 비식별화 후 HIGH risk 잔존 없음 |
| 분량 | 45~90분 세션 내 처리 가능 `[파일럿 후 확정]` |
| 배제 | ① **수련의 수준을 넘어서는 고도의 전문지식이 필요하거나, 임상 판단 난이도가 과도하여 Scaffold 사용성보다 사전 임상지식 차이가 결과를 지배할 가능성이 높은 사례** ② **고위험·민감도가 높아 초기 교육용 Pilot에 부적절하거나 별도 안전성 고려가 필요한 사례** |

**심사** 연구자 1차 선별 후 임상 전문가 검토. `[결정 필요]` 심사자 인원 및 Expert Reference 구축자와의 중복 허용 여부.

## 17. Expert Reference

Main Case 확정 후 별도 구축한다. **가능하면 전문가 2명 이상**, 독립 작성 후 대조.

> **표현 원칙** 문서 전반에서 **Expert Reference / reference-based comparison**으로만 표현한다. 두 전문가가 모두 포함한 항목을 `core`로 두는 것은 분석 편의를 위한 구분이며, 이를 **objective ground truth**나 **absolute correctness**로 부르지 않는다. 학습자 응답과의 차이는 "틀림"이 아니라 "reference와의 차이"로 기술한다.

| 구성요소 | 내용 | 대응 Student metric |
|---|---|---|
| Key Information | 해당 section에서 반드시 포함되어야 할 정보 항목 | L1 key info recall |
| Missing Information | 기록에 없는데 증례보고에 필요한 정보 | L1 missing detection |
| Additional Confirmation | 확인하면 얻을 수 있는 정보 | L1 additional confirmation 일치 |
| Expert / Instructor Judgment | 교수자 검토가 필요하다고 본 항목 | L2 `needs_instructor_review` 대조 |
| Case Focus | 이 증례의 초점 | L1 (선택) |
| Evidence | 각 항목의 근거가 되는 원기록 위치 | L1 evidence selection |

**Ambiguous item 처리 방향** (세부 scoring algorithm은 고정하지 않는다)
- 두 전문가가 **모두 포함**한 항목 → `core` (주 분석 대상)
- **한 명만** 포함한 항목 → `optional` (별도 집계, 주 지표에서 제외하거나 민감도 분석)
- 표현이 다르나 같은 내용 → 병합. 병합 판단 기준은 `[분석 protocol 확정 시 결정]`
- 학생 응답과 reference의 partial match 처리 → `[분석 protocol 확정 시 결정]`
- Expert Reference는 **버전 관리**한다 (`ref_v1`, `ref_v2`). 분석 결과에는 사용한 버전을 명시한다.

---

# PART VIII. Student Pilot

## 18. Pilot 목적

| 확인 항목 | 무엇을 보는가 | 조정 대상 |
|---|---|---|
| UI 이해 | 각 단계의 지시문이 설명 없이 이해되는가 | 화면 문구 |
| Task time | section당 실제 소요 | 수행 section 범위 |
| Question 난이도 | 판단 항목이 답할 수 있는 수준인가 | 과제 난이도, 안내문 |
| Fatigue | 몇 번째 section부터 응답이 얕아지는가 | section 수 상한 |
| Evidence selection | 근거 선택 과제가 성립하는가 | 근거 카드 표시 방식 |
| Judgment 이해 | 4종 판단 카테고리를 구분하는가 | 카테고리 명칭·설명 |
| AI reveal | 공개 전 우회 시도가 있는가, 공개 후 행동 변화가 관찰되는가 | reveal gate 설계 |
| Logging/persistence | pre-AI state·AI output·post-AI state가 누락 없이 저장되는가 | 로깅 구현 |

**Pilot N** `[결정 필요]` — 후보 범위 **3~5명**. 교수님 확인 필요 (미팅 브리프 결정사항 ⑥).
**Pilot 참가자는 Main Study에 포함하지 않는다.**
**Pilot 후 확정 항목:** 수행 section 범위, 세션 총 시간, 설문 문항 최종본, ambiguous item 처리 기준의 실행 가능성.

---

# PART IX. Student Main Study

## 19. 참가자

**Inclusion** 한의사 면허 보유 · 수련 과정 중 · **증례보고 작성 경험 없음** (주저자로 게재·발표한 증례보고 0편)
**Exclusion** Pilot 참여자 · 본 시스템 개발 참여자 · Expert Study 참여자

**Background variables**

| 변수 | 형식 |
|---|---|
| 수련 연차 | 1~4년차 |
| 수련 기관 유형 | 한방병원 / 대학병원 등 |
| 증례보고 관련 교육 수강 경험 | 유·무 (있으면 형태) |
| 학술논문 작성 경험 | 유·무 (증례보고 외) |
| 생성형 AI 사용 빈도 | 5단계 |
| 학술 글쓰기에 AI 사용 경험 | 유·무 |

**Participant Code** `S##`. 연결표는 연구자 로컬 관리.
**목표 N** `[결정 필요]` — 미팅 결정사항 ⑤에 연동.

## 20. Student Procedure

**전원 동일한 Main Case 1개**를 사용한다. Case를 조건처럼 사용하지 않는다.

```
오리엔테이션 (동의, 시스템 사용법, 연습 화면)
 → EMR 제시
 → section 진입
 → 원기록 / evidence 탐색
 → key information 기재
 → missing / additional confirmation / instructor review 판단
 → [pre-AI state 저장]
 → live AI generation
 → AI draft 공개
 → 원기록 ↔ AI 비교
 → AI 문장별 post-AI judgment
 → section 완료
 → (다음 section 반복)
 → 최종 설문 (Level 3)
```

**수행 section 범위** `[파일럿 후 확정]`. 현재 후보: Clinical Findings + Diagnostic Assessment (기록 기반 / 추론 기반 각 1개). Introduction 포함 여부는 fatigue 확인 후 결정.

**현재 구현 상태와 향후 필요 사항의 구분**

| | 현재 구현 | Student Main을 위해 추가 필요 |
|---|---|---|
| 학습자 사전 기재 | `sectionReflections.learnerKeyInformationItems`, `learnerIdentifiedMissingItems`, `additionalConfirmationItems`, `teacherReviewItems` | — |
| 판단 카테고리 | `InformationStatusJudgment` 5종, `DraftJudgment` 4종 | — |
| pre-AI state | `preRevealSnapshot` (studyMode에서 생성) | Main Study 조건에서 **반드시 생성되도록 보장** + 스냅샷 완결성 검증 |
| 근거 선택 저장 | `evidence_opened` 이벤트(열람)는 있으나, **"작성 근거로 선택했다"는 선택 상태의 저장 여부가 확정되지 않음** | `selectedEvidenceIds`가 immutable pre-AI state에 실제 저장되는지 검증 — **[Student Pilot 전 개발/검증 필요]** (§21.1) |
| AI 공개 게이트 | `ai_draft_revealed` 이벤트, reveal 후 draft 로드 | 우회 경로 차단 확인 + **generation timing 변경** (§26 P0-A) |
| pre-AI API payload | 현재 응답에 AI 파생 결과가 포함될 가능성 있음 | **AI-derived hint 제거/sanitize** (§26 P0-B) |
| AI output 저장 | 최종 `sectionDrafts` | **section별 최초 공개 시점의 AI output 원문**을 별도 보존 (§26) |
| AI 생성 메타데이터 | chain별 소요시간·cacheHit | model / model version / prompt version / parameters 저장 (§26) |
| AI 문장 직접 편집 UI | **없음** | 구현 시에만 §22의 edit metric 계산 가능 |
| 재생성 | — | regeneration 발생 시 회차별 output 저장 |

이는 Student Main 착수 전 개발 항목이며, **Expert Study 범위가 아니다.** 이 중 §26의 **P0-A / P0-B는 Student Pilot Blocker**다.

---

# PART X. Student Metrics

## 21. Level 1 Metrics — Expert Reference 기반 (AI 공개 전)

공통 사항: **분석 단위는 `참가자 × section`**. 데이터 출처는 `preRevealSnapshot` (AI 공개 이전 상태) — 최종 상태를 쓰면 AI 노출 이후의 수정이 섞인다.

### 21.1 Evidence — Exploration과 Selection을 분리한다

**열어본 것(opened)과 근거로 선택한 것(selected)은 다른 행동이다.** 두 개를 하나의 "evidence selection" 지표로 합치지 않는다.

#### 21.1-A. Evidence Exploration

| 항목 | 내용 |
|---|---|
| 정의 | 학습자가 어떤 원기록/evidence를 **열어보고 탐색했는가** |
| Data source | `evidence_opened` 이벤트 (AI 공개 이전 구간에 한정) |
| 후보 지표 | `evidence_open_count` (총 열람 횟수) · `distinct_evidence_opened` (중복 제외 열람 항목 수) · `reference_evidence_reached` (Expert Reference evidence 중 열어본 항목의 비율) · `pre_ai_exploration_scope` (AI 공개 전 열람 범위) |
| 분석 단위 | 참가자 × section |
| 해석 | **탐색 행동의 범위**로만 해석한다. 정답률이나 선택 정확도로 해석하지 않는다 |
| 상태 | 확정 (현재 구현으로 계산 가능) |

#### 21.1-B. Evidence Selection

| 항목 | 내용 |
|---|---|
| 정의 | 학습자가 **"이 정보가 작성 근거다"라고 실제로 선택한** evidence |
| Data source | `selectedEvidenceIds` 또는 그에 대응하는 실제 선택 저장 필드 (**열람 이벤트를 대용으로 쓰지 않는다**) |
| 분자 | reference evidence 중 학습자가 **선택**한 항목 수 |
| 분모 | reference evidence(`core`) 총 항목 수 |
| 분석 단위 | 참가자 × section |
| 해석 | 필요한 근거를 작성 근거로 채택했는가. Expert Reference **대비 상대값**이며 절대적 정답률이 아니다 |
| 부가 | `irrelevant_evidence_selection` — reference에 없는 항목의 선택 수 (낮은 것이 좋다고 해석하지 않는다) |
| Precision | 필요 시 `선택 중 reference 포함 비율`. 참고 지표로만 |
| Ambiguous 처리 | `optional` evidence는 분모에서 제외하고 별도 집계 |
| 상태 | **[Student Pilot 전 개발/검증 필요]** |

> **검증 필요 사항 (Student Pilot 전 필수)**
> `selectedEvidenceIds`가 **`preRevealSnapshot` 또는 동일한 immutable pre-AI state에 실제로 저장되는지** 확인해야 한다. 현재 구현에서 pre-AI 시점의 선택 상태가 별도 보존되는지가 확정되지 않았다. 저장되지 않으면 **Evidence Selection 지표는 계산할 수 없고, Exploration 지표만 남는다.** (§32.1 Student Pilot Blocker)

### 21.2 Key Information

| 항목 | 내용 |
|---|---|
| 정의 | Expert Reference key information 중 학습자가 독립적으로 기재한 비율 |
| 분자 | 학습자 기재 항목 중 reference `core` key item과 대응하는 항목 수 |
| 분모 | reference `core` key item 수 |
| Data source | `preRevealSnapshot.learnerKeyInformationItems` |
| 분석 단위 | 참가자 × section |
| 해석 | AI 없이 원기록에서 핵심정보를 얼마나 구성하는가 |
| 부가 | `missed_key_items` — 누락된 key item 목록(빈도 집계). **어떤 항목이 공통으로 누락되는가가 설계 시사점** |
| Ambiguous 처리 | 표현이 다른 동일 항목의 대응 판정 및 partial match 기준 → `[분석 protocol 확정 시 결정]` |

### 21.3 Missing Information

| 항목 | 내용 |
|---|---|
| 정의 | Expert Reference missing item 중 학습자가 누락으로 인식한 비율 |
| 분자 | 학습자 기재 항목 중 reference missing item과 대응하는 수 |
| 분모 | reference `core` missing item 수 |
| Data source | `preRevealSnapshot.learnerIdentifiedMissingItems` |
| 해석 | 기록에 없는 것을 인지하는 능력 (§8 역량 7) |
| 부가 | `false_missing_judgment` — 기록에 실제로 존재하는데 누락으로 판단한 항목 수. **원기록 탐색 부족의 지표로 해석**하되, 학습자 표현의 모호성을 함께 검토 |

### 21.4 Additional Confirmation

| 항목 | 내용 |
|---|---|
| 정의 | "추가 확인이 필요하다"는 학습자 판단이 전문가 기준과 일치하는 정도 |
| 분자 | 학습자 `additionalConfirmationItems` 중 reference Additional Confirmation과 대응하는 수 |
| 분모 | reference `core` additional confirmation item 수 |
| Data source | `preRevealSnapshot.additionalConfirmationItems`, `questionTaskResults[].status = needs_additional_confirmation` |
| 해석 | 누락(§21.3)과 추가확인을 **구분**할 수 있는가 (§8 역량 8) |
| 부가 | `judgment_category_confusion` — 같은 항목을 missing / additional confirmation / instructor review 중 어디에 넣었는지의 분포. 카테고리 설계 개선 근거 |

### 21.5 Instructor Review 판단

| 항목 | 내용 |
|---|---|
| 정의 | 교수자 검토가 필요하다고 판단한 항목이 전문가 기준과 겹치는 정도 |
| Data source | `preRevealSnapshot.teacherReviewItems` |
| 해석 | 자신의 판단 한계를 인식하는가. **일치율이 낮다고 능력 부족으로 해석하지 않는다** — 초보자가 무엇을 어렵게 느끼는지의 자료 |

### 21.6 Case Focus (선택)

| 항목 | 내용 |
|---|---|
| 정의 | 학습자가 서술한 증례의 초점이 reference case focus와 부합하는 정도 |
| Data source | `preRevealSnapshot.learnerNotes` 또는 별도 입력란 `[결정 필요]` (현재 전용 필드 없음) |
| 분석 | 정량화하지 않고 **정성 코딩**(부합 / 부분 부합 / 상이)으로 처리 |

### 21.7 Level 1 해석 원칙
- 모든 비율 지표는 **Expert Reference 대비 상대값**이며 절대적 정답률이 아니다.
- reference 자체가 전문가 2명의 합의 산물이므로, 낮은 값을 학습자의 오류로만 해석하지 않고 **reference의 모호성**도 함께 검토한다.
- 단일군이므로 **비교 대상이 없다.** "얼마나 잘했는가"가 아니라 "어떤 항목에서 공통적으로 막히는가"를 본다.

---

## 22. Level 2 Metrics — AI 공개 이후

> **핵심 제약 1 — 고정 answer key 금지.** AI output이 참가자마다 다르므로 **고정 answer key로 AI review accuracy를 단순 계산하지 않는다.** 객관적 코딩이 가능한 것은 **명백한 EMR/evidence mismatch**(기록에 없는 사실의 서술, 수치·날짜 불일치)뿐이며, 임상적 타당성 판단은 **expert adjudication**이 필요하다. adjudication 절차와 인원은 `[결정 필요]`.
>
> **핵심 제약 2 — pre/post 판단 대상이 항상 같은 객체가 아니다.** pre-AI 판단은 *기록 정보 / 누락 / 추가확인*에 대한 것이고, post-AI 판단은 *AI draft 문장*에 대한 것이다. 따라서 **item-level transition은 같은 item ID 또는 명시적으로 대응되는 동일 semantic item이 pre/post 양쪽에 존재하는 경우에만** 사용하고, 그렇지 않은 변화는 **section-level change**로 별도 기술한다. 두 가지를 섞지 않는다.

| Metric | 정의 | Data source | 계산 | 해석 | 상태 |
|---|---|---|---|---|---|
| **item-level** pre→post judgment change | 동일 항목에 대한 사전 판단이 AI 공개 후 바뀜 비율 | `preRevealSnapshot.reviewItemJudgments` ↔ 최종 `reviewItems[].judgment` | **같은 item ID 또는 명시적으로 대응되는 동일 semantic item이 pre/post 양쪽에 존재하는 항목에 한정** | AI 노출 전후 판단의 변화 | **후보** |
| 4×4 transition matrix | 어느 카테고리에서 어디로 이동했는가 | 동일 | 상기 대응 조건을 만족하는 항목만으로 구성 | 방향성 기술 | **[동일 항목 대응이 가능한 경우에 한해 탐색적으로 사용]** |
| **section-level** — pre-AI issue profile | AI 공개 전 학습자가 제기한 검토 요구의 **category별 개수·분포** (missing / additional confirmation / instructor review) | `preRevealSnapshot.learnerIdentifiedMissingItems` · `.additionalConfirmationItems` · `.teacherReviewItems` | category별 개수를 **병렬 profile**로 제시 | AI 이전에 무엇을 문제로 보았는가 | 후보 |
| **section-level** — post-AI issue profile | AI 공개 후 AI 문장에 대한 판단의 **category별 개수·분포** (`needs_additional_confirmation` / `needs_instructor_review` / `uncertain` 등) | 최종 `reviewItems[].judgment` | 동일하게 병렬 profile로 제시 | AI 공개 후 무엇을 문제로 보았는가 | 후보 |
| **section-level** — 신규 검토 요구의 유형 | AI 공개 후 **새롭게 나타난 검토 요구의 유형**을 기술 | post-AI 생성 항목 중 pre-AI에 없던 것 | 건수 + 유형 정성 코딩 | AI 공개가 무엇을 촉발했는가 | 후보 |
| evidence reopen (여부) | AI 공개 후 원기록을 다시 열었는가 | `evidence_opened` 중 `ai_draft_revealed` 이후 발생 | 이진 (section별) | AI 공개 후 원기록 재확인 발생 여부 [4][6] | 확정 |
| evidence reopen count | 재확인 횟수 | 동일 | 건수 | AI 공개 후 원기록 재확인 빈도 | 확정 |
| post-AI review time | AI 공개 ~ section 완료 소요 | `ai_draft_revealed` → `draft_review_completed` | 시간차 | AI 공개 후 검토에 사용된 시간 | 확정 |
| draft sentence judgment 분포 | AI 문장별 판단 분포 — **Level 2의 핵심** | `reviewItems[sourceType='draft_sentence'].judgment` | `supported_by_record` / `needs_additional_confirmation` / `needs_instructor_review` / `uncertain` 비율 | AI 문장에 대한 판단의 분포 | 확정 |
| `non_supported_judgment_rate`<br>근거충분 이외 판단 비율 | **AI 문장을 즉시 `supported_by_record`로 판단하지 않은 비율** | 동일 | 1 − `supported_by_record` 비율 (`needs_additional_confirmation` · `needs_instructor_review` · `uncertain`을 모두 포함) | 학습자 판단의 분포 지표 | 확정 |
| AI 오류 지적 (objective) | **명백한** EMR mismatch를 지적했는가 | 참가자별 AI output에 대한 사후 전문가 코딩 + 학습자 판단 | 지적 수 / 해당 output에 실제 존재한 mismatch 수 | **참가자별 분모가 다름을 반드시 명시** | 후보 |
| 추가확인 전환 | AI 문장을 추가확인으로 넘긴 수 | `needs_additional_confirmation` 판단 수 | 건수 | 판단 유보 행동 | 확정 |
| instructor review 전환 | 교수자 검토로 넘긴 수 | `needs_instructor_review` 판단 수 | 건수 | 자기 한계 인식 | 확정 |
| regeneration 사용 | 재생성을 요청했는가 | 재생성 이벤트 (§26에서 구현 필요) | 이진 / 횟수 | AI 결과 불만족 신호 | 후보 |
| AI output variability | 참가자 간 AI output 차이 | 저장된 output 전수 | 길이·문장수·주요 주장 항목의 분산 | **분모 차이 보정 및 해석의 전제** | 확정 |

### 22.1 AI 수용 / 수정 metric — 현재 구현에서는 계산 불가

현재 Scaffold는 **AI draft를 문장 단위로 자유편집하는 기능이 핵심이 아니며, 해당 UI가 없다.** 따라서 아래 지표는 **핵심 지표에서 제외**하고, 편집 UI가 Student Pilot 전에 구현되는 경우에만 사용하는 후보로 둔다.

| Metric | 조건부 정의 | 현재 상태 |
|---|---|---|
| accepted unchanged | 공개 시점 AI 문장 중 수정 없이 유지된 문장 비율 | **계산 불가** (편집 UI 없음) |
| modified | 수정된 문장 수 및 수정 유형 | **계산 불가** |
| deleted | 삭제된 문장 수 | **계산 불가** |

**Level 2의 핵심은 편집이 아니라 판단이다.** `supported_by_record` / `needs_additional_confirmation` / `needs_instructor_review` / `uncertain` 분포를 주 지표로 사용한다.

### 22.2 행동 지표 해석 원칙

**`non_supported_judgment_rate`는 AI 문장이 실제로 근거 없다는 비율이 아니다.** 학습자가 즉시 '근거 충분'으로 넣지 않은 비율일 뿐이며, 판단 보류·불확실성도 같이 들어간다. AI output의 실제 오류율과 혼동하지 않는다.

**높은 재확인 빈도나 긴 검토시간은 비판적 검토를 의미할 수도 있지만, 혼란이나 어려움을 반영할 수도 있으므로 다른 정성자료·판단 결과와 함께 해석한다.** reopen이 많거나 review time이 길다고 해서 자동으로 좋은 행동으로 해석하지 않으며, 반대 방향도 마찬가지다.

### 22.3 AI output variability를 반드시 먼저 기술한다
Level 2의 모든 비율 지표는 참가자마다 다른 output에 대한 값이다. 결과 보고 시 **AI output 특성(길이, 문장 수, 명백한 mismatch 수)을 먼저 기술**하고, 그 위에서 학습자 행동을 해석한다.

---

## 23. Level 3 Metrics / Survey

각 domain에 대해 **① 무엇을 측정하는가 ② 사용 가능한 검증 척도 후보 ③ 연구 맞춤 문항이 필요한 부분**을 정리한다. 실제 문항 초안은 §25.

### 23.1 Usability
- **측정 대상** 시스템 조작의 용이성, 학습 용이성
- **검증 척도 후보** SUS [11] — 10문항, 다수 연구에서 사용, 규준 점수 존재 [12]
- **맞춤 필요** SUS는 전반적 사용성만 측정하며 "학습 활동으로서의 적절성"은 다루지 않는다 → 별도 domain으로 분리

### 23.2 Perceived Learning Support
- **측정 대상** 이 활동이 증례보고 작성 학습에 도움이 된다고 인식하는 정도
- **검증 척도 후보** 본 맥락(증례보고 + AI scaffold)에 맞는 validated scale을 확인하지 못했다
- **맞춤 필요** **전부 Custom.** 학습 성과가 아니라 **인식(perception)**을 묻는 문항으로 한정한다

### 23.3 AI Verification / Critical Review
- **측정 대상** AI 결과를 검증하려는 태도, 검증이 가능하다고 느끼는 정도
- **검증 척도 후보** 자동화 신뢰 척도 [13], 자동화 신뢰 설문 [14] — 다만 "자동화 시스템 신뢰" 개념이며 "AI 산출물 검증 행동"과 정확히 일치하지 않는다
- **맞춤 필요** 신뢰 척도를 그대로 쓰지 않고 **Custom 문항**을 쓰되, 개념적 근거로 [4][5][6]을 인용한다. **행동 지표(Level 2)가 주 자료이고 이 domain은 보조다**

### 23.4 User Control
- **측정 대상** AI 결과를 그대로 따르지 않고 **자신의 판단을 적용할 수 있었다고 느끼는 정도**
- **검증 척도 후보** 단독 validated scale 없음. Human-AI interaction 설계 원칙 [3]이 개념적 근거
- **맞춤 필요** Custom. **문항은 현재 Scaffold의 실제 기능(문장별 판단 선택)에 맞춘다.** "원하는 방식으로 자유 수정"처럼 존재하지 않는 기능을 전제하지 않는다

### 23.5 Workload
- **측정 대상** 과제 수행 중 주관적 부담
- **검증 척도 후보** NASA-TLX [15] 또는 가중치 없는 Raw TLX [16]
- **맞춤 필요** 없음 — 원 척도를 사용하되 **어느 형태를 쓸지는 §24 참조**

### 23.6 Usefulness / Educational Intention
- **측정 대상** 유용하다고 느끼는 정도, 향후 사용/추천 의향
- **검증 척도 후보** TAM의 perceived usefulness [17] — 원 문항은 업무 성과 문맥이라 교육 맥락으로 adapt 필요
- **맞춤 필요** Adapted (원 척도 인용 + 문맥 수정 명시) 또는 Custom

---

## 24. 표준척도 후보 검토

**무조건 사용을 확정하지 않는다.** 아래는 비교 결과이며 최종 선택은 `[파일럿 후 확정]`.

### SUS [11]

| | 내용 |
|---|---|
| 장점 | 10문항으로 짧다 · 광범위한 사용 이력과 규준 점수 [12] · 다른 연구와 비교 가능 |
| 단점 | 전반적 사용성만 측정하고 **학습 지원·AI 검증을 전혀 다루지 않는다** · 문항이 일반 소프트웨어 문맥이라 "이 시스템은 불필요하게 복잡하다" 같은 문항이 **의도적으로 부담을 주는 scaffold** 설계와 충돌할 수 있다 |
| 본 연구 적합성 | **조건부 사용 권장.** Scaffold는 의도적으로 단계를 늘린 설계이므로 SUS 점수가 낮게 나올 수 있고, 그것이 설계 실패를 뜻하지 않는다. 사용한다면 **결과 해석에 이 점을 명시**하고, 단독 결론 근거로 쓰지 않는다 |

### NASA-TLX [15][16]

| | 내용 |
|---|---|
| 장점 | 6개 하위차원으로 부담의 **종류**를 구분 · 표준화되어 있고 널리 사용 · Raw TLX는 가중치 절차를 생략해 시간 부담이 적다 [16] |
| 단점 | 전체 절차(pairwise weighting)는 세션 시간을 상당히 소모 · 원래 조종·감시 과제용으로 개발되어 일부 차원(physical demand)은 본 과제와 관련이 적다 |
| 본 연구 적합성 | **Raw TLX 사용을 권장.** physical demand 포함 여부는 `[결정 필요]` — 제외하면 원 척도 수정이므로 "modified Raw TLX"로 명시해야 한다. Scaffold는 부담을 늘리는 설계이므로 **workload를 '낮을수록 좋다'로 해석하지 않는다** |

### Trust / reliance / AI literacy 관련 척도

| 후보 | 검토 |
|---|---|
| Trust in automated systems 척도 [13] | 자동화 시스템 전반에 대한 신뢰·불신 12문항. 본 연구의 "AI 산출물을 원기록과 대조하는 행동"과는 층위가 다르다 |
| Trust in Automation (TiA) 설문 [14] | 다차원 신뢰 측정. 마찬가지로 대상이 "시스템 신뢰"이며 산출물 단위 검증이 아니다 |
| AI literacy 관련 논의 [18] | 역량 프레임워크로서 유용하나 **본 연구에서 쓸 수 있는 validated 측정도구가 아니다** — 개념 인용에 한정 |
| appropriate reliance 측정 [19] | 정답이 알려진 과제에서 AI 조언 수용률로 조작화. 본 연구는 **정답이 정해진 과제가 아니므로 그대로 적용할 수 없다** — 개념 인용에 한정 |

**결론** trust/reliance 영역에서 본 연구 목적에 그대로 맞는 validated scale을 확인하지 못했다. 해당 domain은 **Custom 문항 + Level 2 행동 지표**로 다루고, **검증되지 않은 문항을 validated scale이라고 부르지 않는다.**

---

## 25. Student Survey Candidate Item Pool

**이것은 최종 설문이 아니라 후보 문항 풀(pool)이다.** 현재 모든 문항을 최종 사용한다고 확정한 상태가 아니며, 사용 여부는 `[파일럿 후 확정]`이다.

**표기** `Validated` 원 척도 그대로 · `Adapted` 원 척도 문맥 수정 · `Custom` 본 연구 자체 문항(검증되지 않음)

| # | Domain | Question | Scale | Source | 구분 |
|---|---|---|---|---|---|
| U1–U10 | Usability | SUS 원 10문항 그대로 사용 | 5점 | Brooke 1996 [11] | **Validated** |
| L1 | Perceived Learning Support | 이 활동은 증례보고에 필요한 정보를 찾는 방법을 익히는 데 도움이 되었다. | 5점 | — | **Custom** |
| L2 | Perceived Learning Support | 기록에서 빠진 정보를 찾아내는 연습이 되었다. | 5점 | — | **Custom** |
| L3 | Perceived Learning Support | AI 초안을 보기 전에 스스로 판단한 과정이 학습에 도움이 되었다. | 5점 | 개념 근거 [6] | **Custom** |
| L4 | Perceived Learning Support | 이 활동은 증례보고를 처음 쓰는 사람에게 적절한 난이도였다. | 5점 | — | **Custom** |
| V1 | AI Verification | 나는 AI가 쓴 내용을 원기록과 대조하며 확인했다. | 5점 | 개념 근거 [4][5] | **Custom** |
| V2 | AI Verification | AI가 쓴 내용 중 기록으로 뒷받침되지 않는 부분을 찾을 수 있었다. | 5점 | 개념 근거 [5] | **Custom** |
| V3 | AI Verification | 이 시스템은 AI 결과를 그대로 받아들이지 않도록 도와주었다. | 5점 | 개념 근거 [6] | **Custom** |
| C1 | User Control | AI가 제시한 내용을 그대로 받아들이지 않고 나의 판단에 따라 검토할 수 있었다. | 5점 | 개념 근거 [3] | **Custom** |
| C2 | User Control | AI가 제시한 내용에 대해 추가 확인이나 전문가 검토가 필요한지를 스스로 결정할 수 있었다. | 5점 | 개념 근거 [3] | **Custom** |
| W1–W6 | Workload | Raw NASA-TLX (mental / physical / temporal demand, performance, effort, frustration) | 0–100 (20구간) | Hart & Staveland 1988 [15]; Hart 2006 [16] | **Validated (Raw 형태)** |
| P1 | Usefulness | 이 시스템은 증례보고를 쓰는 데 유용하다. | 5점 | TAM PU adapt [17] | **Adapted** |
| P2 | Usefulness | 앞으로 증례보고를 쓸 때 이런 방식을 사용하고 싶다. | 5점 | — | **Custom** |
| P3 | Educational Intention | 증례보고를 처음 쓰는 동료에게 이 방식을 권하겠다. | 5점 | — | **Custom** |
| O1 | Open | 가장 도움이 된 부분은 무엇이었습니까? | 자유기재 | — | **Custom** |
| O2 | Open | 가장 어렵거나 불필요하다고 느낀 부분은 무엇이었습니까? | 자유기재 | — | **Custom** |
| O3 | Open | AI 초안을 보기 전에 직접 판단하도록 한 것에 대해 어떻게 생각하십니까? | 자유기재 | — | **Custom** |

### 25.1 문항 수 — 현재 후보는 많다

| Domain | 문항 수 |
|---|---|
| SUS | 10 |
| Perceived Learning Support | 4 |
| AI Verification | 3 |
| User Control | 2 |
| Workload (Raw TLX) | 6 |
| Usefulness / Educational Intention | 3 |
| Open-ended | 3 |
| **합계** | **31** |

세션 말미에 31문항은 과다하다. **Pilot에서 문항 이해도·응답시간·중복도를 확인한 뒤 최종 설문을 축약한다.** 어느 domain을 줄일지는 이번 단계에서 결정하지 않는다 `[파일럿 후 확정]`.

### 25.2 SUS 한국어 사용 주의

- 영어 원척도를 그대로 사용하는 경우에만 `Validated`로 표기한다.
- **한국어로 사용할 경우, 어느 번역본을 쓸 것인지와 번역 절차를 별도로 확인해야 한다** `[결정 필요]`. 번역본을 쓸 때는 **해당 번역본의 검증 여부를 확인한 뒤에만** validated라는 표현을 쓴다. 검증되지 않은 자체 번역이라면 `Adapted (translated, 미검증)`으로 표기한다.
- Raw TLX도 동일하게 적용한다.

### 25.3 그 밖 주의

- **Custom 문항은 item-level 기술통계를 기본으로 한다.** 표본 규모와 문항 구조가 적절한 경우에 한해 내적 일관성을 탐색적으로 확인할 수 있으나, **이를 척도 타당화로 해석하지 않는다.** 특히 **2문항 domain(User Control)에는 무리하게 α를 계산하지 않는다.**
- 문항 수·표현은 `[파일럿 후 확정]`. Pilot에서 이해도 문제가 확인되면 수정한다.
- SUS·Raw TLX를 함께 쓸 경우 세션 말미 설문 소요가 늘어난다. 실측 후 조정 `[파일럿 후 확정]`.

---

# PART XI. AI Generation Data

## 26. AI Generation — Student Pilot 전 P0

### P0-A. AI Draft Generation Timing `Student Pilot Blocker`

**현재 구현으로 추정되는 흐름**

```
/process → AI draft 생성 → (숨김) → learner pre-AI task → reveal
```

**최종 Student Study 의도**

```
learner pre-AI reasoning → immutable pre-AI snapshot → live AI generation → reveal
```

서버 내부에서 draft가 먼저 생성되었더라도, 학습자에게 전혀 노출되지 않고 AI-derived hint가 pre-AI 판단에 영향을 주지 않는다면(→ P0-B) **행동의 pre/post 구분 자체는 가능하다.** 다만 최신 연구설계는 `pre-AI reasoning → immutable snapshot → live AI generation → reveal`이므로, generation timing을 설계와 일치시키는 것이 Student Pilot 전에 필요하다.

> **Student Pilot Blocker.** 미해결 시 **최신 Scaffold intervention의 fidelity와 AI generation condition의 재현성이 훼손된다.**

### P0-B. Pre-AI API Leakage `Student Pilot Blocker`

UI에서 숨겨져 있더라도 **pre-AI 시점의 API response에 AI 파생 결과가 포함될 가능성**이 있다. 확인 대상:

- `missingInfoBullets`
- `recommendedQuestions`
- `adequacyReview`
- unsupported claims
- 기타 AI-derived hint

Student Pilot 전에 **pre-AI API response에서 AI-derived 결과를 제거/sanitize하여, 학습자가 AI output에 노출되기 전 상태를 시스템 수준에서 분리**해야 한다. 브라우저 개발자도구로 payload를 직접 확인하는 절차를 검증에 포함한다.

> **Student Pilot Blocker.** 미해결 시 "AI 공개 전 독립 판단"이라는 전제가 무너지고, Level 1 자료를 사용할 수 없다.

## 26.1 반드시 저장할 AI metadata

Student Pilot/Main 착수 **전**에 확보해야 한다. Expert Study에서는 필수가 아니다.

| 항목 | 현재 구현 | Student Main 필요 | 비고 |
|---|---|---|---|
| participantCode | ✅ | 필수 | export에 포함 |
| sessionId | ✅ | 필수 | 모드별 발급 |
| caseId | ✅ | 필수 | |
| sectionId | ✅ | 필수 | |
| model 이름 | ❌ 생성물에 미기록 | **필수** | 현재 환경변수로 chain별 결정되며, 결과에 남지 않음 |
| model version | ❌ | **필수** | API 응답의 실제 모델 식별자를 저장 |
| prompt version | ❌ | **필수** | prompt 파일 버전/해시. 현재 버전 개념 없음 |
| generation parameters | ❌ (temperature=0 고정) | **필수** | temperature 등 실제 사용값을 기록 |
| input (전달된 비식별 텍스트) | 부분 (case document로 재구성 가능) | **필수** | 생성 시점 입력을 그대로 보존 |
| output (공개 시점 원문) | ❌ (최종본만 남음) | **필수** | 학습자 수정 전 AI 원문 |
| timestamp | ✅ (chain 로그) | 필수 | |
| regeneration 회차 | ❌ | 필요 시 필수 | 회차별 output 전부 보존 |
| cache 사용 여부 | ✅ `cacheHit` | 필수 | **동일 참가자 내 캐시 재사용이 "재생성"으로 오인되지 않도록 기록 필요** |

**live generation 조건 고정** 동일 EMR / 동일 model / 동일 model version / 동일 prompt + prompt version / 동일 generation parameters / 동일 workflow. 사전 생성된 고정 draft를 제공하지 않는다. **참가자별 실제 output은 전부 저장한다.**

**운영 주의** 연구 기간 중 모델 버전이 공급자 측에서 변경될 수 있다. 세션마다 실제 사용된 model version을 기록하고, **분석 시 버전이 섞였는지 확인**한다.

---

# PART XII. Research Logging

## 27. Event / Timing Metrics

**모든 클릭을 수집하지 않는다.** 아래 이벤트는 §5·§21·§22의 특정 지표에 직접 대응하는 것만 남긴 것이다.

| Event | 왜 필요한가 | Expert / Student | 필수 여부 |
|---|---|---|---|
| `session_start` | 세션 시작 기준점 (모든 소요시간의 원점) | 양쪽 | 필수 |
| `case_created` | case–session 연결 | 양쪽 | 필수 |
| `mode_assigned` | write/scaffold 구분 | 양쪽 | 필수 |
| `case_processed` | 최초 AI 처리 완료 — 대기시간 | Expert(Write) | 필수 |
| `section_opened` | section 열람·체류시간·재방문 | 양쪽 | 필수 |
| `evidence_opened` | **근거 확인 행동** — L2 evidence reopen의 원자료 | 양쪽 | 필수 |
| `question_viewed` | 질문 도달 여부 | Expert(Write) | 필수 |
| `question_answered` | 질문 실제 활용 | Expert(Write) | 필수 |
| `review_ai_requested` | 검토 기능 사용 | Expert(Write) | 필수 |
| `review_ai_result_viewed` | 실행 후 결과 확인 여부 | Expert(Write) | 선택 |
| `final_output_viewed` | 완주 지표 | Expert(Write) | 필수 |
| `export_requested` | 완주 지표 | Expert(Write) | 필수 |
| `section_purpose_viewed` | 지시문 열람 여부 (Pilot의 UI 이해 항목) | Scaffold | 선택 |
| `record_review_started` / `record_review_completed` | 원기록 탐색 구간 — 탐색 소요시간 | Scaffold | 필수 |
| `learner_reflection_saved` | 사전 기재 저장 시점 | Scaffold | 필수 |
| `information_status_judgment_saved` | 사전 판단 저장 | Scaffold | 필수 |
| `question_task_responded` | 질문 과제 응답 | Scaffold | 필수 |
| `pre_reveal_snapshot_created` | **AI 공개 전 상태 확정 시점** — L1/L2 분리의 기준 | Scaffold(Student) | **필수** |
| `ai_draft_revealed` | **AI 공개 시점** — 모든 post-AI 지표의 기준선 | Scaffold | **필수** |
| `draft_judgment_saved` | 문장별 사후 판단 | Scaffold | 필수 |
| `draft_review_completed` | 검토 종료 — post-AI review time | Scaffold | 필수 |
| `section_completed` | section 종료 | 양쪽 | 필수 |
| `session_completed` | 세션 종료 — 총 소요시간 | 양쪽 | 필수 |

**공통 필드** `eventId` · `eventType` · `timestamp`(ISO) · `caseId` · `mode` · `participantCode` · `sessionId` · `sectionId` · `metadata`

**타임스탬프 주의** 이벤트 시각의 기준(클라이언트/서버)이 섞이면 구간 계산이 어긋난다. 기준을 하나로 고정하고 분석 전 확인한다 (§32 데이터 체크리스트).

---

# PART XIII. Analysis Plan

## 28. Expert 분석

1. **Descriptive statistics** — 배경 변수, CRF 문항별 중앙값·분포(N ≤ 10이므로 개인별 값을 함께 제시), competency 중요도 중앙값 및 Top 3 빈도, system log 지표의 중앙값·범위
2. **Thematic analysis** [10] — §14 절차
3. **Design requirement extraction** — §14 traceability 사슬. 각 requirement에 근거 참가자와 빈도를 명시하고, Scaffold / Write 대상으로 분리
4. **하지 않는 것** 집단 간 검정 · 상관분석으로 인과 주장 · Write와 Scaffold 문항 점수 비교

## 29. Student 분석

**단일군 설계에 맞는 분석만 수행한다. 새로운 비교군을 가정하지 않는다.**

1. **Descriptive statistics** — 배경 변수, Level 1/2/3 지표의 중앙값·사분위·범위, 개인별 분포
2. **Expert Reference comparison** — Level 1 지표. **참가자 간 비교가 아니라 항목별 집계**를 주로 본다 (어떤 key/missing item이 공통으로 누락되는가)
3. **Within-participant pre/post-AI 비교** — 동일 참가자의 AI 공개 전후 판단 변화를 기술한다. **pre/post가 동일한 분석단위와 동일 척도로 대응되는 지표가 최종 확정된 경우에만** 적절한 paired exploratory analysis를 검토한다. **현재 단계에서 특정 검정법을 확정하지 않는다** (§22의 item-level / section-level 구분 참조). 어떤 분석을 하든 탐색적임을 명시하고 확증적 결론을 내지 않는다
4. **Qualitative / open-ended** — 자유기재 응답을 §14와 동일한 절차로 코딩
5. **AI output variability 기술** — §22.1. Level 2 해석의 전제로 먼저 보고
6. **하지 않는 것** 실험군 비교 · 효과크기로 학습효과 주장 · 사전 등록 없는 확증적 가설검정

---

# PART XIV. Claim Boundary

## 주장 가능

- 시스템의 **usability**
- **educational utility / perceived learning support** — 전문가 및 학습자의 **인식**
- 학습자의 **정보 탐색 행동** (evidence 열람 범위와 패턴)
- **누락정보 인식** 수준과 공통 누락 항목
- **AI 공개 전후 검토 행동의 변화** (within-participant)
- **AI 검증 행동** (원기록 재확인, 문장별 판단 분포)
- 전문가가 제시한 **설계 요구사항** 및 그것이 반영된 revision
- Write의 **실무 활용 가능성 및 개선 요구** (formative, secondary)

## 주장 불가

- ❌ Scaffold가 학습능력을 **향상**시킨다
- ❌ Scaffold가 Write보다 **교육효과가 높다**
- ❌ 사용 **전보다** 능력이 향상되었다
- ❌ **장기적** 증례보고 작성역량이 향상되었다
- ❌ 기존 교육 방식 대비 **우월**하다
- ❌ N=5~10에서 **포화(saturation)**에 도달했다
- ❌ Custom 설문이 **validated scale**이다

**표현 규칙** "교육효과 검증" ✗ → *educational utility / learning support / educational applicability* ○

---

# PART XV. 실험 운영 체크리스트

## 30. Expert Session Checklist

### 실험 전 (당일 아침)
```
[ ] 서버·프론트 정상 동작 확인 (테스트 case 1건 처리)
[ ] AI API 정상 응답 확인
[ ] participantCode 발급 및 중복 확인 (E01~)
[ ] 세션 브라우저 초기화 — 이전 참가자의 participantCode/sessionId 잔존 없음
[ ] 녹음기기 확인 (배터리, 저장공간, 시험 녹음)
[ ] 동의서 인쇄/전자 준비
[ ] fallback 연구용 사례 준비
[ ] CRF·competency 평정지·인터뷰 가이드 준비
```

### 실험 중
```
[ ] 동의 취득 및 서명 확인
[ ] 녹음 시작 (시작 시각 기록)
[ ] 배경 변수 기록
[ ] participantCode 입력 (Write)
[ ] EMR 입력 및 비식별화 결과 확인
[ ] Write 필수 step 13개 완료 (§4.1)
[ ] 관찰 노트: navigation stumble, AI 오류 지적, 수정 지점
[ ] Write CRF (W1–W4 + 자유기재)
[ ] Write Core 인터뷰 Q1·Q2·Q4·Q5·Q7 우선 수행 (Q3·Q6은 응답 내용과 시간에 따라 Optional)
[ ] Core competency 평정 (Scaffold 노출 전!)
[ ] participantCode 입력 (Scaffold) — Write와 동일한지 확인
[ ] Scaffold Clinical Findings 직접 사용
[ ] Diagnostic Assessment walkthrough
[ ] Introduction walkthrough
[ ] Scaffold CRF (S1–S4 + 자유기재)
[ ] Scaffold Core 인터뷰 Q8·Q9·Q10·Q12·Q13 우선 수행 (Q11은 필요 시 probe)
[ ] 전체 CRF (C1–C4)
[ ] System-wide Core 인터뷰 Q14·Q15·Q16 수행 (Q17은 시간 허용 시 Optional)
[ ] 세션 종료 처리 (session_completed 발생 확인)
```

### 실험 후 (당일 내)
```
[ ] 녹음 파일 저장·백업 (파일명 = participantCode)
[ ] Write research export (JSON) 다운로드
[ ] Scaffold research export (JSON) 다운로드
[ ] 두 export의 participantCode 일치 확인
[ ] export 내 필수 필드 확인 (§32)
[ ] CRF·평정지 스캔 및 코드 부여
[ ] 관찰 노트 정리 (당일 기억이 남아 있을 때)
[ ] 세션 요약 메모 1장 작성
[ ] 참가자 연결표 갱신 (로컬)
[ ] 다음 참가자용 브라우저 세션 초기화
```

## 31. Student Session Checklist

### 실험 전
```
[ ] 서버·AI 정상 동작 확인
[ ] Main Case 로딩 확인 (전원 동일 case)
[ ] Expert Reference 버전 확인 및 고정 (ref_vN)
[ ] participantCode 발급·중복 확인 (S01~)
[ ] 브라우저 세션 초기화
[ ] model / prompt version 기록 (§26)
[ ] 설문(SUS·TLX·Custom) 준비
[ ] 연습용 오리엔테이션 자료 준비
```

### 실험 중
```
[ ] 동의 취득
[ ] 배경 변수 기록
[ ] 오리엔테이션 및 연습 화면 수행
[ ] participantCode 입력
[ ] section 1 수행
    [ ] 원기록/evidence 탐색
    [ ] key information 기재
    [ ] missing / additional confirmation / instructor review 판단
    [ ] pre-AI snapshot 생성 확인 ★
    [ ] AI 초안 공개
    [ ] 원기록 재확인 여부 관찰
    [ ] 문장별 post-AI 판단
    [ ] section 완료
[ ] section 2 (동일 절차)
[ ] 최종 설문 (Level 3)
[ ] 세션 종료 처리
```

### 실험 후
```
[ ] research export 다운로드
[ ] pre-AI snapshot 존재·완결성 확인 ★
[ ] AI output 원문 저장 확인 ★
[ ] post-AI 판단 저장 확인
[ ] model/prompt version 기록 확인
[ ] 설문 응답 수집 확인
[ ] 연결표 갱신
[ ] 브라우저 세션 초기화
```

---

# PART XVI. Critical Checklist — 놓치면 안 되는 것

> 여기 있는 항목이 하나라도 누락되면 **해당 세션의 자료를 분석에 쓸 수 없거나, 사후 복구가 불가능**하다.

## 32.0 Student Pilot Blocker — Pilot 착수 전 반드시 확인
```
[ ] selectedEvidenceIds가 immutable pre-AI state에 실제 저장되는지 확인 (§21.1-B)
[ ] AI draft가 preRevealSnapshot 이후 실제 생성되는지 확인 (§26 P0-A — intervention fidelity)
[ ] pre-AI API payload에 AI-derived hint가 존재하지 않는지 확인 ★ (§26 P0-B)
[ ] 공개 시점 AI 원문 저장 확인 (§26.1)
[ ] post-AI judgment 대상과 pre-AI item의 ID correspondence 여부 확인 (§22)
```
위 5개가 해결되기 전에는 Student Pilot을 시작하지 않는다. ★ 표시 항목은 미해결 시 **자료를 사후 복구할 수 없다.**

## 32.1 연구 운영
```
[ ] participantCode 중복 발급 — 사전 대장으로 관리, 발급 즉시 기록
[ ] 이전 참가자의 participantCode/sessionId 잔존 — 세션마다 브라우저 초기화
[ ] Write와 Scaffold의 participantCode 불일치 — 두 export에서 대조 확인 (불일치 시 두 자료 결합 불가)
[ ] 녹음 시작 누락 / 중간 중단 — 시작 직후 1분 시점에 녹음 상태 육안 확인
[ ] CRF·competency 평정지 미회수
[ ] research export 다운로드 누락 — 세션 종료 직후 즉시 수행
[ ] competency 평정을 Scaffold 노출 후에 수행 (순서 오류) — 되돌릴 수 없음
```

## 32.2 데이터
```
[ ] sessionId 누락 — 이벤트를 세션에 귀속시킬 수 없음
[ ] caseId 누락
[ ] timestamp 기준 혼재 (클라이언트/서버) — 구간 계산 왜곡
[ ] pre-AI state 미생성 ★ — Level 1 전체가 성립하지 않음
[ ] AI output 원문 미보존 ★ — Level 2의 수용/수정 지표 계산 불가
[ ] post-AI state 미저장
[ ] 이벤트 순서 역전 (ai_draft_revealed 이전에 draft_judgment_saved 등) — 분석 전 정합성 검사
[ ] export 필수 필드: participantCode / sessionId / caseId / mode / startedAt / completedAt / interactionEvents
```

## 32.3 AI
```
[ ] model 이름·버전 미기록 — 연구 기간 중 공급자 측 버전 변경 가능
[ ] prompt version 미기록 — 프롬프트 수정 후 이전 세션과 조건이 달라짐
[ ] generation parameters 미기록
[ ] 세션 중간에 프롬프트/모델을 수정 — Main Study 기간 중 변경 금지. 불가피할 경우 변경 시점을 기록하고 분석에서 분리
[ ] cache 재사용을 신규 생성으로 오인
[ ] regeneration 회차별 output 미보존
```

## 32.4 개인정보
```
[ ] 비식별화 결과를 확인하지 않고 진행 — 입력 직후 반드시 확인 단계 수행
[ ] 비식별화 위험도 HIGH 상태로 외부 AI 호출 발생 — 시스템 차단 동작 확인
[ ] 원본 임상기록의 외부 전송·사전 제출 요구 — 금지
[ ] 참가자 실명–코드 연결표를 시스템/클라우드에 저장 — 로컬 관리
[ ] 전문가 개인정보와 증례 속 환자 정보의 혼재 — 분리 관리
[ ] 녹음 파일에 환자 식별정보 포함 — 전사 시 제거
[ ] raw data 보관 기간·위치 정책 미확인 — 승인 문서 확인 필요
```

## 32.5 분석
```
[ ] Expert Reference 버전 미기록 — 어느 버전과 비교했는지 불명확
[ ] Expert Reference 수정 후 이전 분석 결과를 갱신하지 않음
[ ] ambiguous item 처리 기준을 분석 도중에 변경 — 사전에 문서화하고 고정
[ ] exclusion 기준 사후 설정 — 사전 정의 (미완료 세션, 시스템 오류로 중단된 세션)
[ ] incomplete session의 부분 자료를 무비판적으로 포함
[ ] AI output variability를 보고하지 않고 Level 2 비율을 해석
[ ] single-arm에서 향상·우월성 주장 (PART XIV)
```

---

# PART XVII. Literature → Measure Traceability

| Literature / Concept | 연구에서의 의미 | Design Feature | Measure |
|---|---|---|---|
| CARE guideline [1] | 증례보고에 필요한 정보 항목의 표준 | 12개 section 구조, section별 key information 정의 | L1 key information recall; Expert CRF C1; Q3 |
| Case report as education [2] | 증례보고 작성이 임상 추론·학술 글쓰기 학습 활동 | 학습자가 직접 수행하는 단계 구성 | E2 candidate competencies; L2/L3 perceived learning support |
| Human-AI Interaction guidelines [3] | AI 산출물을 그대로 따르지 않고 사용자 판단을 적용할 수 있음 | **AI 문장별 판단 + 추가확인 / 전문가검토 등 판단 선택** (직접 자유편집 기능은 현재 없음, §22.1) | L3 User Control (C1–C2) |
| Appropriate reliance [4] | 신뢰가 실제 성능과 맞아야 함 | 근거 카드로 원기록 대조 가능 | L2 evidence reopen; V1–V2 |
| Automation bias [5] | 자동화 산출물을 무비판적으로 수용하는 경향 | AI 문장별 근거 판단 요구 | L2 draft judgment 분포, `non_supported_judgment_rate` |
| Cognitive forcing [6] | **AI 노출 전 독립 판단 유도의 개념적 근거** (효과 검증 대상이 아니다) | pre-AI reasoning + reveal gate | pre/post AI 행동을 **기술**함 (L2 section-level 변화, L3 V3, Q10) |
| Formative usability sample size [7][8] | 소수 참가자로 다수의 usability 문제 발견 | Expert N=5~10 | §2.3 N rationale (포화 주장 아님) |
| Information power [9] | 자료 밀도로 표본 크기를 판단 | 세션당 고밀도 자료 (사용 + 인터뷰) | §2.3 N rationale |
| Thematic analysis [10] | 질적 자료의 theme 도출 절차 | — | §14 분석 절차 |
| SUS [11][12] | 표준화된 사용성 측정 | — | L3 Usability (U1–U10) |
| NASA-TLX [15][16] | 다차원 주관적 부담 | 단계적 과제로 인한 부담을 차원별로 확인 | L3 Workload (W1–W6) |
| TAM perceived usefulness [17] | 지각된 유용성이 수용 의도와 연결 | — | L3 P1 (adapted) |

**과장 금지** 위 연결은 "이 문헌의 개념을 설계·측정에 참고했다"는 수준이다. 각 문헌의 실험 결과가 본 연구에서 재현된다고 주장하지 않는다.

특히 **[6](cognitive forcing)은 다른 과제 맥락의 실험**이며, 본 연구는 그 효과를 검증하는 것이 아니라 **AI 이전 독립 판단이라는 interaction principle을 참고한 것**이다. 단일군 설계이므로 "과의존 감소 효과를 측정한다"처럼 쓰지 않는다.

---

# PART XVIII. Reference

> 서지사항은 기록에 근거해 작성했다. **투고 전 저자·연도·권/호·페이지·DOI를 출판사 원문에서 재확인해야 한다.** 확인되지 않은 항목은 인용하지 않는다.

### 핵심 문헌

1. Gagnier JJ, Kienle G, Altman DG, Moher D, Sox H, Riley D; CARE Group. *The CARE guidelines: consensus-based clinical case report guideline development.* Journal of Clinical Epidemiology. 2014;67(1):46–51.
2. Florek AG, Dellavalle RP. *Case reports in medical education: a platform for training medical students, residents, and fellows in scientific writing and critical thinking.* Journal of Medical Case Reports. 2016;10:86.
3. Amershi S, Weld D, Vorvoreanu M, Fourney A, Nushi B, Collisson P, et al. *Guidelines for Human-AI Interaction.* Proceedings of CHI 2019.
4. Lee JD, See KA. *Trust in automation: designing for appropriate reliance.* Human Factors. 2004;46(1):50–80.
5. Goddard K, Roudsari A, Wyatt JC. *Automation bias: a systematic review of frequency, effect mediators, and mitigators.* Journal of the American Medical Informatics Association. 2012;19(1):121–127.
6. Buçinca Z, Malaya MB, Gajos KZ. *To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance on AI in AI-assisted Decision-making.* Proceedings of the ACM on Human-Computer Interaction. 2021;5(CSCW1).
7. Nielsen J, Landauer TK. *A mathematical model of the finding of usability problems.* Proceedings of INTERCHI 1993.
8. Faulkner L. *Beyond the five-user assumption: benefits of increased sample sizes in usability testing.* Behavior Research Methods, Instruments, & Computers. 2003;35(3):379–383.
9. Malterud K, Siersma VD, Guassora AD. *Sample size in qualitative interview studies: guided by information power.* Qualitative Health Research. 2016;26(13):1753–1760.
10. Braun V, Clarke V. *Using thematic analysis in psychology.* Qualitative Research in Psychology. 2006;3(2):77–101.

### 측정도구 관련

11. Brooke J. *SUS: A "quick and dirty" usability scale.* In: Jordan PW, et al., eds. Usability Evaluation in Industry. Taylor & Francis; 1996.
12. Bangor A, Kortum PT, Miller JT. *An empirical evaluation of the System Usability Scale.* International Journal of Human–Computer Interaction. 2008;24(6):574–594.
13. Jian J-Y, Bisantz AM, Drury CG. *Foundations for an empirically determined scale of trust in automated systems.* International Journal of Cognitive Ergonomics. 2000;4(1):53–71.
14. Körber M. *Theoretical considerations and development of a questionnaire to measure trust in automation.* Proceedings of the 20th Congress of the International Ergonomics Association (IEA 2018).
15. Hart SG, Staveland LE. *Development of NASA-TLX (Task Load Index): Results of empirical and theoretical research.* In: Hancock PA, Meshkati N, eds. Human Mental Workload. North-Holland; 1988:139–183.
16. Hart SG. *NASA-Task Load Index (NASA-TLX); 20 years later.* Proceedings of the Human Factors and Ergonomics Society Annual Meeting. 2006;50(9):904–908.
17. Davis FD. *Perceived usefulness, perceived ease of use, and user acceptance of information technology.* MIS Quarterly. 1989;13(3):319–340.
18. Long D, Magerko B. *What is AI Literacy? Competencies and Design Considerations.* Proceedings of CHI 2020.
19. Schemmer M, Kühl N, Benz C, Bartos A, Satzger G. *Appropriate Reliance on AI Advice: Conceptualization and the Effect of Explanations.* Proceedings of IUI 2023.

**[13][14][18][19]는 개념적 근거로만 인용하며, 해당 척도를 본 연구에서 사용하지 않는다** (§24 결론).

---

## 부록 A. `[결정 필요]` 항목 일람

| § | 항목 | 결정 주체 |
|---|---|---|
| 3.3 | 화면 녹화 여부 (본인 임상기록 노출) | 교수님 + 승인 절차 |
| 4.2 | fallback 연구용 사례의 출처와 편수 | 연구자 |
| 13/Q17 | Student case 제공 요청의 시점·방식 (세션 후 별도 절차) | 교수님 |
| 14 | 2차 코더 확보 여부 | 교수님 |
| 16 | Student case 내원 횟수 범위, 심사자 인원, Expert Reference 구축자와의 중복 허용 | 교수님 |
| 17 | partial match / 항목 병합 기준 → `[분석 protocol 확정 시 결정]` | 연구자 |
| 18 | Student Pilot N (후보 3~5) | 교수님 |
| 19 | Student Main 목표 N | 교수님 |
| 20 | 수행 section 범위 → `[파일럿 후 확정]` | 파일럿 |
| 21.6 | Case focus 전용 입력 필드 신설 여부 | 연구자 |
| 22 | AI output에 대한 expert adjudication 절차·인원 | 교수님 |
| 24 | Raw TLX에서 physical demand 포함 여부 | 연구자 |
| 25 | 설문 문항 최종본 및 축약 대상 domain → `[파일럿 후 확정]` | 파일럿 |
| 25.2 | SUS·Raw TLX 한국어 번역본 선택과 번역 절차 | 연구자 |
| 32.4 | raw data 보관 기간·위치 정책 | 승인 문서 확인 |

## 부록 B. Student Pilot Blocker 일람

**결정이 아니라 개발·검증 항목이다.** 해결 전에는 Student Pilot을 시작하지 않는다.

| § | 항목 | 미해결 시 영향 |
|---|---|---|
| 21.1-B | `selectedEvidenceIds`가 immutable pre-AI state에 저장되는지 검증 | Evidence Selection 지표 계산 불가 (Exploration만 남음) |
| 26 P0-A | AI draft generation timing을 `preRevealSnapshot` 이후로 변경·검증 | 최신 Scaffold intervention fidelity와 AI generation condition 재현성 훼손 |
| 26 P0-B | pre-AI API payload의 AI-derived hint 제거/sanitize ★ | "AI 공개 전 독립 판단" 전제가 무너짐, Level 1 사용 불가 |
| 26.1 | 공개 시점 AI 원문 저장 | Level 2 해석의 전제 소실, 사후 복구 불가 |
| 22 | post-AI judgment 대상과 pre-AI item의 ID correspondence | item-level transition 사용 불가 |
