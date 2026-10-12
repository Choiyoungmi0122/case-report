/**
 * CARE 세부 항목 아래의 하위 요소 (체크리스트 v2). 근거와 필수·선택 구분: docs/care_subelements_v1.md.
 *
 * 2026-10-12 사용자 결정: 환자 정보, 진단 평가, 치료 개입, 추적 관찰 및 결과 네 섹션에 먼저 붙이고(14de07d),
 * 같은 날 나머지 여덟 섹션(제목, 초록, 서론, 임상 소견, 타임라인, 고찰, 환자 관점, 동의)에도 붙였다.
 * 항목 단위 판정(v1)과 준수율은 그대로 두고, 하위 요소 판정은 항목 아래에 따로 저장한다
 * (이미 돌린 사례와 항목 단위 값을 견줄 수 있게).
 *
 * 9b(시행 방법)는 개입 종류별 묶음으로 나뉜다. 묶음은 기록·답변·초안에서 낱말로 후보를 고르고
 * (detectModalities), 점검 모델이 요소마다 해당 없음(not_applicable)을 정한다.
 */

import { CARE_ITEMS_BY_SECTION } from './careItems';

export const CARE_CHECKLIST_VERSION = 'care-checklist:v2';

export type CareSubGroupKey =
  | 'base'
  | 'herbal'
  | 'acupuncture'
  | 'pharmacopuncture'
  | 'moxibustion'
  | 'cupping'
  | 'western'
  | 'lifestyle'
  | 'other';

export interface CareSubElementDef {
  id: string;
  label: string;
  required: boolean;
  /** "있음"으로 판단하는 기준 */
  criterion: string;
  /** 출처 표시 (CARE, STRICTA n, CHM, 국내, 준용) */
  source: string;
  /** 요소에 붙는 조건. 조건이 맞지 않으면 해당 없음 */
  condition?: string;
  /**
   * 낱말로 확실히 가릴 수 있는 조건은 코드가 정한다. 기록·답변·초안에 맞는 낱말이 있으면 조건 충족,
   * 없으면 해당 없음. 모델의 conditionMet 보다 앞선다 (gpt-4.1-mini 가 같은 초안에서 판정을 바꾼 일이 있어서, 2026-10-12).
   */
  evidence?: RegExp;
}

export interface CareSubGroupDef {
  key: CareSubGroupKey;
  /** 화면에 보이는 묶음 이름 (base 는 빈 문자열) */
  label: string;
  /** 묶음의 적용 조건 (base 는 모든 사례) */
  applies: string;
  elements: CareSubElementDef[];
}

const e = (
  id: string,
  label: string,
  required: boolean,
  criterion: string,
  source: string,
  condition?: string,
  evidence?: RegExp
): CareSubElementDef => ({ id, label, required, criterion, source, ...(condition ? { condition } : {}), ...(evidence ? { evidence } : {}) });

const base = (elements: CareSubElementDef[]): CareSubGroupDef[] => [{ key: 'base', label: '', applies: '모든 사례', elements }];

export const MODALITY_LABELS: Record<Exclude<CareSubGroupKey, 'base'>, string> = {
  herbal: '한약',
  acupuncture: '침·전침',
  pharmacopuncture: '약침',
  moxibustion: '뜸',
  cupping: '부항',
  western: '양약',
  lifestyle: '생활 지도·상담',
  other: '그 밖의 치료'
};

/** 항목 번호 → 하위 요소 묶음 */
export const CARE_SUB_ELEMENTS: Record<string, CareSubGroupDef[]> = {
  // ---------------------------------------------------------------- 환자 정보 (초진 시점까지)
  '5a': base([
    e('5a-1', '나이', true, '"○세" 또는 연령대', 'CARE'),
    e('5a-2', '성별', true, '남·여', 'CARE'),
    e('5a-3', '직업', false, '직업이나 주된 일상 활동', 'CARE'),
    e('5a-4', '체격(키·체중·BMI)', false, '셋 중 하나 이상의 수치', '국내'),
    e('5a-5', '인종·민족', false, '국내 증례는 대부분 생략한다', 'CARE', '기록에 인종·민족이 있을 때', /인종|민족|국적|외국인/)
  ]),
  '5b': base([
    e('5b-1', '주소(주된 증상)', true, '증상 이름. 가능하면 환자의 표현', 'CARE'),
    e('5b-2', '발병 시점·기간', true, '날짜, "○개월 전", 계기 사건 중 하나', 'CARE'),
    e('5b-3', '증상의 양상', true, '부위, 빈도, 강도, 지속 시간 중 하나 이상', 'CARE'),
    e('5b-4', '악화·완화 요인', false, '무엇에 심해지고 무엇에 나아지는지', 'CARE'),
    e('5b-5', '내원 동기', false, '한의 진료를 찾은 이유나 경로(의뢰 등)', '국내')
  ]),
  '5c': base([
    e('5c-1', '현병력 경과와 이전 치료', true, '이전에 받은 치료와 그 결과', 'CARE'),
    e('5c-2', '과거력·동반 질환', true, '질환명과 진단 시기, 또는 기록에 있는 "특이 과거력 없음"', 'CARE'),
    e('5c-3', '복용 중인 약물', true, '약 이름(가능하면 용량)', 'CARE', '복용 중인 약이 있을 때'),
    e('5c-4', '가족력', false, '관련 가족력', 'CARE'),
    e('5c-5', '사회력·생활 습관', false, '음주, 흡연, 식습관, 운동, 생활 환경', 'CARE'),
    e('5c-6', '심리사회적 상황', false, '스트레스 사건, 가족 관계, 돌봄 상황', 'CARE'),
    e('5c-7', '알레르기·약물 이상반응 이력', false, '있거나 없음이 기록에 있을 때', 'CARE'),
    e('5c-8', '유전 정보', false, '관련 유전 검사 결과', 'CARE', '관련 유전 검사가 있을 때', /유전자|유전\s?검사|염색체|변이|genetic/i)
  ]),
  // ---------------------------------------------------------------- 진단 평가
  '8a': base([
    e('8a-1', '시행한 검사·평가의 이름', true, '검사·영상·척도·설문의 이름', 'CARE'),
    e('8a-2', '시행 날짜', true, '검사마다 날짜 또는 "첫 기록일 +N일"', 'CARE'),
    e('8a-3', '결과 값과 단위', true, '수치와 단위, 또는 판독 결과', 'CARE'),
    e('8a-4', '척도 점수와 등급', true, '"○점(등급)"', '국내', '척도를 썼을 때'),
    e('8a-5', '참고 범위·절단점', false, '정상 범위나 절단점. 문헌이 필요하면 [문헌 보완 필요]', 'CARE', '수치 검사나 척도가 있을 때'),
    e('8a-6', '한의 진단 도구 결과', false, '도구 이름과 결과', '국내', '변증 설문, 경락 기능 검사 등을 썼을 때')
  ]),
  '8c': base([
    e('8c-1', '서양의학 진단명', true, '진단명. 다른 기관 진단이면 그 사실', 'CARE'),
    e('8c-2', '한의 변증과 근거', true, '변증명과 그 근거 증상·설·맥', '국내', '한의 진료 사례'),
    e('8c-3', '감별 진단', true, '고려하고 배제한 진단과 배제 근거', 'CARE'),
    e('8c-4', '진단 분류 코드', false, 'KCD·ICD 코드', '국내')
  ]),
  '8b': base([e('8b-1', '진단의 어려움', false, '검사를 하지 못한 이유, 비용, 의사소통 문제 등', 'CARE')]),
  '8d': base([e('8d-1', '예후 특성', false, '병기, 중증도 등급', 'CARE', '병기·중증도 분류가 있는 질환')]),
  // ---------------------------------------------------------------- 치료 개입
  '9a': base([
    e('9a-1', '이 사례의 개입을 빠짐없이 나열', true, '기록에 나온 개입 종류(한약, 침, 약침, 뜸, 부항, 양약, 생활 지도 등)가 모두 언급됨', 'CARE'),
    e('9a-2', '다른 의료진·기관의 치료', true, '병행 양방 치료나 타 기관 치료의 사실', 'CARE', '다른 의료진·기관의 치료가 있을 때'),
    e('9a-3', '치료 선택의 근거', false, '변증·진단과 처방·혈위 선택을 잇는 한 문장', 'STRICTA 1b, 국내')
  ]),
  '9b': [
    {
      key: 'herbal',
      label: MODALITY_LABELS.herbal,
      applies: '한약 처방이 기록에 있을 때. 처방이 여러 개면 처방마다 본다',
      elements: [
        e('9b-H1', '처방명', true, '처방 이름. 가감방이면 "○○탕가감"', 'CHM, 국내'),
        e('9b-H2', '구성 약재와 1첩 용량', true, '약재마다 이름과 g', 'CHM, 국내'),
        e('9b-H3', '제형', true, '탕제, 과립제, 환제, 산제 중 무엇인지', 'CHM'),
        e('9b-H4', '복용법', true, '1일 첩 수 또는 포 수, 1회 양(mL), 1일 횟수, 복용 시점(식후 30분 등)', 'CARE, 국내'),
        e('9b-H5', '투여 기간', true, '시작일과 종료일, 또는 일수', 'CARE'),
        e('9b-H6', '출전', false, '원방이 실린 의서', 'CHM'),
        e('9b-H7', '가감 내용과 이유', false, '원방에서 더하거나 뺀 약재와 그 이유', 'CHM', '가감방일 때'),
        e('9b-H8', '조제·제조', false, '원내 탕전, 원외 탕전실, 제약사 제품명', 'CHM, 국내'),
        e('9b-H9', '학명·사용 부위', false, '약재 학명(라틴명)과 사용 부위', 'CARE, CHM'),
        e('9b-H10', '약재 품질·인증', false, '규격품 사용 여부 등', 'CHM')
      ]
    },
    {
      key: 'acupuncture',
      label: MODALITY_LABELS.acupuncture,
      applies: '침 치료가 기록에 있을 때',
      elements: [
        e('9b-A1', '혈위', true, '혈위 이름과 WHO 코드, 편측·양측. 표준 이름이 없으면 위치', 'STRICTA 2b, 국내'),
        e('9b-A2', '침 규격', true, '굵기×길이(예: 0.25×30 mm)', 'STRICTA 2g'),
        e('9b-A3', '유침 시간', true, '"○분"', 'STRICTA 2f'),
        e('9b-A4', '시행 빈도와 총 횟수', true, '주 ○회, 총 ○회, 기간', 'STRICTA 3a·3b'),
        e('9b-A5', '자극 방법', true, '수기 자극, 전침 중 무엇인지', 'STRICTA 2e'),
        e('9b-A6', '전침 조건', true, '주파수(Hz), 강도 기준, 연결한 혈위, 기기', 'STRICTA 2e', '전침을 했을 때', /전침|침전기|전기\s?침|전기\s?자극|(?<![A-Za-z])EA(?![A-Za-z])/),
        e('9b-A7', '자입 깊이', false, 'mm 또는 조직 수준', 'STRICTA 2c'),
        e('9b-A8', '득기 등 목표 반응', false, '득기 유도 여부', 'STRICTA 2d'),
        e('9b-A9', '침법의 종류', false, '체침, 이침, 사암침, 동씨침 등', 'STRICTA 1a'),
        e('9b-A10', '회당 자침 수', false, '침 개수', 'STRICTA 2a'),
        e('9b-A11', '치료가 회차마다 달라진 범위', false, '혈위·자극을 바꾼 범위', 'STRICTA 1c'),
        e('9b-A12', '시술자', false, '한의사 면허, 경력', 'STRICTA 5')
      ]
    },
    {
      key: 'pharmacopuncture',
      label: MODALITY_LABELS.pharmacopuncture,
      applies: '약침이 기록에 있을 때',
      elements: [
        e('9b-P1', '약침 종류', true, '약침액 이름', '국내'),
        e('9b-P2', '시술 혈위·부위', true, '혈위와 WHO 코드 또는 부위', '준용(STRICTA 2b)'),
        e('9b-P3', '1회 주입량', true, '혈위당 또는 총량(mL, cc)', '국내'),
        e('9b-P4', '시행 빈도와 총 횟수', true, '주 ○회, 총 ○회', '준용(STRICTA 3)'),
        e('9b-P5', '조제 기관', false, '원외 탕전실 등', '국내'),
        e('9b-P6', '주사기·바늘 규격', false, '규격', '준용(STRICTA 2g)'),
        e('9b-P7', '농도·희석', false, '약침액 농도', '국내')
      ]
    },
    {
      key: 'moxibustion',
      label: MODALITY_LABELS.moxibustion,
      applies: '뜸이 기록에 있을 때',
      elements: [
        e('9b-M1', '뜸의 종류', true, '직접구·간접구, 제품명', '준용'),
        e('9b-M2', '시술 혈위·부위', true, '혈위 또는 부위', '준용(STRICTA 2b)'),
        e('9b-M3', '장수 또는 시간', true, '○장, ○분', '준용'),
        e('9b-M4', '시행 빈도', true, '회차마다, 주 ○회 등', '준용(STRICTA 3)')
      ]
    },
    {
      key: 'cupping',
      label: MODALITY_LABELS.cupping,
      applies: '부항이 기록에 있을 때',
      elements: [
        e('9b-C1', '건부항·습부항 구분', true, '둘 중 무엇인지', '준용'),
        e('9b-C2', '시술 부위', true, '부위나 혈위', '준용'),
        e('9b-C3', '유관 시간', false, '○분', '준용'),
        e('9b-C4', '시행 빈도', false, '회차마다, 주 ○회 등', '준용(STRICTA 3)')
      ]
    },
    {
      key: 'western',
      label: MODALITY_LABELS.western,
      applies: '이 기간에 복용하거나 새로 처방된 양약이 있을 때',
      elements: [
        e('9b-W1', '성분명(상품명)', true, '성분명. 상품명은 괄호', 'CARE'),
        e('9b-W2', '용량과 용법', true, '1회 용량, 1일 횟수', 'CARE'),
        e('9b-W3', '한의 치료 중 유지·변경 여부', true, '한의 치료 기간에 그대로 먹었는지, 줄였는지, 끊었는지', '국내'),
        e('9b-W4', '처방 기관', false, '다른 기관 처방이면 그 사실', 'CARE'),
        e('9b-W5', '시작 시점', false, '복용 시작 시기', 'CARE')
      ]
    },
    {
      key: 'lifestyle',
      label: MODALITY_LABELS.lifestyle,
      applies: '생활 지도·운동·식이·상담이 기록에 있을 때',
      elements: [
        e('9b-L1', '지도 내용', true, '무엇을 하라고 했는지(운동 종류, 식이, 수면 위생 등)', 'CARE'),
        e('9b-L2', '빈도·강도·기간', false, '하루 ○분, 주 ○회 등', 'CARE'),
        e('9b-L3', '실천 확인 방법', false, '일지, 다음 방문 문진 등', 'CARE')
      ]
    },
    {
      key: 'other',
      label: MODALITY_LABELS.other,
      applies: '추나, 한방 물리치료, 기공 등이 기록에 있을 때',
      elements: [
        e('9b-O1', '치료 이름과 방법', true, '무엇을 어떻게 했는지', 'CARE'),
        e('9b-O2', '부위와 빈도', false, '부위, 회차', 'CARE')
      ]
    }
  ],
  '9c': base([
    e('9c-1', '변경 시점', true, '처방·혈위·빈도가 바뀐 날짜', 'CARE', '치료를 바꾼 적이 있을 때'),
    e('9c-2', '무엇이 바뀌었나', true, '바뀌기 전과 후', 'CARE', '치료를 바꾼 적이 있을 때'),
    e('9c-3', '바꾼 이유', true, '증상 변화, 이상반응, 환자 요청 등', 'CARE', '치료를 바꾼 적이 있을 때')
  ]),
  // ---------------------------------------------------------------- 추적 관찰 및 결과
  '10a': base([
    e('10a-1', '평가 시점', true, '단락이나 결과마다 날짜 또는 "첫 기록일 +N일"', 'CARE, 국내'),
    e('10a-2', '기저치(초진 값)', true, '같은 지표의 초진 값이 함께 제시됨', '국내'),
    e('10a-3', '임상의 평가 결과', true, '진찰, 검사, 척도 등 임상의가 잰 값의 변화', 'CARE'),
    e('10a-4', '환자 보고 결과', true, '환자의 증상 표현, 환자 보고 척도(NRS, VAS 등)의 변화', 'CARE'),
    e('10a-5', '마지막 관찰 시점', true, '추적이 끝난 시점과 그때의 상태', 'CARE, 국내'),
    e('10a-6', '점수 연쇄 표기', false, '"21-20-8-15-3" 같은 시점별 값', '국내', '같은 척도를 3회 이상 쟀을 때')
  ]),
  '10b': base([e('10b-1', '추적 검사 결과', false, '검사명, 날짜, 결과. 정상·음성 결과도 포함', 'CARE', '추적 검사가 있을 때')]),
  '10c': base([
    e('10c-1', '순응도', false, '처방대로 복용·내원했는지', 'CARE'),
    e('10c-2', '순응도 확인 방법', false, '진술, 남은 약 확인, 일지, 전화', 'CARE'),
    e('10c-3', '내약성', false, '복용이나 시술을 견딜 수 있었는지', 'CARE')
  ]),
  '10d': base([
    e('10d-1', '이상반응 유무', true, '있었는지 없었는지가 명시됨', 'CARE'),
    e('10d-2', '이상반응의 내용·시점·빈도·정도', true, '증상(가능하면 환자의 표현), 날짜, 빈도, 정도', 'CARE', '이상반응이 있었을 때'),
    e('10d-3', '조치와 경과', true, '무엇을 했고 어떻게 되었는지', 'CARE', '이상반응이 있었을 때'),
    e('10d-4', '이상반응 확인 방법', false, '문진, 검사(간기능 등)', 'CARE')
  ]),
  // ---------------------------------------------------------------- 제목
  '1': base([
    e('1-1', '증례 표시', true, '제목에 "증례보고", "증례", "치험 ○례" 같은 증례 표시가 있음', 'CARE, 국내'),
    e('1-2', '주된 현상', true, '제목에 진단명이나 주된 증상이 있음', 'CARE'),
    e('1-3', '주된 개입', false, '제목에 한약 처방명, 침 등 주된 치료가 있음', 'CARE, 국내')
  ]),
  '2': base([
    e('2-1', '핵심 단어 2~5개', true, '"핵심 단어:" 줄에 핵심 단어가 2~5개', 'CARE'),
    e('2-2', '핵심 단어에 "증례보고"', true, '핵심 단어 가운데 하나가 "증례보고"(또는 case report)', 'CARE')
  ]),
  // ---------------------------------------------------------------- 초록
  '3a': base([e('3a-1', '이 증례가 더하는 것', true, '배경 문단에 이 증례를 보고하는 이유나 새로운 점이 한 문장 이상', 'CARE')]),
  '3b': base([
    e('3b-1', '주요 증상과 진단', true, '나이·성별, 주소, 진단 또는 변증', 'CARE'),
    e('3b-2', '주요 개입', true, '처방명·침 등 치료 구성과 기간', 'CARE'),
    e('3b-3', '주요 결과', true, '주요 평가의 변화를 시점·값으로(예: "○점에서 ○점으로")', 'CARE')
  ]),
  '3c': base([e('3c-1', '핵심 교훈', true, '결론 문단에 관찰된 경과를 신중하게 정리한 한두 문장', 'CARE')]),
  // ---------------------------------------------------------------- 서론
  '4': base([
    e('4-1', '질환·상황의 배경', true, '질환·증상의 중요성과 기존 치료의 한계. 문헌이 필요한 내용이라 [문헌 보완 필요] 표시만 있으면 present 가 아님', 'CARE'),
    e('4-2', '보고 이유', true, '이 증례를 보고하는 이유', 'CARE'),
    e('4-3', '끝부분 요약', true, '마지막 부분에 이 사례의 질문·공백·중요성·핵심 메시지를 1~3문장으로', 'CARE')
  ]),
  '4b': base([e('4b-1', '관련 문헌 인용', false, '선행 연구·증례의 인용. [문헌 보완 필요] 표시만 있으면 present 가 아님', 'CARE')]),
  // ---------------------------------------------------------------- 임상 소견 (초진 시점)
  '6': base([
    e('6-1', '초진 활력징후', true, '혈압, 맥박, 체온 중 하나 이상', '국내'),
    e('6-2', '신체 진찰 소견', true, '주소와 관련된 진찰 결과', 'CARE'),
    e('6-3', '한의 진찰(맥진·설진·복진)', true, '셋 중 하나 이상', '국내', '한의 진료 사례'),
    e('6-4', '계통적 문진', false, '식욕, 소화, 대변, 소변, 수면, 한열, 땀 중 둘 이상', '국내')
  ]),
  // ---------------------------------------------------------------- 타임라인 (표의 행)
  '7': base([
    e('7-1', '날짜 칸', true, '행마다 날짜, "첫 기록일 +N일", 또는 "시기 미상"', 'CARE, 국내'),
    e('7-2', '과거력·발병을 첫 행으로', true, '첫 행이 발병 시기나 관련 과거력·이전 치료', '국내', '기록·답변에 발병 시점이나 관련 과거력이 있을 때'),
    e('7-3', '진단 검사와 치료 개입', true, '평가 시점의 검사·척도와 처방 시작·변경이 해당 행에 들어감', 'CARE'),
    e('7-4', '마지막 행이 마지막 방문', true, '마지막 행이 기록의 마지막 방문(종결)', '국내'),
    e('7-5', '다른 의료진의 치료', false, '다른 의료진·기관의 치료가 해당 시점 행에 들어감', 'CARE', '다른 의료진·기관의 치료가 있을 때')
  ]),
  // ---------------------------------------------------------------- 고찰
  '11a': base([
    e('11a-1', '이 사례 관리의 강점', false, '이 사례에서 잘 된 점(평가 도구, 추적 기간 등)', 'CARE'),
    e('11a-2', '한계', false, '이 사례의 한계를 구체적으로("첫째, 둘째" 등)', 'CARE, 국내'),
    e('11a-3', '일반화할 수 없음', false, '단일 사례라 결과를 일반화할 수 없다는 문장', 'CARE')
  ]),
  '11b': base([e('11b-1', '관련 문헌과의 비교', false, '선행 임상시험·증례와의 비교. [문헌 보완 필요] 표시만 있으면 present 가 아님', 'CARE')]),
  '11c': base([
    e('11c-1', '경과를 해석한 근거', true, '관찰된 경과와 치료의 시간 관계를 기록 근거로 서술', 'CARE'),
    e('11c-2', '다른 설명 언급', true, '자연 경과, 병행 치료, 우연 중 하나 이상을 해석을 흐리는 요인으로 언급', 'CARE')
  ]),
  '11d': base([e('11d-1', '짧은 핵심 메시지', true, '고찰 끝에 효과를 단정하지 않는 짧은 핵심 메시지', 'CARE')]),
  // ---------------------------------------------------------------- 환자 관점
  '12': base([
    e('12-1', '환자(보호자)의 말로 된 경험', false, '환자나 보호자의 표현을 인용하거나 옮김', 'CARE', '환자나 보호자의 진술이 기록·답변에 있을 때'),
    e('12-2', '치료를 찾은 이유나 삶의 질 변화', false, '치료를 찾은 이유, 생활·삶의 질의 변화에 대한 환자의 관점', 'CARE', '환자나 보호자의 진술이 기록·답변에 있을 때')
  ]),
  // ---------------------------------------------------------------- 동의
  '13': base([
    e('13-1', '동의 여부', true, '환자(보호자)에게 동의를 받았는지. 받지 못했으면 그 사유와 시도', 'CARE'),
    e('13-2', '동의 형태', true, '서면 등 동의 방식', 'CARE'),
    e('13-3', '기관 윤리 심의(IRB)', false, '승인 또는 면제와 그 번호', '국내')
  ])
};

/** 이 항목에 개입 종류별 묶음이 있는지 (지금은 9b) */
export function hasModalityGroupsFor(code: string): boolean {
  return (CARE_SUB_ELEMENTS[code] || []).some((group) => group.key !== 'base');
}

/** 하위 요소를 붙인 섹션 */
export const CARE_SUB_ELEMENT_SECTIONS = [
  'TITLE',
  'ABSTRACT',
  'INTRODUCTION',
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'DISCUSSION_CONCLUSION',
  'PATIENT_PERSPECTIVE',
  'INFORMED_CONSENT'
] as const;

export function sectionHasSubElements(sectionId: string): boolean {
  return (CARE_SUB_ELEMENT_SECTIONS as readonly string[]).includes(sectionId);
}

/**
 * 개입 종류 후보. 넉넉하게 잡고(놓치면 그 묶음을 아예 점검하지 않으므로), 실제 해당 여부는 점검 모델이
 * 요소마다 not_applicable 로 정한다.
 */
const MODALITY_PATTERNS: Record<Exclude<CareSubGroupKey, 'base'>, RegExp> = {
  herbal: /한약|탕약|탕제|탕전|첩약|[0-9]\s?첩|과립제|엑스제|[가-힣]{1,8}탕|[가-힣]{2,8}(산|환|음)(가감|가미)/,
  acupuncture: /(?<![아기])침(?!대|착|구|해|입|묵|수|실|략)|전침|자침|유침|혈위|경혈|(?<![A-Z])(LU|LI|ST|SP|HT|SI|BL|KI|PC|TE|GB|LR|GV|CV)-?\d{1,2}(?!\d)/,
  pharmacopuncture: /약침|봉침|봉독/,
  moxibustion: /뜸|직접구|간접구|온구|애구|구치료|쑥/,
  cupping: /부항|습부|건부/,
  western: /양약|[0-9.]+\s?(mg|㎎|mcg|μg|IU)\b|[가-힣A-Za-z]+(정|캡슐|서방정|시럽)\s?[0-9]|처방약|혈압\s?약|당뇨\s?약|정신과\s?약|수면제|진통제|소염제|스테로이드/,
  lifestyle: /생활\s?지도|생활\s?교육|운동\s?(지도|요법|권고)|식이|식단|수면\s?위생|상담|교육하였|권고하였|안내하였|지도하였/,
  other: /추나|물리\s?치료|도수|핫팩|간섭파|경피\s?전기|TENS|ICT|적외선|기공|명상|이완\s?요법/
};

/**
 * herbalNames: 용어 사전의 처방명(herbal_prescription). "○○산", "○○음"처럼 낱말 꼴로는 가려낼 수 없는
 * 처방을 이름으로 찾는다.
 */
export function detectModalities(text: string, herbalNames: string[] = []): Array<Exclude<CareSubGroupKey, 'base'>> {
  const source = String(text || '');
  const found = (Object.keys(MODALITY_PATTERNS) as Array<Exclude<CareSubGroupKey, 'base'>>).filter((key) =>
    MODALITY_PATTERNS[key].test(source)
  );
  if (!found.includes('herbal') && herbalNames.some((name) => name.length >= 2 && source.includes(name))) found.unshift('herbal');
  return found;
}

/** evidence 가 있는 요소의 조건 충족 여부. evidence 가 없으면 null (모델 판정을 쓴다) */
export function conditionByEvidence(element: CareSubElementDef, text: string): boolean | null {
  if (!element.evidence) return null;
  return element.evidence.test(String(text || ''));
}

export interface AppliedSubElement extends CareSubElementDef {
  itemCode: string;
  group: CareSubGroupKey;
  groupLabel: string;
  groupApplies: string;
}

/**
 * 이 섹션에서 점검할 하위 요소. 9b 묶음은 modalities 에 든 것만 넣는다.
 * 하위 요소를 붙이지 않은 섹션이면 빈 배열.
 */
export function subElementsForSection(
  sectionId: string,
  itemCodes: string[],
  modalities: string[]
): AppliedSubElement[] {
  if (!sectionHasSubElements(sectionId)) return [];
  const out: AppliedSubElement[] = [];
  for (const code of itemCodes) {
    for (const group of CARE_SUB_ELEMENTS[code] || []) {
      if (group.key !== 'base' && !modalities.includes(group.key)) continue;
      for (const element of group.elements) {
        out.push({ ...element, itemCode: code, group: group.key, groupLabel: group.label, groupApplies: group.applies });
      }
    }
  }
  return out;
}

/** 9b 묶음 가운데 후보에 들지 않아 점검하지 않은 것 */
export function skippedModalities(sectionId: string, itemCodes: string[], modalities: string[]): string[] {
  if (!sectionHasSubElements(sectionId)) return [];
  const out: string[] = [];
  for (const code of itemCodes) {
    for (const group of CARE_SUB_ELEMENTS[code] || []) {
      if (group.key !== 'base' && !modalities.includes(group.key)) out.push(group.key);
    }
  }
  return out;
}

/** SW-C 프롬프트에 넣는 하위 요소 목록 */
export function subElementsText(elements: AppliedSubElement[], conditionMetIds: Set<string> = new Set()): string {
  if (elements.length === 0) return '';
  const lines: string[] = [];
  let lastHeader = '';
  for (const element of elements) {
    const header = element.group === 'base' ? `[${element.itemCode}]` : `[${element.itemCode} ${element.groupLabel}] 적용: ${element.groupApplies}`;
    if (header !== lastHeader) {
      lines.push(header);
      lastHeader = header;
    }
    // 코드가 조건 충족을 확인한 요소는 조건을 묻지 않는다
    const condition = !element.condition
      ? ''
      : conditionMetIds.has(element.id)
        ? ` (조건 "${element.condition}"은 기록에서 확인됨. conditionMet 은 true 이고 not_applicable 로 두지 않는다. 기준에 맞는 내용이 초안에 있으면 present, 기록에만 있으면 in_record_not_in_draft, 둘 다 없으면 not_in_record)`
        : ` (조건: ${element.condition}. conditionMet 을 반드시 true/false 로 적는다. 조건을 뒷받침하는 내용이 어디에도 없으면 false 이고 status 는 not_applicable)`;
    lines.push(`- ${element.id} (${element.required ? '필수' : '선택'}) ${element.label}: ${element.criterion}${condition}`);
  }
  return lines.join('\n');
}

/** 하위 요소 id 로 정의를 찾는다 (예: "9b-H4") */
export function findSubElement(sectionId: string, id: string): AppliedSubElement | null {
  if (!sectionHasSubElements(sectionId)) return null;
  const itemCode = String(id || '').split('-')[0];
  if (!(CARE_ITEMS_BY_SECTION[sectionId] || []).some((item) => item.code === itemCode)) return null;
  for (const group of CARE_SUB_ELEMENTS[itemCode] || []) {
    const element = group.elements.find((item) => item.id === id);
    if (element) return { ...element, itemCode, group: group.key, groupLabel: group.label, groupApplies: group.applies };
  }
  return null;
}
