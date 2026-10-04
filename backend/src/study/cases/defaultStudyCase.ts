import { Visit, VisitType } from '../../types';

export interface StudyCaseTemplate {
  id: string;
  version: string;
  title: string;
  visits: Visit[];
}

export const DEFAULT_STUDY_CASE_ID = 'MAIN_CASE_01';
export const DEFAULT_STUDY_CASE_VERSION = 'v1.0';

export const DEFAULT_STUDY_CASE: StudyCaseTemplate = {
  id: DEFAULT_STUDY_CASE_ID,
  version: DEFAULT_STUDY_CASE_VERSION,
  title: 'Study Case Template',
  visits: [
    {
      index: 1,
      type: VisitType.INITIAL,
      date: '2026-01-15T09:00',
      soapText: [
        'S: 42세 여성. 6개월 전부터 반복되는 상복부 불편감, 조기 포만감, 체중 감소 3kg 호소.',
        'O: 활력징후 안정적. 복부 진찰상 심한 압통은 없으나 상복부 불편감 표현.',
        'A: 기능성 소화불량과 위장관 기질 질환 감별 필요.',
        'P: 혈액검사, 위내시경 예약. 식이 조절 교육.'
      ].join('\n')
    },
    {
      index: 2,
      type: VisitType.FOLLOW_UP,
      date: '2026-01-29T10:00',
      soapText: [
        'S: 증상 지속. 식후 더부룩함 악화. 야간 통증은 부인.',
        'O: CBC/chemistry 특이소견 없음. 위내시경상 위각부의 미란성 병변 관찰.',
        'A: 위염성 변화 의심, 조직검사 결과 대기.',
        'P: PPI 시작. 조직검사 확인 후 추가 설명 예정.'
      ].join('\n')
    },
    {
      index: 3,
      type: VisitType.FOLLOW_UP,
      date: '2026-02-12T11:00',
      soapText: [
        'S: 복통은 일부 완화되었으나 식욕 저하 지속.',
        'O: 조직검사상 H. pylori 양성 확인.',
        'A: H. pylori 관련 위염으로 판단.',
        'P: 제균치료 시작. 부작용 설명. 6주 후 추적 검사 계획.'
      ].join('\n')
    }
  ]
};

export function getStudyCaseTemplate(studyCaseId?: string): StudyCaseTemplate {
  if (!studyCaseId || studyCaseId === DEFAULT_STUDY_CASE_ID || studyCaseId === 'default-study-case') {
    return DEFAULT_STUDY_CASE;
  }

  return DEFAULT_STUDY_CASE;
}
