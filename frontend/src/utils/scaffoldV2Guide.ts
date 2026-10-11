/**
 * Scaffold V2(v3.0) 치료 개입 섹션의 작성 기준·예시(V2-02)와 충분성 판단 선택지 설명(V2-07).
 *
 * 예시 원칙 (연구자 확정, docs/scaffold_v2_phase1_analysis.md §3 V2-02):
 *  - 현재 사례(68세 여, 6회 방문)의 예시는 CARE 세부 요소마다 **짧은 형식 예시 1개**로 제한하고,
 *    치료 종류 전체 목록처럼 완성된 초안에 가까운 것은 주지 않는다.
 *  - 예시 문장이 어느 원기록에 근거하는지 회차와 구절(원문에 그대로 있는 문자열)로 연결한다.
 *  - 9c(치료 변경과 이유)는 현재 사례 예시를 주지 않고 다른 환자 예시를 유지한다.
 *  - 고정 AI 초안은 기존 공개 게이트 뒤에만 보인다. 이 파일은 초안 문장을 담지 않는다.
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

export type TiGuideElement = {
  code: '9a' | '9b' | '9c';
  label: string;
  required: boolean;
  criteria: string;
  howTo: string[];
  example: TiGuideExample;
};

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
      }
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
      }
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
      }
    }
  ]
};

/** 충분성 판단 선택지의 뜻과 짧은 예 (V2-07). 값은 기존 CONFIRMATION_JUDGMENT_OPTIONS와 같다. */
export const SUFFICIENCY_OPTION_GUIDE_V2: Record<string, { description: string; example: string }> = {
  available_in_record: {
    description: '그 정보가 기록에 적혀 있어 그대로 옮겨 적을 수 있다.',
    example: '예: 약 이름, 용량, 복용 기간이 처방란에 있다.'
  },
  needs_additional_confirmation: {
    description: '일부는 있지만 빠지거나 불분명한 부분이 있어, 환자·보호자·다른 병원 기록 등으로 더 확인해야 쓸 수 있다.',
    example: '예: 약을 먹는다고는 적혀 있는데 이름이나 용량이 없다.'
  },
  needs_instructor_review: {
    description: '기록은 있지만 증례보고에 어떻게 해석하거나 표현해야 할지 교수자와 상의하고 싶다.',
    example: '예: 변증과 치료 원칙을 증례보고에 어떻게 쓰는지 묻고 싶다.'
  },
  cannot_confirm_in_record: {
    description: '그 정보가 기록에 전혀 없어 지금은 쓸 수 없다.',
    example: '예: 교육한 자가 치료를 실제로 했는지 보여 주는 기록이 없다.'
  }
};

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
