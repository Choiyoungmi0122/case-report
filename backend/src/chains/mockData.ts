import { CareSection, SectionStatus } from '../types';
import {
  SectionEvidenceMappingSchema,
  SectionStatusAssessmentSchema,
  DraftGenerationSchema,
  NextQuestionSchema,
  DraftUpdateSchema
} from './schemas';

// Mock data for testing without LLM API
export function getMockEvidenceMapping() {
  return {
    sectionToEvidenceMap: {
      TITLE: [],
      ABSTRACT: ['45세 남성 환자가 우측 하복부 통증으로 내원'],
      INTRODUCTION: [],
      PATIENT_INFORMATION: ['45세 남성', '우측 하복부 통증'],
      CLINICAL_FINDINGS: [
        '활력 징후 안정적',
        '우측 하복부 압통 및 반발압통 양성',
        '맥버니 점 압통 양성',
        '백혈구 12,500/μL',
        'CRP 3.5 mg/dL',
        '복부 CT에서 충수 비대 및 주변 염증 소견 확인'
      ],
      TIMELINE: [
        '2024-01-15: 초진 내원, 통증 시작',
        '2024-01-15: 검사 시행, 급성 충수염 확진',
        '2024-01-16: 복강경 충수절제술 시행'
      ],
      DIAGNOSTIC_ASSESSMENT: [
        '급성 충수염 의심',
        '급성 충수염 확진',
        '복부 CT에서 충수 비대 및 주변 염증 소견 확인'
      ],
      THERAPEUTIC_INTERVENTIONS: [
        '혈액 검사(백혈구, CRP)',
        '복부 CT 촬영',
        '항생제 투여 시작',
        '복강경 충수절제술 시행'
      ],
      FOLLOW_UP_OUTCOMES: [
        '수술 후 활력 징후 안정적',
        '수술 성공적, 회복 양호',
        '조기 보행 권장'
      ],
      DISCUSSION_CONCLUSION: [],
      PATIENT_PERSPECTIVE: [],
      INFORMED_CONSENT: []
    }
  };
}

export function getMockStatusAssessment() {
  return {
    sectionStatusMap: {
      TITLE: {
        status: 'IMPOSSIBLE',
        rationaleText: 'EMR에는 제목 정보가 포함되어 있지 않습니다. 사용자가 직접 작성해야 합니다.',
        missingInfoBullets: ['증례보고서 제목'],
        recommendedQuestions: ['이 증례보고서의 제목을 무엇으로 하시겠습니까?']
      },
      ABSTRACT: {
        status: 'PARTIAL_POSSIBLE',
        rationaleText: 'EMR에서 기본적인 환자 정보와 주요 증상은 확인할 수 있으나, 요약을 완성하기 위해서는 추가 정보가 필요합니다.',
        missingInfoBullets: ['주요 결론', '임상적 의의'],
        recommendedQuestions: ['이 증례의 주요 임상적 의의는 무엇입니까?']
      },
      INTRODUCTION: {
        status: 'IMPOSSIBLE',
        rationaleText: '서론은 일반적인 의학적 배경 지식을 필요로 하며, EMR에는 포함되어 있지 않습니다.',
        missingInfoBullets: ['질병의 배경', '문헌 고찰', '보고 목적'],
        recommendedQuestions: ['이 증례를 보고하는 목적은 무엇입니까?']
      },
      PATIENT_INFORMATION: {
        status: 'PARTIAL_POSSIBLE',
        rationaleText: 'EMR에서 기본적인 환자 정보는 확인할 수 있으나, 상세한 인구통계학적 정보가 부족합니다.',
        missingInfoBullets: ['나이', '성별', '과거력', '가족력'],
        recommendedQuestions: ['환자의 나이와 성별을 알려주세요.', '과거력이나 가족력이 있습니까?']
      },
      CLINICAL_FINDINGS: {
        status: 'FULLY_POSSIBLE',
        rationaleText: 'EMR에 충분한 임상 소견이 기록되어 있어 초안 작성이 가능합니다.',
        missingInfoBullets: [],
        recommendedQuestions: []
      },
      TIMELINE: {
        status: 'POSSIBLE',
        rationaleText: 'EMR에서 방문 일시와 주요 사건은 확인할 수 있으나, 더 상세한 타임라인 정리가 필요할 수 있습니다.',
        missingInfoBullets: [],
        recommendedQuestions: []
      },
      DIAGNOSTIC_ASSESSMENT: {
        status: 'FULLY_POSSIBLE',
        rationaleText: 'EMR에 진단 과정과 결과가 상세히 기록되어 있습니다.',
        missingInfoBullets: [],
        recommendedQuestions: []
      },
      THERAPEUTIC_INTERVENTIONS: {
        status: 'FULLY_POSSIBLE',
        rationaleText: 'EMR에 치료 계획과 시행 내용이 기록되어 있습니다.',
        missingInfoBullets: [],
        recommendedQuestions: []
      },
      FOLLOW_UP_OUTCOMES: {
        status: 'POSSIBLE',
        rationaleText: 'EMR에 수술 후 초기 결과는 기록되어 있으나, 장기 추적 결과가 필요할 수 있습니다.',
        missingInfoBullets: ['장기 추적 결과'],
        recommendedQuestions: ['추가 추적 관찰 결과가 있습니까?']
      },
      DISCUSSION_CONCLUSION: {
        status: 'PARTIAL_IMPOSSIBLE',
        rationaleText: '토론과 결론은 의학적 해석과 문헌 고찰이 필요하여 EMR만으로는 부족합니다.',
        missingInfoBullets: ['임상적 의의', '문헌 고찰', '결론'],
        recommendedQuestions: ['이 증례의 임상적 의의는 무엇입니까?', '관련 문헌과 비교하여 논의할 점이 있습니까?']
      },
      PATIENT_PERSPECTIVE: {
        status: 'IMPOSSIBLE',
        rationaleText: '환자 관점은 EMR에 포함되지 않으며, 환자 인터뷰가 필요합니다.',
        missingInfoBullets: ['환자의 경험', '환자의 관점'],
        recommendedQuestions: ['환자가 이 경험에 대해 어떻게 느꼈는지 알려주세요.']
      },
      INFORMED_CONSENT: {
        status: 'IMPOSSIBLE',
        rationaleText: '동의서 정보는 EMR에 포함되지 않을 수 있으며, 별도 확인이 필요합니다.',
        missingInfoBullets: ['동의서 확인'],
        recommendedQuestions: ['환자 동의서가 작성되었습니까?']
      }
    }
  };
}

export function getMockDraftGeneration() {
  return {
    draftsBySection: {
      TITLE: '',
      ABSTRACT: '45세 남성 환자가 우측 하복부 통증을 주소로 내원하였다. 임상 소견과 검사 결과를 바탕으로 급성 충수염으로 진단되었으며, 복강경 충수절제술을 시행받았다.',
      INTRODUCTION: '',
      PATIENT_INFORMATION: '45세 남성 환자. 우측 하복부 통증을 주소로 내원.',
      CLINICAL_FINDINGS: `활력 징후는 안정적이었다. 복부 검진에서 우측 하복부 압통 및 반발압통이 양성이었고, 맥버니 점 압통도 양성이었다. 혈액 검사에서 백혈구는 12,500/μL, CRP는 3.5 mg/dL로 상승되어 있었다. 복부 CT에서 충수 비대 및 주변 염증 소견이 확인되었다.`,
      TIMELINE: `2024년 1월 15일: 초진 내원, 3일 전부터 시작된 우측 하복부 통증
2024년 1월 15일: 검사 시행, 급성 충수염 확진
2024년 1월 16일: 복강경 충수절제술 시행`,
      DIAGNOSTIC_ASSESSMENT: `초기 평가에서 급성 충수염을 의심하였고, 혈액 검사와 복부 CT를 통해 확진하였다. 복부 CT에서 충수 비대 및 주변 염증 소견이 확인되었다.`,
      THERAPEUTIC_INTERVENTIONS: `혈액 검사(백혈구, CRP)와 복부 CT 촬영을 시행하였다. 급성 충수염 확진 후 항생제 투여를 시작하였고, 복강경 충수절제술을 시행하였다.`,
      FOLLOW_UP_OUTCOMES: `수술 후 활력 징후는 안정적이었고, 수술은 성공적으로 완료되었다. 회복 양호하였으며, 조기 보행을 권장하였다.`,
      DISCUSSION_CONCLUSION: '',
      PATIENT_PERSPECTIVE: '',
      INFORMED_CONSENT: ''
    },
    citations: {
      CLINICAL_FINDINGS: ['visit1', 'visit2'],
      DIAGNOSTIC_ASSESSMENT: ['visit2'],
      THERAPEUTIC_INTERVENTIONS: ['visit1', 'visit2', 'visit3']
    }
  };
}

export function getMockNextQuestion() {
  return {
    question: '이 증례의 주요 임상적 의의는 무엇입니까?',
    context: 'ABSTRACT 섹션을 완성하기 위해 필요한 정보입니다.',
    isComplete: false
  };
}

export function getMockDraftUpdate() {
  return {
    updatedDraft: '45세 남성 환자가 우측 하복부 통증을 주소로 내원하였다. 임상 소견과 검사 결과를 바탕으로 급성 충수염으로 진단되었으며, 복강경 충수절제술을 시행받았다. 이 증례는 전형적인 급성 충수염의 진단 및 치료 과정을 보여준다.',
    addedFacts: [],
    isComplete: true,
    nextQuestion: undefined
  };
}
