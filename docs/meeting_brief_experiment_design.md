# 연구설계 미팅 브리프 — 증례보고 작성 지원 Human-AI 시스템

> **문서 목적** 교수님과 함께 연구 전체 논리·실험 방향을 확인하고, **§8의 미결정 사항을 결정**하기 위한 자료입니다.
> 상세 절차·측정지표·설문문항은 별도 문서(`detailed_experiment_protocol.md`)에 있으며, 여기에는 담지 않았습니다.
> **작성일** 2026-08-31 · **상태** 논의용 초안 (확정 아님)

---

## 1. 연구가 해결하려는 문제

증례보고(case report)는 임상 교육과 학술 활동의 기본 단위이지만, 실제 작성은 **기록을 옮겨 적는 일이 아니라 재구성하는 일**입니다.

- **EMR/SOAP는 증례보고 구조로 기록되어 있지 않습니다.** 진료 시점별로 흩어진 기록에서 무엇이 이 증례의 핵심인지 선별하고, 시간적 경과를 재구성하고, CARE guideline [1]이 요구하는 구조로 옮겨야 합니다.
- **초보 작성자에게는 이 재구성 과정 자체가 어렵습니다.** 증례보고 작성은 임상적 추론과 학술적 글쓰기를 동시에 요구하는 교육 활동으로 다뤄져 왔습니다 [2].
- **생성형 AI는 이 과정을 건너뛰게 만들 수 있습니다.** AI에게 EMR을 주면 CARE 구조의 초안이 즉시 나옵니다. 편리하지만, 초보 작성자는 원기록을 직접 탐색하고 판단하는 경험 없이 결과만 받게 되고, hallucination과 과잉해석을 검증할 기준을 갖지 못합니다. 자동화 시스템에 대한 과의존(automation bias)은 임상 의사결정 지원 영역에서 반복 보고된 문제이며 [5], 신뢰가 시스템의 실제 성능과 어긋날 때 발생하는 부적절한 의존(inappropriate reliance)은 human-automation 연구의 오래된 주제입니다 [4].

따라서 본 연구는 두 가지를 **분리해서** 다룹니다.

| | **Write** | **Scaffold** |
|---|---|---|
| 무엇 | AI가 EMR에서 CARE 초안을 작성하고 사용자가 검토·보완 | 학습자가 원기록을 먼저 탐색·판단한 뒤 AI 초안을 확인·비교 |
| 대상 | 증례보고 작성 경험이 있는 한의사 | 증례보고 작성 경험이 없는 수련의 |
| 연구에서의 위치 | **실무 작성 지원 도구** (practical utility) | **Main Contribution** — educational Human-AI scaffold |

Scaffold의 핵심은 **AI 공개 시점을 핵심 interaction mechanism으로 설계하는 것**입니다. AI를 보기 전에 학습자가 스스로 판단을 형성하도록 하는 구조는, AI 노출 이전에 사용자의 독립적 판단을 유도한다는 점에서 cognitive forcing 접근과 **개념적으로 연결**됩니다 [6]. 본 연구가 해당 intervention을 그대로 재현하거나 그 효과를 검증하는 것은 아닙니다.

```
EMR/SOAP 탐색 → 필요한 정보 판단 → 누락·추가확인 판단
→ (AI 공개 전) 자신의 판단 확정 → AI 초안 확인
→ 자신의 판단 / AI / 원기록 비교 → AI 결과 검토
```

---

## 2. 논문의 예상 Contribution

### C1. EMR–CARE 기반 단계적 authoring scaffold *(main)*
EMR에서 **바로 구성 가능한 정보**와 **추가 판단·확인이 필요한 정보**를 구분하고, 그 구분을 학습 활동으로 구조화합니다. CARE의 항목 체계 [1]를 체크리스트가 아니라 단계적 과제로 변환한 것이 설계상의 기여입니다.

### C2. AI 공개 전 독립적 판단을 유도하는 Human-AI interaction *(main)*
"AI를 언제·어떻게 보여줄 것인가"를 설계합니다. 사전 판단 → AI 공개 → 원기록·AI·자기판단 3자 비교의 구조는 Human-AI interaction 설계 원칙 [3], appropriate reliance [4], automation bias [5], cognitive forcing [6] 문헌을 **개념적 근거로 참고**한 것입니다.

### C3. Domain-expert-informed Scaffold design *(main)*
한의학 증례보고 경험 전문가가 **실제로 시스템을 사용한 뒤** 제시한 요구사항을, `Expert Finding → Design Implication → Design Requirement → Scaffold Revision`으로 **추적 가능하게(traceable)** 반영합니다. 전문가 의견을 수집했다는 서술이 아니라, 어떤 관찰이 어떤 설계 변경으로 이어졌는지를 보여주는 것이 기여점입니다.

### (secondary) 실제 EMR 기반 Write의 실무 활용 가능성 및 요구사항
전문가의 실제 증례를 대상으로 한 AI 작성 지원 도구의 practical utility와 개선 요구를 formative하게 보고합니다. **Main Contribution이 아니라 부수적 실무 기여**로 위치시킵니다.

---

## 3. 무엇을 보고 싶은 연구인가

*(정식 RQ로 확정한 것이 아니라, 각 단계에서 "보고 싶은 것" 수준입니다.)*

**Expert 단계**
- 실제 증례보고 작성에서 Write는 **어느 단계**에 도움이 되는가? (구조화 / 초안 / 누락 확인 / 최종 원고)
- 실제 임상기록을 넣었을 때 **어떤 AI 오류와 workflow 문제**가 나타나는가?
- 초보 작성자에게 **어떤 역량**이 중요하다고 보는가?
- Scaffold에서 학습자가 **AI 전에 무엇을 직접 해야** 한다고 보는가?
- **AI를 언제 보여주는 것**이 교육적으로 적절한가?

**Student 단계**
- 학습자는 원기록에서 핵심정보와 누락정보를 **얼마나 발견**하는가?
- AI를 본 뒤 **원기록을 다시 확인하고 비판적으로 검토**하는가?
- **어떤 AI 내용을 수용하고 어떤 것을 추가 확인**으로 넘기는가?
- Scaffold를 학습지원·AI 검증·통제 측면에서 **어떻게 인식**하는가?

---

## 4. 전체 연구 흐름

```
EMR–CARE 분석
        ↓
초기 Scaffold 설계·구현
        ↓
Expert Formative Study  ─┬─ E3  Write Practical Utility
                         ├─ E2  Core Competencies
                         └─ E4  Scaffold Educational Utility
        ↓
Expert Finding → Design Requirement
        ↓
Scaffold Revision
        ↓
Student Pilot
        ↓
Student Main Study (Scaffold single-arm)
```

Expert Study는 **효과 검증이 아니라 formative study**입니다. 설계 근거를 얻는 단계입니다.

---

## 5. Expert Formative Study 요약

| 항목 | 현재 안 |
|---|---|
| 대상 | 증례보고 작성 경험이 있는 한의사 |
| N | 최소 5 / **목표 8** / 최대 10 |
| 사례 | **전문가 본인의 실제 임상 사례 우선** (시스템 내부 비식별화) · 연구용 사례 fallback |
| 시간 | **60분 우선**, 필요 시 45분 축약 |
| Write | 전체 workflow 직접 사용 (입력 → 처리 → 탐색 → 질문 답변 → 초안 갱신 → Review AI → 최종 원고 → Word) |
| Core Competency | **Scaffold 노출 전**에 12개 **후보 역량**(문헌을 바탕으로 연구자가 구성) 중요도 + Top 3 평가 |
| Scaffold | Clinical Findings **직접 사용** + Diagnostic Assessment / Introduction **walkthrough** |
| 결과물 | E1 작성 어려움 · E2 핵심역량 · **E3 Write practical utility** · **E4 Scaffold educational utility** · E5 안전성·적용성 · E6 Student 자원 |

> **비교실험이 아닙니다.** Write와 Scaffold의 점수를 비교하거나 어느 쪽이 우수한지 평가하지 않습니다. 목적이 다른 두 기능의 효용성과 요구사항을 각각 확인합니다. **E3와 E4는 분리해서 보고**합니다.

N 근거: 소규모 formative usability 연구에 관한 기존 논의 [7][8]와 자료의 정보력(information power)을 기준으로 표본 크기를 판단하는 질적연구 관점 [9]을 함께 고려하여, **최소 5명, 목표 8명으로 계획하고 모집 가능성에 따라 최대 10명까지 확대**합니다. "5명이면 충분하다", "5명에서 포화(saturation)에 도달한다", "5명이 대부분의 문제를 반드시 발견한다"고 주장하지 않습니다.

---

## 6. Student Main Study 요약

| 항목 | 현재 안 |
|---|---|
| 대상 | 증례보고 작성 경험이 **없는** 한의사 수련의 |
| 설계 | **Scaffold 단일군 (single-arm)** |
| 사례 | 전문가 사례를 자동 사용하지 않음. 별도 후보 → 적합성 심사 → pool → Pilot Case → **Main Case 1개** |
| AI 초안 | 사전 생성 고정 draft 없이 **동일 조건 실시간 생성**, 참가자별 실제 output 저장 |
| 비교 기준 | 별도 구축한 **Expert Reference** (가능하면 전문가 2명 이상) |
| 평가 | Level 1 / Level 2 / Level 3 (§7) |
| 수행 범위 | 수행 section 범위·문항은 **Student Pilot 후 확정** |

**하지 않는 것:** Write vs Scaffold 비교 · 3개 실험군 · section category를 실험군으로 사용 · AI vs No-AI 비교 · pre-post 학습효과 실험.

---

## 7. 우리가 측정하려는 것

```
Level 1  ─ Expert Reference 기반 정보 탐색·판단   (AI 공개 전)
Level 2  ─ AI 공개 이후 검토 행동                 (AI 공개 후)
Level 3  ─ 주관적 평가
```

| Level | 대표 지표 (후보) |
|---|---|
| **L1** | Expert Reference key information 발견 비율 · missing information 발견 비율 · evidence **탐색 범위**와 **근거 선택**(별도 지표) · 추가확인 필요 판단의 reference 일치 |
| **L2** | AI 공개 후 원기록 재확인(evidence reopen) 여부·빈도 · AI 문장별 판단 분포(근거충분 / 추가확인 / 교수자검토) · AI 공개 전후 판단의 section 단위 변화 |
| **L3** | usability · perceived learning support · AI verification / critical review · user control · workload · usefulness / educational intention |

세부 계산식과 ambiguous item 처리 방침은 Master Protocol에 있으며, 일부는 아직 확정하지 않았습니다. 행동 지표는 가치중립적으로 해석합니다 — 재확인이 많거나 검토시간이 길다고 자동으로 좋은 행동으로 보지 않습니다.

> **Claim boundary.** 단일군 설계이므로 "Scaffold가 학습능력을 향상시킨다", "Write보다 교육효과가 높다", "사용 전보다 능력이 향상되었다"는 **주장하지 않습니다.** 표현은 *educational utility / learning support / educational applicability*로 통일합니다.

---

## 8. 교수님께 결정을 요청드리는 사항 ★

### Expert Study

**① Expert 모집 규모 — 현실적으로 몇 명까지 가능한가?**
최소 5 / 목표 8 / 최대 10. → 목표 인원이 정해져야 모집 기간과 분석 일정이 확정됩니다.

**② 세션 시간 — 60분 우선안 / 45분 축약안**
60분안: 도입 7 · Write 직접 사용 20 · Write 회고 8 · 핵심역량 5 · Scaffold 10 · 자문 8 · 마무리 2.
실측 기준 AI 최초 처리에 1~2분이 걸리므로, 45분에서는 Write 탐색 시간이 실질적으로 부족합니다. → **60분안 권장.**

**③ 실제 EMR 운영 방식**
- 본인의 실제 임상 사례 우선 / 연구용 사례 fallback — 이 방향으로 진행해도 되는지
- 사전 제출이 아니라 **세션 현장에서 직접 입력**(시스템 내부 비식별화) — 이 방식이 적절한지

**④ Expert Study 수행범위**
- Write = 전체 workflow 직접 사용 (12개 section 전부를 의무 수정하게 하지는 않음)
- Scaffold = Clinical Findings 직접 + Diagnostic Assessment / Introduction walkthrough
- 이 범위로 진행해도 되는지

### Student Study

**⑤ Student 참가자 확보 가능 규모** — 증례보고 작성 경험이 없는 수련의를 몇 명까지 모집 가능한가?

**⑥ Student Pilot 인원** — 몇 명 규모로 진행할지 (후보 3~5명, Main에는 미포함)

**⑦ Main Study 수행 section 범위를 Pilot 후 확정하는 방식**이 적절한지

**⑧ Expert Reference 구축에 참여 가능한 외부 전문가** 확보 가능성 (2명 이상 권장)

### 운영·문서

**⑨ 승인 문서 변경 필요 여부 확인** — 아래 항목이 기존 문서와 다르면 확인이 필요합니다.

| 항목 | 현재 계획 |
|---|---|
| 참여 방식 | 전문가가 **직접 시스템 사용** (기존: 시연 중심 walkthrough일 수 있음) |
| 사용 자료 | **본인의 실제 임상 사례**를 비식별화하여 사용 |
| 소요 시간 | **45~60분** (기존: 약 30분일 수 있음) |
| 데이터 수집 | 인터뷰 + **시스템 사용 로그** |
| 경험 범위 | **Write와 Scaffold 두 모드** 모두 경험 |

*IRB 승인 여부나 승인 내용을 추정하지 않았으며, 승인본 문서는 수정하지 않았습니다. 실제 운영은 승인된 절차에 따릅니다.*

---

## 9. 핵심 참고문헌

1. Gagnier JJ, Kienle G, Altman DG, Moher D, Sox H, Riley D; CARE Group. *The CARE guidelines: consensus-based clinical case report guideline development.* Journal of Clinical Epidemiology. 2014;67(1):46–51.
2. Florek AG, Dellavalle RP. *Case reports in medical education: a platform for training medical students, residents, and fellows in scientific writing and critical thinking.* Journal of Medical Case Reports. 2016;10:86.
3. Amershi S, Weld D, Vorvoreanu M, et al. *Guidelines for Human-AI Interaction.* CHI 2019.
4. Lee JD, See KA. *Trust in automation: designing for appropriate reliance.* Human Factors. 2004;46(1):50–80.
5. Goddard K, Roudsari A, Wyatt JC. *Automation bias: a systematic review of frequency, effect mediators, and mitigators.* JAMIA. 2012;19(1):121–127.
6. Buçinca Z, Malaya MB, Gajos KZ. *To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance on AI in AI-assisted Decision-making.* PACM HCI (CSCW). 2021;5(CSCW1).
7. Nielsen J, Landauer TK. *A mathematical model of the finding of usability problems.* INTERCHI 1993.
8. Faulkner L. *Beyond the five-user assumption: benefits of increased sample sizes in usability testing.* Behavior Research Methods, Instruments, & Computers. 2003;35(3):379–383.
9. Malterud K, Siersma VD, Guassora AD. *Sample size in qualitative interview studies: guided by information power.* Qualitative Health Research. 2016;26(13):1753–1760.

*서지사항은 기록에 근거해 작성했습니다. 투고 전 DOI·권/호·페이지는 출판사 원문에서 재확인이 필요합니다.*
