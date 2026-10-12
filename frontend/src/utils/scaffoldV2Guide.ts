/**
 * Scaffold V2(v3.0) 치료 개입 섹션의 작성 기준·예시(V2-02)와 충분성 판단 선택지 설명(V2-07).
 *
 * 예시 원칙 (연구자 확정, docs/scaffold_v2_phase1_analysis.md §3 V2-02):
 *  - 현재 사례(68세 여, 6회 방문)의 예시는 CARE 세부 요소마다 **짧은 형식 예시 1개**로 제한하고,
 *    치료 종류 전체 목록처럼 완성된 초안에 가까운 것은 주지 않는다.
 *  - 예시 문장이 어느 원기록에 근거하는지 회차와 구절(원문에 그대로 있는 문자열)로 연결한다.
 *  - 9c(치료 변경과 이유)는 현재 사례 예시를 주지 않고 다른 환자 예시를 유지한다.
 *  - 고정 AI 초안은 기존 공개 게이트 뒤에만 보인다. 이 파일은 초안 문장을 담지 않는다.
 *  - 논문 예시(paperExamples, 2026-10-12 연구자 요청): 한의 증례보고 논문 5편의 치료 개입 서술을
 *    요소별로 2~4개 보여 주어 "얼마나 자세히" 쓰는지 참고하게 한다. 모두 다른 환자 이야기이고, 논문 문장을
 *    그대로 옮기지 않고 요점을 다시 쓴 것이다. 출처와 각 예시의 근거 위치: docs/ti_guide_paper_examples_basis_v1.md
 */

export type TiGuideExample =
  | {
      kind: 'this_case';
      /** 1부터 시작하는 방문 회차. */
      visitIndex: number;
      /** 그 회차 원기록에 그대로 있는 구절. 화면에서 "원문 보기"로 강조한다. */
      quote: string;
      sentence: string;
      note: string;
    }
  | { kind: 'other_patient'; sentence: string; note: string };

/** 한의 증례보고 논문에서 가져온 다른 환자 예시. 문장은 논문 내용을 다시 쓴 것이다. */
export type TiPaperExample = {
  /** 화면에 보이는 짧은 출처 이름 */
  source: string;
  sentence: string;
  /** 이 예시에서 눈여겨볼 점 */
  point: string;
};

export type TiGuideElement = {
  code: '9a' | '9b' | '9c';
  label: string;
  required: boolean;
  criteria: string;
  howTo: string[];
  example: TiGuideExample;
  paperExamples: TiPaperExample[];
};

/** 논문 예시 출처 (화면 표시용 짧은 이름). 전체 제목: docs/ti_guide_paper_examples_basis_v1.md */
const PAPER = {
  dementia: '치매 증상 악화 증례 (억간산가미)',
  fibromyalgia: '섬유근육통 불면 증례 (분심기음)',
  stroke: '뇌경색 후 지남력장애·현훈 증례 (성향정기산가미방)',
  bipolar: '양극성 장애 우울 삽화 증례',
  gbs: '길랑바레증후군 증례 (침·전침)'
} as const;

export const TI_GUIDE_V2: { goal: string; elements: TiGuideElement[] } = {
  goal: '무엇을 어떻게 시행했는지 다른 사람이 따라 할 수 있을 만큼 적습니다. 기록에 있는 것만 적고, 없는 것은 없다고 적습니다.',
  elements: [
    {
      code: '9a',
      label: '치료의 종류',
      required: true,
      criteria:
        '어떤 치료를 했는지 종류별로 적습니다. 한약, 침, 약침, 뜸·기기, 상담과 교육, 그리고 다른 병원에서 받고 있는 약물까지 포함합니다.',
      howTo: [
        '치료 이름은 기록에 적힌 그대로 적습니다 (상품명·제조원·규격이 있으면 함께).',
        '각 치료를 처음 시작한 회차(날짜)를 적습니다.',
        '다른 병원 약은 이름을 모르면 "이름 미확인"으로 적고, 뒤에 확인된 회차가 있으면 그때 확인됐다고 적습니다.'
      ],
      example: {
        kind: 'this_case',
        visitIndex: 2,
        quote: '자하거 약침 2cc (대한약침학회 제조, 2cc 앰플)',
        sentence: '2회차(3월 13일)부터 자하거 약침(대한약침학회 제조, 2 cc 앰플)을 시행하였다.',
        note: '치료 한 가지를 적는 방식의 예입니다. 이 사례의 나머지 치료는 기록에서 직접 찾아 같은 방식으로 적어 보세요.'
      },
      paperExamples: [
        {
          source: PAPER.fibromyalgia,
          sentence:
            '한약(청파전-H, 7일째부터 분심기음), 침(어깨·등 저주파 전기 자극 병행), 약침(신바로 약침), 뜸(온구기, 중완), 추나를 함께 시행하였다.',
          point: '시행한 치료를 한 가지도 빠뜨리지 않고 종류별로, 기록된 이름 그대로 나열합니다.'
        },
        {
          source: PAPER.gbs,
          sentence:
            '침과 전침 치료를 하였고, 재활의학과 협진으로 재활 치료(TENS, 보행 훈련)를 하루 1회 받았다. 입원 중 복용한 약은 표로 정리하였다. 한약은 환자가 원하지 않아 투여하지 않았다.',
          point: '다른 과에서 받은 치료와 함께 복용한 약도 적습니다. 하지 않은 치료가 있으면 그 이유도 적습니다.'
        }
      ]
    },
    {
      code: '9b',
      label: '시행 방법 (용량, 기간, 빈도)',
      required: true,
      criteria: '치료마다 얼마나(용량·혈위·규격), 얼마 동안(시작과 종료), 얼마나 자주(빈도) 했는지 적습니다.',
      howTo: [
        '약: 1회 용량 + 하루 횟수 + 복용 시점 + 기간. 복용이 끝난 날과 다시 처방된 날도 적습니다.',
        '침·약침: 혈위(부위) + 규격 또는 부위별 용량 + 유침 시간.',
        '집에서 하도록 교육한 것: 횟수와 시간.'
      ],
      example: {
        kind: 'this_case',
        visitIndex: 1,
        quote: '황련해독탕 2주 (한신, 보험한약 가루약 5.61g/3포, 1일 3회 식후 30분 복용)',
        sentence: '황련해독탕(보험 한약 가루약, 1포 5.61 g)을 1일 3회 식후 30분에 2주간 복용하도록 처방하였다.',
        note: '처음 처방 기준의 예입니다. 이후 복용이 끝난 시점과 다시 처방된 시점은 기록에서 찾아 이어 적어 보세요.'
      },
      paperExamples: [
        {
          source: PAPER.dementia,
          sentence:
            '억간산가진피반하를 11월 3일부터 14일까지 하루 2첩을 3회로 나누어 매 식후 1시간에 1회 100 cc씩 복용하게 하였다. 구성 약재와 용량은 표로 제시하였다.',
          point: '한약은 처방 이름, 시작일과 종료일, 1회 용량, 하루 횟수, 복용 시점을 모두 적고 약재 구성은 표로 붙입니다.'
        },
        {
          source: PAPER.fibromyalgia,
          sentence:
            '입원 27일 동안 하루 2회, 지름 0.25 mm·길이 30 mm 일회용 호침으로 풍지(GB20), 곡지(LI11), 견정(GB21) 등 압통점 주위 혈위에 직자하고 10~15분 유침하였다. 어깨와 등에는 저주파 자극기(16 Hz)로 전기 자극을 함께 주었다.',
          point: '침은 기간과 빈도, 침의 규격, 혈위, 자침 방법, 유침 시간을 한 문단에 모읍니다.'
        },
        {
          source: PAPER.stroke,
          sentence:
            '입원일부터 2주 동안 격일로 족삼리-하거허 또는 태양-솔곡에 전극을 연결해 4 Hz로 20분간 전침 치료를 하였다. 자입 깊이는 족삼리·하거허 40 mm, 태양·솔곡 25 mm였다.',
          point: '이 논문은 침 치료를 STRICTA(침 치료 보고 기준)에 맞춰 적었습니다. 혈위 짝, 주파수, 시간, 깊이까지 적혀 있습니다.'
        },
        {
          source: PAPER.bipolar,
          sentence:
            '기상 오전 7시 30분, 취침 오후 10시 30분을 목표로 정하고, 낮잠은 오후 2시 이전에 30분 안으로 자도록 권고하였다. 생활 리듬 점검표는 주 1회 내원 때 환자와 함께 확인하였다.',
          point: '집에서 하도록 교육한 것은 무엇을, 언제, 얼마나 하도록 했는지와 어떻게 확인했는지를 적습니다.'
        }
      ]
    },
    {
      code: '9c',
      label: '치료를 바꾼 내용과 이유',
      required: false,
      criteria: '무엇을 추가·중단·변경했는지와 기록에 적힌 이유를 적습니다. 이유가 기록에 없으면 "이유는 기록되지 않았다"고 적습니다.',
      howTo: [
        '바뀐 시점(회차)과 바뀌기 전·후를 함께 적습니다.',
        '이유는 기록에 적힌 표현을 근거로만 적고 추측하지 않습니다.',
        '다른 병원 약의 변경(추가, 복용 시간 변경 등)도 포함합니다.'
      ],
      example: {
        kind: 'other_patient',
        sentence: '2차 방문부터 아침에 뻣뻣함이 남아 있어 온열 치료를 추가하였다.',
        note: '다른 환자(요통) 예시입니다. 이 사례에서 바뀐 치료와 그 이유는 기록에서 직접 찾아 적어 보세요.'
      },
      paperExamples: [
        {
          source: PAPER.dementia,
          sentence:
            '치료 13일째(11월 15일)에도 식욕부진과 소화불량이 나아지지 않아, 진피·반하를 빼고 산사·신곡·맥아·오미자를 더한 처방으로 바꾸었다. 복용 방법과 용량은 그대로 두었다.',
          point: '바꾼 날짜, 기록된 이유, 무엇을 빼고 더했는지, 그대로 둔 것까지 함께 적습니다.'
        },
        {
          source: PAPER.fibromyalgia,
          sentence: '입원 7일째부터 통증보다 불면이 더 큰 문제가 되어, 한약을 청파전-H에서 분심기음으로 바꾸었다.',
          point: '바꾸기 전과 후의 처방 이름을 둘 다 적습니다.'
        },
        {
          source: PAPER.stroke,
          sentence: '입원 전부터 먹던 약은 치료 기간 동안 같은 용량으로 유지하였다.',
          point: '바꾸지 않은 치료도 적어 두면, 읽는 사람이 그 기간에 어떤 치료가 함께 있었는지 알 수 있습니다.'
        }
      ]
    }
  ]
};

/**
 * 첫 화면 "증례보고는 이렇게 구성됩니다 (CARE 지침)" 13개 항목의 예시 (2026-10-12 연구자 요청).
 * 항목마다 "예시 보기"를 눌러야 보인다. 모두 실습 환자와 다른 환자의 한의 증례보고 논문에서 가져와
 * 요점만 다시 쓴 것이다(제목·핵심 단어는 논문 그대로). 치료 개입도 다른 환자 논문 예시 하나를 둔다
 * (요소별 자세한 예시는 작성 화면 기준 상자에 있다).
 * 출처와 근거 위치: docs/ti_guide_paper_examples_basis_v1.md 의 "첫 화면 CARE 13개 항목 예시".
 */
export type CareOverviewExample = { text: string; point: string; source: string };

export const CARE_OVERVIEW_EXAMPLES_V2: Record<string, CareOverviewExample> = {
  TITLE: {
    text: '침 치료 및 전침 치료로 호전된 길랑바레증후군 환자의 균형 및 보행 개선: 증례보고',
    point: '치료(침·전침), 진단(길랑바레증후군), "증례보고"가 제목에 모두 들어 있습니다.',
    source: PAPER.gbs
  },
  KEYWORDS: {
    text: 'fibromyalgia, insomnia, Bunshimgi-eum, Korean-medicine, case report',
    point: '진단, 주된 증상, 쓴 처방, 치료 분야, "case report"를 골랐습니다.',
    source: PAPER.fibromyalgia
  },
  ABSTRACT: {
    text:
      '섬유근육통으로 불면을 겪는 입원 환자에게 27일 입원 중 21일 동안 분심기음을 포함한 한방 치료를 하였다. 불면은 ISI, 여러 부위의 통증은 NRS, 전반적 건강 상태는 EQ-5D로 평가하였고, 치료 뒤 세 지표가 모두 치료 전보다 나아졌다.',
    point: '누구에게, 무엇을, 얼마 동안 했고, 무엇으로 평가해 어떻게 되었는지를 한 문단에 담습니다.',
    source: PAPER.fibromyalgia
  },
  INTRODUCTION: {
    text:
      '길랑바레증후군에 한의 치료를 한 증례는 여럿 있지만, 대부분 근력이나 일상생활 점수만 평가했고 보행을 정량적으로 평가한 보고는 없었다. 이 증례는 면역글로불린 치료 뒤 재활과 한의 치료를 함께 받은 환자에서 보행 분석으로 균형과 보행의 변화를 확인하여 보고한다.',
    point: '기존 보고에 없던 점을 문헌과 함께 밝히고, 그래서 이 증례를 보고한다는 문장으로 끝냅니다.',
    source: PAPER.gbs
  },
  PATIENT_INFORMATION: {
    text:
      '환자는 30대 초반 한국인 남성으로 운동 관련 업종 취업을 준비하고 있었고, 미혼으로 부모와 함께 살았다. 우울, 무기력, 불면으로 내원하였으며, 과거 양극성 장애로 진단받아 약물 치료를 받다가 부작용으로 판단해 스스로 중단한 적이 있었다.',
    point: '나이·성별, 사회적 배경, 주된 증상, 과거 진단과 치료 경과를 적습니다. 이름처럼 환자를 알아볼 수 있는 정보는 쓰지 않습니다.',
    source: PAPER.bipolar
  },
  CLINICAL_FINDINGS: {
    text:
      '식사는 하루 2끼, 한 번에 1/3공기 정도였고 식후 명치 불편감을 호소하였다. 대변은 2~3일에 1회로 변비 양상이었고, 수면은 2시간 정도였다. 맥은 삭(數)하였고 설은 담홍(淡紅), 태는 박백(薄白)이었다.',
    point: '문진·맥진·설진에서 확인한 소견을 항목별로, 숫자가 있으면 숫자로 적습니다.',
    source: PAPER.fibromyalgia
  },
  TIMELINE: {
    text:
      '8월 28일 낙상 후 대퇴골 골절 수술 → 10월 8일 야간 섬망 발생 → 10월 11일 한방병원 입원 → 10월 15일 COVID-19 확진 → 11월 3일 억간산가진피반하 시작 → 11월 15일 처방 변경 → 12월 1일 퇴원.',
    point: '증상이 생기고 바뀐 날, 치료를 시작하고 바꾼 날, 평가한 날을 시간 순서로 늘어놓습니다. 논문에서는 그림이나 표로 붙이기도 합니다.',
    source: PAPER.dementia
  },
  DIAGNOSTIC_ASSESSMENT: {
    text:
      '1990년 미국류마티스학회 분류 기준(3개월 이상 지속된 전신 통증, 18개 압통점 중 11개 이상)에 따라 섬유근육통으로 진단하였다. 어깨·손가락 X-ray와 혈액·소변 검사에서는 이상이 없었다.',
    point: '어떤 기준과 검사로 진단했는지, 다른 원인을 확인하려고 한 검사 결과까지 적습니다. 변증을 했다면 변증과 그 근거도 적습니다.',
    source: PAPER.fibromyalgia
  },
  THERAPEUTIC_INTERVENTIONS: {
    text:
      '성향정기산을 기본방으로 하고, 인지장애 개선을 위해 원지·석창포를, 무른 변과 빈뇨 개선을 위해 백복령·등심을 더하였다(구성은 표로 제시). 침은 입원 때부터 중풍칠처혈을 바탕으로 백회, 곡지, 족삼리 등에 하루 1회 자침하였고, 입원일부터 2주 동안 격일로 족삼리-하거허 또는 태양-솔곡에 4 Hz 전침을 20분 시행하였다. 입원 전부터 먹던 약은 치료 기간 동안 같게 유지하였다.',
    point: '한약과 더한 약재의 이유, 침의 혈위·빈도, 전침의 기간·주파수·시간, 그대로 둔 약까지 한 문단에 담았습니다.',
    source: PAPER.stroke
  },
  FOLLOW_UP_OUTCOMES: {
    text:
      '도수근력평가는 입원 시(4월 20일) 우측 상지/하지 5/3, 좌측 4-/3에서 5월 9일 양측 모두 5/4+로 바뀌었다. 치료와 관련된 부작용은 나타나지 않았다.',
    point: '같은 도구로 잰 값을 시점과 함께 적고, 이상반응이 있었는지 없었는지도 적습니다.',
    source: PAPER.gbs
  },
  DISCUSSION_CONCLUSION: {
    text:
      '이 증례에는 한계가 있다. 입원 당시 치매 평가를 하지 않아 그해 5월의 검사 결과를 기준으로 삼았고, 행동심리증상 평가 도구(NPI)를 쓰지 않아 증상 경과는 진료 기록에 의존하였다.',
    point: '좋았던 점만 쓰지 않고, 결론을 얼마나 믿을 수 있는지에 영향을 주는 한계를 구체적으로 적습니다.',
    source: PAPER.dementia
  },
  PATIENT_PERSPECTIVE: {
    text: '치료 5일째 간병인은 "치매 증상은 이제 아침에는 거의 정상이에요. 하지만 오후로 갈수록 인지가 떨어져요."라고 말하였다. 퇴원 무렵 환자는 이제 다 나아서 집에 가도 될 것 같다고 하였다.',
    point: '환자나 보호자가 한 말을 옮기고, 누가 언제 한 말인지 밝힙니다. 직접 한 말은 따옴표로 씁니다.',
    source: PAPER.dementia
  },
  INFORMED_CONSENT: {
    text: '환자에게 증례보고에 대한 동의를 얻었으며, 기관 임상시험심사위원회의 심의를 통과하였다(승인 번호 함께 기재).',
    point: '동의를 받았다는 사실과 IRB 심의 여부·승인 번호를 적습니다.',
    source: PAPER.gbs
  }
};

/**
 * 충분성 판단 선택지의 뜻 (V2-07). 값은 기존 CONFIRMATION_JUDGMENT_OPTIONS와 같다.
 * 2026-10-12: "추가 확인 필요"와 "현재 기록으로 확인할 수 없음"이 비슷해 보인다는 연구자 의견에 따라,
 * 기록에 있는 양이 아니라 "다음에 할 일"로 구분해 고쳤다. 저장 값은 그대로다.
 * 화면 위쪽에 한 번만 보여 주고, 질문마다에는 그 질문에 맞는 예(TI_SUFFICIENCY_QUESTIONS_V2)를 보인다.
 */
export const SUFFICIENCY_OPTION_GUIDE_V2: Record<string, { description: string }> = {
  available_in_record: {
    description: '기록에 적혀 있어 그대로 옮겨 쓸 수 있다.'
  },
  needs_additional_confirmation: {
    description:
      '기록에 일부만 있거나 빠져 있지만, 환자·보호자, 약봉투, 다른 병원 기록 등으로 확인할 수 있다. 쓰기 전에 확인한다.'
  },
  needs_instructor_review: {
    description: '기록은 있지만, 증례보고에 어떻게 해석하거나 표현할지 교수자와 상의하고 싶다.'
  },
  cannot_confirm_in_record: {
    description: '기록에 없고 확인할 방법도 없다. 증례보고에는 "기록되지 않았다"고 쓰거나 뺀다.'
  }
};

/**
 * Scaffold V2 치료 개입 Step 2 질문 (2026-10-12).
 * - id 는 V1과 같다(서버 공개 게이트가 ti_001~ti_003 을 요구한다).
 * - ti_003 은 V1 "치료 중 발생한 부작용이나 치료 변경이 기록되어 있나요?"에서 CARE 9c(치료 변경과 이유)로 좁혔다.
 *   이상반응은 CARE 10d(추적 관찰 및 결과)에 속한다. 저장되는 판단에는 질문 문장(sourceText)이 함께 남으므로
 *   V1 답과 구분할 수 있다. 변경 이력: docs/scaffold_v2_changelog.md
 * - optionExamples: 선택지마다 그 질문에 맞는 짧은 예. 이 사례의 답이 아니라 일반적인 경우다.
 */
export const TI_SUFFICIENCY_QUESTIONS_V2: Array<{
  id: string;
  question: string;
  description: string;
  optionExamples: Record<string, string>;
}> = [
  {
    id: 'ti_001',
    question: '치료 방법, 약물, 용량 등이 명확하게 기록되어 있나요?',
    description: '어떤 치료를 했는지 명확해야 합니다.',
    optionExamples: {
      available_in_record: '예: 처방란에 약 이름, 1회 용량, 하루 복용 횟수가 적혀 있다.',
      needs_additional_confirmation: '예: 다른 병원 약을 먹는다고만 적혀 있어, 약봉투나 처방전을 봐야 이름과 용량을 알 수 있다.',
      needs_instructor_review: '예: 변증과 치료 원칙을 치료 개입에 쓸지, 쓴다면 어떻게 쓸지 묻고 싶다.',
      cannot_confirm_in_record: '예: 뜸을 했다고만 있고 부위나 시간은 어디에도 적혀 있지 않다.'
    }
  },
  {
    id: 'ti_002',
    question: '치료 시작 시점과 기간/빈도가 기록되어 있나요?',
    description: '치료 경과 추적에 필요한 정보입니다.',
    optionExamples: {
      available_in_record: '예: 처방한 날짜와 "2주분"이 적혀 있다.',
      needs_additional_confirmation: '예: 다 먹었는지가 적혀 있지 않아, 다음 내원 때 물어보면 언제 끝났는지 알 수 있다.',
      needs_instructor_review: '예: 내원 간격이 일정하지 않은데 빈도를 어떻게 적을지 묻고 싶다.',
      cannot_confirm_in_record: '예: 집에서 하라고 교육한 운동을 실제로 몇 번 했는지 적힌 곳이 없다.'
    }
  },
  {
    id: 'ti_003',
    question: '치료를 바꾼 내용과 그 이유가 기록되어 있나요?',
    description: '무엇을 추가·중단·변경했는지와 왜 그랬는지입니다. 다른 병원 약의 변경도 포함합니다.',
    optionExamples: {
      available_in_record: '예: "속쓰림을 호소하여 처방 변경"처럼 바꾼 내용과 이유가 함께 적혀 있다.',
      needs_additional_confirmation: '예: 처방이 바뀌었는데 이유가 없다. 담당 한의사에게 물어보면 알 수 있다.',
      needs_instructor_review: '예: 적힌 내용을 치료를 바꾼 이유로 써도 되는지 판단이 서지 않는다.',
      cannot_confirm_in_record: '예: 다른 병원에서 약이 바뀌었다고만 하고, 무엇이 왜 바뀌었는지 확인할 길이 없다.'
    }
  }
];

/** AI 초안 문장 검토 사용법 (V2-08). 화면 상단에 짧게 보여 준다. */
export const REVIEW_STEPS_V2: Array<{ title: string; body: string }> = [
  {
    title: '비교하며 읽고, 다시 볼 문장을 눌러 표시',
    body: '위의 내 초안과 견주어 읽습니다. 내 초안에 없던 내용, 기록과 달라 보이는 문장, 확실하지 않은 문장을 누르면 번호가 붙은 카드가 아래에 생깁니다. 다시 누르면 표시가 풀립니다.'
  },
  {
    title: '카드에서 종류 고르기',
    body: '왜 표시했는지 네 가지 중 하나를 고릅니다. 각 종류의 뜻은 버튼 아래에 나옵니다.'
  },
  {
    title: '이유 적고 기록 근거 연결 → 저장',
    body: '“내 초안에 더하고 싶음”은 이유가 선택이고, 나머지는 이유를 적거나 기록 근거를 하나 이상 연결해야 저장됩니다. 왼쪽 기록 검색으로 구절을 찾은 뒤 “기록 근거 연결하기”에서 고르세요.'
  }
];

export const REVIEW_NOT_FLAGGED_NOTE_V2 =
  '표시하지 않은 문장은 “수용”으로 기록되지 않습니다. 표시한 문장과 그 이유만 저장됩니다. 표시할 문장이 없으면 그대로 아래 정리로 진행해도 됩니다.';

/** 표시한 문장의 종류별 뜻과 이유 작성 힌트 (V2-08). 값은 기존 DRAFT_FLAG_OPTIONS와 같다. */
export const DRAFT_FLAG_GUIDE_V2: Record<string, { description: string; reasonHint: string }> = {
  want_to_add: {
    description: 'AI 초안에는 있는데 내 초안에 없던 내용이라, 내 초안에 더하고 싶다.',
    reasonHint: '어떤 점을 더하고 싶은지 한 줄로 적어 두면 나중에 내 초안을 고칠 때 도움이 됩니다. (선택)'
  },
  differs_from_record: {
    description: '이 문장이 왼쪽 기록과 다르거나, 기록에 없는 내용을 적었다.',
    reasonHint: '기록의 어느 부분과 어떻게 다른지 적고, 그 구절을 기록 근거로 연결하세요.'
  },
  needs_additional_confirmation: {
    description: '기록만으로는 맞는지 확인하기 어려워 환자·보호자·다른 기록으로 더 확인해야 한다.',
    reasonHint: '무엇을 어떻게 확인해야 하는지 적으세요.'
  },
  needs_instructor_review: {
    description: '해석이나 표현이 적절한지 교수님께 물어보고 싶다.',
    reasonHint: '무엇이 궁금한지 적으세요. 마지막 정리의 “교수님께 확인하고 싶은 것”에도 모아 보여 줍니다.'
  }
};

/**
 * 사후 회고 세 문항 (V2-09). 저장 필드는 V1과 같은 postAiReflection을 재사용한다.
 *  - changedJudgment  ← 내 초안에서 빠졌거나 부족했던 내용 (필수)
 *  - missingInDraft   ← AI 초안에서 부족하거나 의심스러운 내용 (선택)
 *  - unresolvedQuestion ← 교수님·전문가에게 확인하고 싶은 것 (선택)
 * V1에서는 changedJudgment가 "내 초안과 AI 초안을 비교해 보니"(포괄), missingInDraft가 "AI 초안에 빠진 내용"이었다.
 * 분석 시 버전별로 문항 뜻이 다르다는 점을 docs/scaffold_v2_changelog.md에 적어 두었다.
 */
export const REFLECTION_PROMPTS_V2: Array<{
  field: 'changedJudgment' | 'missingInDraft' | 'unresolvedQuestion';
  label: string;
  required: boolean;
  placeholder: string;
  editKey: string;
}> = [
  {
    field: 'changedJudgment',
    label: '내 초안에서 빠졌거나 부족했던 내용',
    required: true,
    placeholder: 'AI 초안과 견주어 보니 내 초안에 없거나 모자랐던 것. 예: 한약의 용량과 복용 기간을 쓰지 않았다 / 큰 차이 없음',
    editKey: 'comparison_note'
  },
  {
    field: 'missingInDraft',
    label: 'AI 초안에서 부족하거나 의심스러운 내용 (선택)',
    required: false,
    placeholder: '기록에는 있는데 AI 초안에 없는 것, 기록과 다르거나 확실하지 않아 그대로 쓰면 안 되겠다고 생각한 것.',
    editKey: 'missing_in_draft'
  },
  {
    field: 'unresolvedQuestion',
    label: '교수님이나 전문가에게 확인하고 싶은 것 (선택)',
    required: false,
    placeholder: '기록만으로 판단하기 어려워 물어보고 싶은 것, 증례보고에 어떻게 써야 할지 상의하고 싶은 것.',
    editKey: 'unresolved_question'
  }
];

/**
 * 시작 화면·단계별 안내 문구 (V2-01). 길어지지 않게 한 항목당 한두 문장으로 제한한다.
 * 6가지 교육 요소(요청서 §2)의 순서를 그대로 따른다.
 */
export const V2_INTRO = {
  purpose:
    '이 도구는 증례보고를 대신 써 주는 도구가 아닙니다. 진료 기록을 읽고 내가 먼저 써 본 뒤 AI 초안과 견주어, 증례보고에 무엇을 어떻게 적어야 하는지 익히는 연습 도구입니다.',
  method:
    '순서는 늘 같습니다. 내가 먼저 판단하고 쓴다 → 그다음 AI 초안을 본다 → 비교하며 알게 된 것을 적는다. AI 초안은 정답이 아니라 비교 대상이며, 내가 쓴 초안은 AI를 본 뒤에도 그대로 보존됩니다.',
  today: '오늘은 CARE 13개 항목 가운데 치료 개입 한 항목만 연습합니다. 정답을 맞히는 과제가 아니고, 시간 안에 모두 끝내지 않아도 됩니다.',
  flow: [
    { step: 1, title: 'CARE 13항목 알기', what: '증례보고가 어떤 항목으로 이루어지는지 아래 표로 봅니다.', where: '이 화면' },
    { step: 2, title: '기록 읽고 메모하기', what: '방문 기록 6회차를 읽으며 눈에 띈 점과 확인할 점을 메모합니다. 원하면 AI 메모 추천을 펼쳐 참고합니다.', where: '1단계 화면' },
    { step: 3, title: '기준과 작성 예 보기', what: '치료 개입에 무엇을 어떻게 적는지 CARE 기준과 작성 예를 봅니다.', where: '치료 개입 화면 위쪽' },
    { step: 4, title: '내가 먼저 쓰기', what: 'AI 초안을 보기 전에 두세 문장으로 직접 쓰고, 기록만으로 충분한 정보인지 판단합니다.', where: '치료 개입 Step 1·2' },
    { step: 5, title: 'AI 초안과 비교하기', what: '내 초안이 고정된 뒤 AI 초안을 보고, 다시 볼 문장을 표시하며 기록과 대조합니다.', where: '치료 개입 Step 3' },
    { step: 6, title: '돌아보기', what: '내 초안의 부족, AI 초안의 부족·의심, 교수님께 확인할 것을 적습니다.', where: '치료 개입 Step 3 아래' }
  ]
};

export type StageGuideText = { now: string; next: string };

/** 각 화면 머리의 "지금 할 일 / 다음" 한 줄 안내 (V2-01). */
export const V2_STAGE_GUIDES: Record<'read' | 'sections' | 'step1' | 'step2' | 'step3' | 'summary', StageGuideText> = {
  read: {
    now: '방문 기록 6회차를 읽고, 치료 개입을 쓸 때 쓸 만한 내용과 더 확인할 점을 메모합니다. 회차와 관련 항목을 붙여 두면 뒤에서 찾기 쉽습니다.',
    next: '메모가 끝나면 "다음: CARE 항목 작성"을 눌러 치료 개입 항목을 엽니다. 거기서 내 초안을 먼저 씁니다.'
  },
  sections: {
    now: '치료 개입 항목을 열어 시작합니다. 오늘 실습하는 항목은 이것 하나입니다.',
    next: '항목 안에서 내 초안 쓰기 → 정보 충분성 판단 → AI 초안과 비교 → 돌아보기 순서로 진행합니다.'
  },
  step1: {
    now: '왼쪽 기록만 보고 치료 개입을 두세 문장으로 직접 씁니다. 위의 CARE 기준과 작성 예를 참고하고, 1단계 메모는 오른쪽에 있습니다. AI 초안은 아직 보이지 않습니다.',
    next: '초안을 쓰면 "다음: 정보 충분성 확인"을 눌러 기록만으로 충분한 정보인지 세 가지 질문에 답합니다.'
  },
  step2: {
    now: '질문마다 기록만으로 쓸 수 있는 정보인지 판단합니다. 원하면 그렇게 판단한 이유를 적고, "기록에서 관련된 부분 보기"로 원문을 확인합니다. 정답은 알려 주지 않습니다.',
    next: '"내 정리 저장하고 AI 초안 보기"를 누르면 내 초안과 판단이 고정되고 AI 초안이 열립니다. 그 뒤에는 내 초안을 고칠 수 없습니다.'
  },
  step3: {
    now: '내 초안과 AI 초안을 비교하며 읽고, 다시 볼 문장을 눌러 표시한 뒤 종류·이유·기록 근거를 적어 저장합니다. 마지막에 돌아보기 세 문항을 적습니다.',
    next: '"검토를 마쳤습니다. 이 항목 완료"를 누르면 오늘 실습이 끝나고 내 학습 기록 화면으로 갑니다.'
  },
  summary: {
    now: '오늘 실습에서 내가 쓴 초안, 판단, 표시한 문장, 돌아보기가 이 화면에 모여 있습니다. 모두 저장되어 있습니다.',
    next: '연구자의 안내에 따라 설문과 인터뷰로 이어집니다. 필요하면 "Word로 내보내기"로 기록을 받을 수 있습니다.'
  }
};
