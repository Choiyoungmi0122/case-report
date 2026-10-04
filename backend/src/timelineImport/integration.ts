import { CareSection } from '../types';
import { EvidenceCard } from '../llm/schemas/chain1_splitTag';
import { TimelineEvent } from './types';

function text(value?: string | number | null) {
  return String(value ?? '').trim();
}

const IMPORTED_TIMELINE_LABELS = [
  'Imported structured timeline narrative',
  'Imported timeline table',
  '가져온 타임라인',
  '가져온 타임라인 데이터'
];

function isImportedTimelineLabel(line: string) {
  return IMPORTED_TIMELINE_LABELS.includes(text(line));
}

function stripImportedTimelineBlocks(rawText: string) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  const keptLines: string[] = [];
  let skippingImportedBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (isImportedTimelineLabel(trimmed)) {
      skippingImportedBlock = true;
      continue;
    }

    if (skippingImportedBlock) {
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('- ') || trimmed.includes('|')) {
        continue;
      }

      skippingImportedBlock = false;
    }

    keptLines.push(line);
  }

  return keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeHeaderKey(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_/()\-]/g, '');
}

function getDisplayValue(event: TimelineEvent, header: string) {
  return text(event.cells?.[header]);
}

function getDisplayHeaders(events: TimelineEvent[]) {
  return events.find((event) => Array.isArray(event.columnOrder) && event.columnOrder.length > 0)?.columnOrder || [];
}

function isMetaHeader(header: string) {
  const key = normalizeHeaderKey(header);
  return /^(date|datetime|day|visit|visitno|visitnumber|visit_no|시점|날짜|일자|방문|방문차수|차수)$/.test(key);
}

function isScoreLikeHeader(header: string) {
  const key = normalizeHeaderKey(header);
  return /(nrs|vas|score|quality|phq|gad|isi|bdi|anxiety|sleep|palpitation|점수|척도)/.test(key);
}

function toNumber(value: string) {
  if (!text(value)) return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateLabel(value: string) {
  const source = text(value);
  if (!source) return '';
  const match = source.match(/(\d{2,4})[./\-](\d{1,2})[./\-](\d{1,2})/);
  if (!match) return source;
  const [, year, month, day] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}년 ${Number(month)}월 ${Number(day)}일`;
}

function buildVisitLabel(event: TimelineEvent, index: number) {
  const date = formatDateLabel(event.date || '');
  const visit = text(event.visitNo);

  let visitLabel = '';
  if (/^initial$/i.test(visit) || visit === '초진') {
    visitLabel = '초진';
  } else if (/visit\s*\d+/i.test(visit)) {
    const num = visit.match(/\d+/)?.[0];
    visitLabel = num ? `${num}차 방문` : visit;
  } else if (/^\d+$/.test(visit)) {
    visitLabel = `${visit}차 방문`;
  } else if (visit) {
    visitLabel = visit;
  } else if (index === 0) {
    visitLabel = '초진';
  } else {
    visitLabel = `${index + 1}차 방문`;
  }

  return [date, visitLabel].filter(Boolean).join(' ');
}

function collectNarrativeEntries(event: TimelineEvent) {
  const headers = event.columnOrder || Object.keys(event.cells || {});
  return headers
    .filter((header) => !isMetaHeader(header))
    .map((header) => ({
      header,
      value: getDisplayValue(event, header)
    }))
    .filter((entry) => entry.value);
}

function joinKoreanList(items: string[]) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} 및 ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, 그리고 ${items[items.length - 1]}`;
}

function describeBaselineEntry(header: string, value: string) {
  if (isScoreLikeHeader(header)) {
    return `${header}은 ${value}`;
  }
  return `${header}은 ${value}`;
}

function buildPeriodSentence(events: TimelineEvent[]) {
  if (events.length === 0) return '';
  const first = buildVisitLabel(events[0], 0);
  const last = buildVisitLabel(events[events.length - 1], events.length - 1);
  if (!first && !last) return '';
  if (events.length === 1 || first === last) {
    return `${first} 시점의 경과가 기록되었다.`;
  }
  return `${first}부터 ${last}까지의 경과가 추적 관찰되었다.`;
}

function buildBaselineSentence(event: TimelineEvent, index: number) {
  const entries = collectNarrativeEntries(event)
    .slice(0, 5)
    .map((entry) => describeBaselineEntry(entry.header, entry.value))
    .filter(Boolean);

  if (entries.length === 0) return '';

  return `${buildVisitLabel(event, index)} 당시 ${joinKoreanList(entries)} 수준으로 확인되었다.`;
}

function buildTrendSentences(events: TimelineEvent[]) {
  const headers = getDisplayHeaders(events);
  const targetHeaders = headers.filter((header) => !isMetaHeader(header) && isScoreLikeHeader(header)).slice(0, 5);
  const sentences: string[] = [];

  for (const header of targetHeaders) {
    const first = toNumber(getDisplayValue(events[0], header));
    const last = toNumber(getDisplayValue(events[events.length - 1], header));
    if (first == null || last == null || first === last) continue;

    if (header.toLowerCase().includes('sleep') || header.includes('수면')) {
      if (last > first) {
        sentences.push(`${header}은 초기 ${first}에서 최종 추적 시 ${last}로 개선되었다.`);
      } else {
        sentences.push(`${header}은 초기 ${first}에서 최종 추적 시 ${last}로 변화하였다.`);
      }
      continue;
    }

    if (last < first) {
      sentences.push(`${header}은 초기 ${first}에서 최종 추적 시 ${last}로 감소하였다.`);
    } else {
      sentences.push(`${header}은 초기 ${first}에서 최종 추적 시 ${last}로 증가하였다.`);
    }
  }

  return sentences.slice(0, 4);
}

function buildTreatmentSentence(events: TimelineEvent[]) {
  const treatmentHeaders = getDisplayHeaders(events).filter((header) => /(treatment|intervention|therapy|치료|중재)/i.test(header));
  if (treatmentHeaders.length === 0) return '';

  const values = new Set<string>();
  for (const event of events) {
    for (const header of treatmentHeaders) {
      const value = getDisplayValue(event, header);
      if (value) values.add(value);
    }
  }

  const treatmentList = Array.from(values).slice(0, 4);
  if (treatmentList.length === 0) return '';
  return `관찰 기간 동안 ${joinKoreanList(treatmentList)}이 시행되었다.`;
}

function buildOutcomeSentence(events: TimelineEvent[]) {
  const outcomeHeaders = getDisplayHeaders(events).filter((header) => /(outcome|progress|followup|result|경과|결과|추적)/i.test(header));
  if (outcomeHeaders.length === 0) return '';

  const lastEvent = events[events.length - 1];
  const values = outcomeHeaders
    .map((header) => getDisplayValue(lastEvent, header))
    .filter(Boolean)
    .slice(0, 3);

  if (values.length === 0) return '';
  return `최종 추적 시 ${joinKoreanList(values)} 경과를 보였다.`;
}

export function buildTimelineNarrativeFromEvents(events: TimelineEvent[]): string {
  if (!events.length) return '';

  const paragraphs = [
    buildPeriodSentence(events),
    buildBaselineSentence(events[0], 0),
    ...buildTrendSentences(events),
    buildTreatmentSentence(events),
    buildOutcomeSentence(events)
  ].filter(Boolean);

  return paragraphs.join(' ');
}

function formatTimelineEventRow(event: TimelineEvent) {
  const headers = event.columnOrder || Object.keys(event.cells || {});
  const parts = headers
    .map((header) => {
      const value = getDisplayValue(event, header);
      if (!value) return '';
      return `${header}: ${value}`;
    })
    .filter(Boolean);

  if (parts.length > 0) {
    return `- ${parts.join(' | ')}`;
  }

  const fallback = [
    event.date || '',
    event.visitNo ? `visit ${event.visitNo}` : '',
    event.symptom ? `symptom: ${event.symptom}` : '',
    event.test ? `test: ${event.test}` : '',
    event.diagnosis ? `diagnosis: ${event.diagnosis}` : '',
    event.treatment ? `treatment: ${event.treatment}` : '',
    event.outcome ? `outcome: ${event.outcome}` : '',
    event.note ? `note: ${event.note}` : ''
  ].filter(Boolean);

  return `- ${fallback.join(' | ')}`;
}

function inferSectionsFromHeader(header: string): CareSection[] {
  const key = normalizeHeaderKey(header);
  const sections = new Set<CareSection>([CareSection.TIMELINE]);

  if (/visit|date|day|timeline|시점|날짜|일자|내원|방문/.test(key)) {
    sections.add(CareSection.TIMELINE);
  }
  if (/symptom|chiefcomplaint|tightness|pain|anxiety|sleep|palpitation|heat|증상|통증|불안|수면|두근거림|상열/.test(key)) {
    sections.add(CareSection.CLINICAL_FINDINGS);
    sections.add(CareSection.FOLLOW_UP_OUTCOMES);
  }
  if (/test|evaluation|assessment|phq|gad|isi|bdi|nrs|vas|score|quality|검사|평가|점수/.test(key)) {
    sections.add(CareSection.DIAGNOSTIC_ASSESSMENT);
    sections.add(CareSection.FOLLOW_UP_OUTCOMES);
  }
  if (/diagnosis|impression|진단|판단/.test(key)) {
    sections.add(CareSection.DIAGNOSTIC_ASSESSMENT);
  }
  if (/treatment|intervention|therapy|plan|치료|중재|처치/.test(key)) {
    sections.add(CareSection.THERAPEUTIC_INTERVENTIONS);
  }
  if (/outcome|progress|followup|result|경과|결과|추적/.test(key)) {
    sections.add(CareSection.FOLLOW_UP_OUTCOMES);
  }

  return Array.from(sections);
}

export function formatTimelineEventsAsDraftText(events: TimelineEvent[]): string {
  if (!events.length) {
    return '';
  }

  const narrative = buildTimelineNarrativeFromEvents(events);
  if (narrative.trim()) return narrative;

  return events.map((event) => formatTimelineEventRow(event)).join('\n');
}

export function mergeTimelineDraftWithEvents(params: {
  currentDraftText: string;
  timelineEvents: TimelineEvent[];
}) {
  const importedNarrative = formatTimelineEventsAsDraftText(params.timelineEvents);
  if (!importedNarrative) {
    return {
      draftText: text(params.currentDraftText),
      timelineEventIdsUsed: [] as string[]
    };
  }

  const baseDraft = stripImportedTimelineBlocks(params.currentDraftText);
  const parts = [baseDraft, '가져온 타임라인', importedNarrative].filter(Boolean);

  return {
    draftText: parts.join('\n\n'),
    timelineEventIdsUsed: params.timelineEvents.map((event) => event.timelineEventId)
  };
}

export function ensureTimelineSectionState(sectionStates: any[], hasTimelineData: boolean) {
  const existing = sectionStates.find((state) => state.sectionId === CareSection.TIMELINE);
  if (!existing && !hasTimelineData) return sectionStates;

  const nextState = {
    sectionId: CareSection.TIMELINE,
    status: hasTimelineData ? 'READY' : existing?.status || 'INCOMPLETE',
    rationaleText: hasTimelineData
      ? 'Timeline section was enriched with imported Excel timeline events.'
      : existing?.rationaleText || 'Timeline section is available for refinement.',
    missingInfoBullets: existing?.missingInfoBullets || [],
    recommendedQuestions: existing?.recommendedQuestions || []
  };

  if (existing) {
    Object.assign(existing, nextState);
    return sectionStates;
  }

  return [...sectionStates, nextState];
}

export function integrateImportedTimelineIntoDrafts(params: {
  sectionDrafts: any[];
  sectionStates: any[];
  timelineEvents: TimelineEvent[];
}) {
  const events = params.timelineEvents || [];
  const hasTimelineData = events.length > 0;
  const nextStates = ensureTimelineSectionState(params.sectionStates, hasTimelineData);
  if (!hasTimelineData) {
    return {
      sectionDrafts: params.sectionDrafts,
      sectionStates: nextStates
    };
  }

  const merged = mergeTimelineDraftWithEvents({
    currentDraftText:
      params.sectionDrafts.find((draft) => draft.sectionId === CareSection.TIMELINE)?.draftText || '',
    timelineEvents: events
  });

  const existingDraft = params.sectionDrafts.find((draft) => draft.sectionId === CareSection.TIMELINE);
  if (existingDraft) {
    existingDraft.draftText = merged.draftText;
    existingDraft.timelineEventIdsUsed = merged.timelineEventIdsUsed;
  } else {
    params.sectionDrafts.push({
      sectionId: CareSection.TIMELINE,
      evidenceCardIdsUsed: [],
      timelineEventIdsUsed: merged.timelineEventIdsUsed,
      draftText: merged.draftText,
      openIssues: [],
      evidenceLinks: [],
      unsupportedClaims: []
    });
  }

  return {
    sectionDrafts: params.sectionDrafts,
    sectionStates: nextStates
  };
}

export function buildEvidenceCardsFromTimelineEvents(events: TimelineEvent[]): EvidenceCard[] {
  const results: EvidenceCard[] = [];

  for (const event of events || []) {
    const rowSummary = formatTimelineEventRow(event).replace(/^- /, '').trim();
    const rowSections = new Set<CareSection>([CareSection.TIMELINE]);

    if (rowSummary) {
      results.push({
        id: `timeline-row-${event.timelineEventId}`,
        visitIndex: event.originalRowIndex || 1,
        visitDateTime: event.date || '',
        sourceText: rowSummary,
        normalizedText: rowSummary,
        evidenceType: 'timeline',
        tags: Array.from(rowSections),
        sectionHints: Array.from(rowSections),
        terms: [],
        sourceRef: {
          lineStart: event.originalRowIndex,
          lineEnd: event.originalRowIndex
        },
        confidence: 0.98
      });
    }

    const headers = event.columnOrder || Object.keys(event.cells || {});
    for (const header of headers) {
      const value = getDisplayValue(event, header);
      if (!value) continue;

      const sections = inferSectionsFromHeader(header);
      const prefixParts = [text(event.date), text(event.visitNo)].filter(Boolean).join(' | ');
      const content = [prefixParts, `${header}: ${value}`].filter(Boolean).join(' | ');

      results.push({
        id: `timeline-cell-${event.timelineEventId}-${normalizeHeaderKey(header)}`,
        visitIndex: event.originalRowIndex || 1,
        visitDateTime: event.date || '',
        sourceText: content,
        normalizedText: content,
        evidenceType: sections.includes(CareSection.DIAGNOSTIC_ASSESSMENT)
          ? 'diagnostic_assessment'
          : sections.includes(CareSection.THERAPEUTIC_INTERVENTIONS)
            ? 'treatment'
            : sections.includes(CareSection.FOLLOW_UP_OUTCOMES)
              ? 'follow_up_outcome'
              : sections.includes(CareSection.CLINICAL_FINDINGS)
                ? 'clinical_finding'
                : 'timeline',
        tags: sections,
        sectionHints: sections,
        terms: [],
        sourceRef: {
          lineStart: event.originalRowIndex,
          lineEnd: event.originalRowIndex
        },
        confidence: 0.97
      });
    }
  }

  const deduped = new Map<string, EvidenceCard>();
  for (const card of results) {
    const key = `${card.visitIndex}:${card.sourceText}`;
    if (!deduped.has(key)) deduped.set(key, card);
  }
  return Array.from(deduped.values());
}
