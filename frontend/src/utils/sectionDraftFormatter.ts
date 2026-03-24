type JsonObject = Record<string, unknown>;

const EMPTY_TEXT = '정보가 제공되지 않았습니다.';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function ensureSentence(text: string, suffix = '이다.'): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/[.!?。？！]$/.test(trimmed)) return trimmed;
  return `${trimmed}${suffix}`;
}

function hasBatchim(word: string): boolean {
  const trimmed = word.trim();
  if (!trimmed) return false;
  const ch = trimmed.charCodeAt(trimmed.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return false;
  return (ch - 0xac00) % 28 !== 0;
}

function withJosa(word: string, josaBatchim: string, josaNoBatchim: string): string {
  const target = word.trim();
  if (!target) return '';
  return `${target}${hasBatchim(target) ? josaBatchim : josaNoBatchim}`;
}

function normalizeSex(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return '';
  if (v === 'f' || v === 'female' || v === 'woman' || v.includes('여')) return '여성';
  if (v === 'm' || v === 'male' || v === 'man' || v.includes('남')) return '남성';
  return value.trim();
}

function normalizeAge(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (/[0-9]+세/.test(v)) return v;
  if (/^[0-9]+$/.test(v)) return `${v}세`;
  return v;
}

function joinWithAnd(items: string[]): string {
  const clean = items.map((v) => v.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]}과 ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, ${clean[clean.length - 1]}`;
}

function normalizeFamilyHistoryItem(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const fatherMatch = text.match(/^아버지(?:가|께서)?\s+(.+?)(?:가|이)?\s+있으심$/);
  if (fatherMatch) return `부친의 ${fatherMatch[1]} 병력`;
  const motherMatch = text.match(/^어머니(?:가|께서)?\s+(.+?)(?:가|이)?\s+있으심$/);
  if (motherMatch) return `모친의 ${motherMatch[1]} 병력`;
  return text;
}

function formatDateForNarrative(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${Number(y)}년 ${Number(m)}월 ${Number(d)}일`;
  }
  return text;
}

function parseMaybeJson(raw: string): unknown {
  const text = (raw || '').trim();
  if (!text) return '';
  if (!(text.startsWith('{') || text.startsWith('['))) return text;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

function pickString(obj: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function pickList(obj: JsonObject, keys: string[]): string[] {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      const items = value
        .map((v) => {
          if (typeof v === 'string') return v.trim();
          if (isObject(v) && typeof v.text === 'string') return v.text.trim();
          return '';
        })
        .filter(Boolean);
      if (items.length > 0) return items;
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
  }
  return [];
}

function flattenText(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenText(item));
  }
  if (isObject(value)) {
    if (typeof value.text === 'string' && value.text.trim()) return [value.text.trim()];
    return Object.values(value).flatMap((item) => flattenText(item));
  }
  return [];
}

function splitJsonObjects(raw: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return chunks;
}

function parseTimelineItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data !== 'string') return [];

  const text = data.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const objectChunks = splitJsonObjects(text);
    const parsedItems = objectChunks
      .map((chunk) => {
        try {
          return JSON.parse(chunk);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (parsedItems.length > 0) return parsedItems;
  }

  return text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTimelineVisitLabel(item: JsonObject, index: number): string {
  const visitType = pickString(item, ['visit_type', 'visitType', 'type']);
  const dateText = formatDateForNarrative(pickString(item, ['date', 'visit_date', 'time']));

  if (dateText && visitType) return `${dateText} ${visitType} 시`;
  if (dateText) return `${dateText} 방문 시`;
  if (visitType) return `${visitType} 시`;
  return index === 0 ? '초기 방문 시' : `${index + 1}번째 방문 시`;
}

function formatPatientInformation(data: JsonObject): string {
  const age = normalizeAge(pickString(data, ['age']));
  const sex = normalizeSex(pickString(data, ['sex', 'gender']));
  const chiefComplaints = pickList(data, ['chief_complaints', 'chiefComplaint', 'complaints']);
  const history = pickList(data, ['history', 'medical_history', 'present_illness']);
  const familyHistory = pickList(data, ['family_history', 'familyHistory']);
  const psychosocial = pickList(data, ['psychosocial_context', 'psychosocial', 'context']);

  const lines: string[] = [];
  if (age || sex) {
    const descriptor = [age, sex].filter(Boolean).join(' ');
    lines.push(ensureSentence(`환자는 ${withJosa(descriptor, '으로', '로')}`, ' 내원하였다.'));
  }
  if (chiefComplaints.length > 0) {
    lines.push(ensureSentence(`${withJosa(joinWithAnd(chiefComplaints), '을', '를')} 주소로 내원하였다.`, ''));
  }
  if (history.length > 0) {
    const text = joinWithAnd(history);
    lines.push(ensureSentence(`과거력 및 현병력으로 ${withJosa(text, '이', '가')} 확인되었다.`, ''));
  }
  if (familyHistory.length > 0) {
    const text = joinWithAnd(familyHistory.map(normalizeFamilyHistoryItem));
    lines.push(ensureSentence(`가족력으로 ${withJosa(text, '이', '가')} 확인되었다.`, ''));
  }
  if (psychosocial.length > 0) {
    const text = joinWithAnd(psychosocial);
    lines.push(ensureSentence(`심리사회적 배경으로 ${withJosa(text, '이', '가')} 보고되었다.`, ''));
  }

  if (lines.length > 0) return lines.join('\n\n');
  const fallback = flattenText(data).join(' ');
  return fallback || EMPTY_TEXT;
}

function formatClinicalFindings(data: JsonObject): string {
  const physical = pickList(data, ['physical_symptoms', 'physical']);
  const sleep = pickList(data, ['sleep_symptoms', 'sleep']);
  const emotional = pickList(data, ['emotional_symptoms', 'emotional']);
  const exam = pickList(data, ['exam_findings', 'findings']);

  const lines: string[] = [];
  if (physical.length > 0) {
    const text = joinWithAnd(physical);
    lines.push(ensureSentence(`신체 증상으로 ${withJosa(text, '을', '를')} 호소하였다.`, ''));
  }
  if (sleep.length > 0) {
    const text = joinWithAnd(sleep);
    lines.push(ensureSentence(`수면과 관련하여 ${withJosa(text, '이', '가')} 관찰되었다.`, ''));
  }
  if (emotional.length > 0) {
    const text = joinWithAnd(emotional);
    lines.push(ensureSentence(`정서 상태로 ${withJosa(text, '이', '가')} 확인되었다.`, ''));
  }
  if (exam.length > 0) {
    const text = joinWithAnd(exam);
    lines.push(ensureSentence(`진찰 소견은 ${text}였다.`, ''));
  }

  if (lines.length > 0) return lines.join('\n\n');
  const fallback = flattenText(data).join(' ');
  return fallback || EMPTY_TEXT;
}

function formatTimeline(data: unknown): string {
  const items = parseTimelineItems(data);
  if (items.length === 0) {
    const fallback = flattenText(data).join(' ');
    return fallback || EMPTY_TEXT;
  }

  const paragraphs = items
    .map((item, index) => {
      if (typeof item === 'string') {
        return ensureSentence(item, '');
      }
      if (!isObject(item)) return '';

      const label = formatTimelineVisitLabel(item, index);
      const events = pickList(item, ['events', 'details', 'notes']);
      const tail = joinWithAnd(events);

      if (label && tail) return ensureSentence(`${label} ${tail}`, '');
      if (tail) return ensureSentence(tail, '');
      const fallback = flattenText(item).join(' ');
      return fallback ? ensureSentence(fallback, '') : '';
    })
    .filter(Boolean);

  return paragraphs.length > 0 ? paragraphs.join('\n\n') : EMPTY_TEXT;
}

function formatDiagnosticAssessment(data: JsonObject): string {
  const diagnosis = pickList(data, ['diagnosis', 'diagnoses']);
  const methods = pickList(data, ['diagnostic_methods', 'methods']);
  const reasoning = pickList(data, ['clinical_reasoning', 'reasoning']);

  const lines: string[] = [];
  if (diagnosis.length > 0) {
    const text = joinWithAnd(diagnosis);
    lines.push(ensureSentence(`임상적으로 ${withJosa(text, '을', '를')} 고려하였다.`, ''));
  }
  if (methods.length > 0) {
    const text = joinWithAnd(methods);
    lines.push(ensureSentence(`진단 평가는 ${withJosa(text, '을', '를')} 통해 수행하였다.`, ''));
  }
  if (reasoning.length > 0) {
    const text = joinWithAnd(reasoning);
    lines.push(ensureSentence(`임상 판단 근거로 ${withJosa(text, '을', '를')} 참고하였다.`, ''));
  }

  if (lines.length > 0) return lines.join('\n\n');
  const fallback = flattenText(data).join(' ');
  return fallback || EMPTY_TEXT;
}

function formatTherapeuticIntervention(data: JsonObject): string {
  const type = pickList(data, ['type', 'intervention_type']);
  const details = pickList(data, ['details', 'intervention_details', 'acupoints']);
  const frequency = pickString(data, ['frequency']);
  const duration = pickString(data, ['duration']);

  const lines: string[] = [];
  if (type.length > 0) {
    const text = joinWithAnd(type);
    lines.push(ensureSentence(`치료는 ${text} 중심으로 시행하였다.`, ''));
  }
  if (details.length > 0) {
    const text = joinWithAnd(details);
    lines.push(ensureSentence(`구체적 중재 내용은 ${text}였다.`, ''));
  }
  if (frequency || duration) {
    const meta = [frequency ? `빈도 ${frequency}` : '', duration ? `기간 ${duration}` : '']
      .filter(Boolean)
      .join(', ');
    lines.push(ensureSentence(`치료 계획은 ${meta}로 설정하였다.`, ''));
  }

  if (lines.length > 0) return lines.join('\n\n');
  const fallback = flattenText(data).join(' ');
  return fallback || EMPTY_TEXT;
}

function formatFollowUpOutcomes(data: JsonObject): string {
  const progression = pickList(data, ['symptom_progression', 'progression']);
  const response = pickList(data, ['treatment_response', 'response']);
  const adverse = pickList(data, ['adverse_events', 'adverse_event']);

  const lines: string[] = [];
  if (progression.length > 0) {
    const text = joinWithAnd(progression);
    lines.push(ensureSentence(`추적 관찰에서 증상 경과는 ${text}로 기록되었다.`, ''));
  }
  if (response.length > 0) {
    const text = joinWithAnd(response);
    lines.push(ensureSentence(`치료 반응은 ${text}로 확인되었다.`, ''));
  }
  if (adverse.length > 0) {
    const text = joinWithAnd(adverse);
    lines.push(ensureSentence(`이상반응은 ${withJosa(text, '이', '가')} 보고되었다.`, ''));
  }

  if (lines.length > 0) return lines.join('\n\n');
  const fallback = flattenText(data).join(' ');
  return fallback || EMPTY_TEXT;
}

function formatPatientPerspective(data: unknown): string {
  if (typeof data === 'string') return data.trim() || EMPTY_TEXT;
  if (!isObject(data)) {
    const fallback = flattenText(data).join(' ');
    return fallback || EMPTY_TEXT;
  }

  const experiences = pickList(data, ['reported_experiences', 'experiences']);
  if (experiences.length > 0) {
    const text = joinWithAnd(experiences);
    return ensureSentence(`환자는 ${text}라고 진술하였다.`, '');
  }
  const fallback = flattenText(data).join(' ');
  return fallback || EMPTY_TEXT;
}

export function ensureKoreanQuestion(text: string): string {
  const input = String(text || '').trim();
  if (!input) return '';
  if (/[가-힣]/.test(input)) return input;
  return `다음 정보를 알려주세요: ${input}`;
}

export function formatSectionDraftForDisplay(sectionId: string, rawDraft: string): string {
  const raw = toNonEmptyString(rawDraft);
  if (!raw) return EMPTY_TEXT;

  if (sectionId === 'TIMELINE') {
    return formatTimeline(parseMaybeJson(raw));
  }

  const parsed = parseMaybeJson(raw);
  if (typeof parsed === 'string') {
    return parsed.trim() || EMPTY_TEXT;
  }

  if (!isObject(parsed)) {
    const fallback = flattenText(parsed).join(' ');
    return fallback || EMPTY_TEXT;
  }

  switch (sectionId) {
    case 'PATIENT_INFORMATION':
      return formatPatientInformation(parsed);
    case 'CLINICAL_FINDINGS':
      return formatClinicalFindings(parsed);
    case 'DIAGNOSTIC_ASSESSMENT':
      return formatDiagnosticAssessment(parsed);
    case 'THERAPEUTIC_INTERVENTIONS':
      return formatTherapeuticIntervention(parsed);
    case 'FOLLOW_UP_OUTCOMES':
      return formatFollowUpOutcomes(parsed);
    case 'PATIENT_PERSPECTIVE':
      return formatPatientPerspective(parsed);
    default: {
      const fallback = flattenText(parsed).join(' ');
      return fallback || EMPTY_TEXT;
    }
  }
}
