import { CommonMissingItem } from '../llm/schemas/chain4_missing';

export type CommonQuestionCategory = NonNullable<CommonMissingItem['category']>;

export const COMMON_QUESTION_FALLBACK_TEMPLATES: Record<CommonQuestionCategory, string> = {
  psychosocial_context: '가족, 직장, 생활 사건 또는 스트레스 요인이 증상 변화와 어떻게 연결되었는지 알려주세요.',
  symptom_course: '치료 기간 동안 환자의 주요 증상이 시간에 따라 어떻게 변화했는지 설명해 주세요.',
  functional_impact: '치료 전후 환자의 수면, 식사, 일상 활동 등 기능 변화가 있었는지 설명해 주세요.',
  treatment_response: '치료 후 환자가 가장 크게 체감한 변화와 아직 남아 있는 증상이 있다면 설명해 주세요.',
  patient_perspective: '치료 후 환자가 직접 체감한 변화가 있었다면 설명해 주세요.',
  diagnostic_reasoning: '진단 또는 의심 진단을 판단하는 데 중요했던 증상, 소견, 배경 요인이 있다면 설명해 주세요.',
  follow_up_outcome: '추적 관찰 시점에서 증상, 기능, 수면 또는 정서 상태가 어떻게 변했는지 알려주세요.',
  adverse_event: '치료 중 이상반응이나 예상하지 못한 불편감이 있었다면 알려주세요.',
  consent: '증례보고를 위한 동의 여부와 동의를 받은 방식이 확인되면 알려주세요.',
  timeline_clarification: '주요 증상, 검사, 치료, 경과가 어떤 순서로 진행되었는지 시점별로 알려주세요.'
};

const ENGLISH_TEMPLATE_TO_KOREAN: Record<string, string> = {
  'how did the patient s symptoms change over time during the treatment period':
    COMMON_QUESTION_FALLBACK_TEMPLATES.symptom_course,
  'how did the patient symptoms change over time during the treatment period':
    COMMON_QUESTION_FALLBACK_TEMPLATES.symptom_course,
  'how did the patient s daily functioning change before and after treatment':
    COMMON_QUESTION_FALLBACK_TEMPLATES.functional_impact,
  'how did the patient daily functioning change before and after treatment':
    COMMON_QUESTION_FALLBACK_TEMPLATES.functional_impact,
  'what changes did the patient perceive after treatment':
    COMMON_QUESTION_FALLBACK_TEMPLATES.patient_perspective,
  'what evidence supported the diagnostic assessment':
    COMMON_QUESTION_FALLBACK_TEMPLATES.diagnostic_reasoning
};

function normalizeTemplateKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsKorean(text: string): boolean {
  return /[가-힣]/.test(String(text || ''));
}

export function isEnglishLikeQuestion(text: string): boolean {
  const source = String(text || '').trim();
  if (!source || containsKorean(source)) return false;

  if (/^[A-Za-z0-9 ,.?'()"\/-]+$/.test(source)) return true;

  const letters = (source.match(/[A-Za-z]/g) || []).length;
  const digitsAndPunct = (source.match(/[0-9 ,.?'()"\/-]/g) || []).length;
  const effectiveLength = Math.max(source.length - digitsAndPunct, 1);
  return letters / effectiveLength >= 0.6;
}

export function inferQuestionCategoryFromText(
  text: string,
  fallbackCategory?: string
): CommonQuestionCategory | undefined {
  if (fallbackCategory && fallbackCategory in COMMON_QUESTION_FALLBACK_TEMPLATES) {
    return fallbackCategory as CommonQuestionCategory;
  }

  const normalized = normalizeTemplateKey(text);

  if (/family|stress|psychosocial|life|context|가족|스트레스|심리사회|생활/.test(normalized)) {
    return 'psychosocial_context';
  }
  if (/symptom|visit|time|course|timeline|change|증상|방문|경과|시간|타임라인/.test(normalized)) {
    return 'symptom_course';
  }
  if (/sleep|appetite|daily|function|work|relationship|수면|식사|일상|기능|직장|대인관계/.test(normalized)) {
    return 'functional_impact';
  }
  if (/treatment|response|improvement|residual|치료|반응|호전|잔여/.test(normalized)) {
    return 'treatment_response';
  }
  if (/patient|perspective|perceive|felt|meaningful|환자|소감|체감|느낌/.test(normalized)) {
    return 'patient_perspective';
  }
  if (/diagnostic|diagnosis|reasoning|exclude|assessment|진단|감별|배제|판단/.test(normalized)) {
    return 'diagnostic_reasoning';
  }
  if (/follow up|followup|outcome|long term|추적|경과|결과/.test(normalized)) {
    return 'follow_up_outcome';
  }
  if (/adverse|side effect|부작용|이상반응/.test(normalized)) {
    return 'adverse_event';
  }
  if (/consent|동의/.test(normalized)) {
    return 'consent';
  }
  if (/timeline|chronology|order|시점|순서/.test(normalized)) {
    return 'timeline_clarification';
  }

  return undefined;
}

export function normalizeQuestionText(
  text: string,
  category?: string
): string {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';

  const directMapped = ENGLISH_TEMPLATE_TO_KOREAN[normalizeTemplateKey(source)];
  if (directMapped) return directMapped;

  if (containsKorean(source)) return source;

  if (isEnglishLikeQuestion(source)) {
    const inferredCategory = inferQuestionCategoryFromText(source, category);
    if (inferredCategory) {
      return COMMON_QUESTION_FALLBACK_TEMPLATES[inferredCategory];
    }
    return '';
  }

  return source;
}

export function normalizeQuestionComparisonKey(
  text: string,
  category?: string
): string {
  return normalizeTemplateKey(normalizeQuestionText(text, category) || text).replace(/\s+/g, '');
}
