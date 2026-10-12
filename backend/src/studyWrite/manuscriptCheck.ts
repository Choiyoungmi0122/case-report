/**
 * 실험용 Write "원고 검사" (코드 검사, AI 호출 없음).
 *
 * 2026-10-12 임교수 테스트 6 원고를 사람이 기록과 대조해 찾은 문제 유형 가운데, 코드로 잡을 수 있는 것을 자동으로 찾는다
 * (사용자 결정: "AI 하네스" 1번의 코드 검사부터). 고치지는 않고 위치와 이유만 알린다.
 *
 *  - 약재 용량: 원고의 "약재 숫자"가 기록 첩약에 있는지, 0 약재·"(또는 0)"·기록에 없는 단위 g
 *  - 날짜: "첫 기록일 +N일"(범위가 아닌 한 시점)이 실제 방문일인지
 *  - 시점: 환자 정보·임상 소견에 초진 이후 날짜가 있는지
 *  - 추측 표현: 사실 섹션의 "~것으로 보인다" 등
 *  - 부재 문장: "기록되지 않았다" 류 (absenceFilter 와 같은 판정)
 *  - 처방명: 기록에 없는 처방명이 기록 처방명의 앞부분이면 (예: "반하후박탕" ↔ 기록 "반하후박탕합생맥산")
 *  - 이상반응 표현: 한 섹션은 [확인 필요]인데 다른 섹션은 "없었다"로 단정
 *  - 환자 관점: 임상의 기록(계획·처방·진찰)이 환자 말로 들어간 것 같은 문장
 *  - 남은 표시: [확인 필요], [문헌 보완 필요], [한자 확인], [기록 외 내용], 비식별 표기, (단위 미상)
 *  - 초안 단계에서 더한 답: 테스트 답이 섞였는지 사람이 볼 수 있게 목록
 */
import { StudyWriteState } from '../types/studyWrite';
import { CARE_SECTION_NAMES, CARE_SECTION_ORDER } from './careItems';
import { isAbsenceSentence } from './absenceFilter';
import { allQuestions } from './interview';

export type CheckSeverity = 'error' | 'warn' | 'info';

export interface ManuscriptFinding {
  id: string;
  sectionId: string;
  sectionName: string;
  kind: string;
  severity: CheckSeverity;
  message: string;
  /** 원고에서 문제가 된 부분 */
  excerpt?: string;
  /** 대조한 근거 (기록·답) */
  evidence?: string;
}

export interface RecordVisit {
  index: number;
  /** 첫 기록일 기준 일수 */
  day: number;
  text: string;
}

/** 기록 방문 (모델이 보는 비식별 기록과 같은 글) */
export function recordVisits(caseData: any): RecordVisit[] {
  const records: any[] = Array.isArray(caseData?.deidentifiedEMRs) ? caseData.deidentifiedEMRs : [];
  const visits: any[] = Array.isArray(caseData?.visits) ? caseData.visits : [];
  const firstMs = visits[0]?.date ? new Date(visits[0].date).getTime() : NaN;
  const count = Math.max(records.length, visits.length);
  const out: RecordVisit[] = [];
  for (let index = 0; index < count; index += 1) {
    const ms = visits[index]?.date ? new Date(visits[index].date).getTime() : NaN;
    out.push({
      index: index + 1,
      day: Number.isNaN(ms) || Number.isNaN(firstMs) ? NaN : Math.round((ms - firstMs) / 86400000),
      text: String(records[index]?.deidentifiedText || visits[index]?.soapText || '')
    });
  }
  return out;
}

/** 첩약 목록에서 "약재 숫자" 쌍. 괄호 안 쉼표 목록 "(생반하 9,복령 9,…)" */
export function recordHerbDoses(visits: RecordVisit[]): { herbs: Set<string>; pairs: Set<string>; hasUnitG: boolean } {
  const herbs = new Set<string>();
  const pairs = new Set<string>();
  let hasUnitG = false;
  for (const visit of visits) {
    for (const group of visit.text.replace(/\s*\n\s*/g, ' ').match(/\(([^()]*\d[^()]*)\)/g) || []) {
      for (const part of group.slice(1, -1).split(/[,，]/)) {
        const match = part.trim().match(/^([가-힣]{1,8})\s*([\d.]+)\s*(g|그램)?$/);
        if (!match) continue;
        herbs.add(match[1]);
        pairs.add(`${match[1]} ${Number(match[2])}`);
        if (match[3]) hasUnitG = true;
      }
    }
  }
  return { herbs, pairs, hasUnitG };
}

/** 기록에 나온 처방명 (○○탕·산·음·환, 합방 포함) */
const FORMULA = /[가-힣]{2,10}(?:탕|산|음|환)(?:합[가-힣]{2,10}(?:탕|산|음|환))?/g;
export function recordFormulaNames(visits: RecordVisit[]): Set<string> {
  const names = new Set<string>();
  for (const visit of visits) for (const name of visit.text.match(FORMULA) || []) names.add(name);
  return names;
}

function sentences(text: string): string[] {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function clip(text: string, max = 120): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const FACT_SECTIONS = new Set([
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES'
]);
const ABSENCE_SKIP = new Set(['INTRODUCTION', 'DISCUSSION_CONCLUSION', 'INFORMED_CONSENT', 'TIMELINE']);
const SPECULATION = /것으로\s*(?:보인다|보였다|추정된다|추정되었다|생각된다)|로\s*추정(?:된다|되었다)|듯하다|듯했다|듯하였다/;
const PATIENT_VOICE_CLINICIAN_CUES =
  /확인하고\s*싶|관찰하(?:기로|고자)|해\s*봄|해봄|방의|처방(?:을|하)|약재|가감|(?<!부정)맥(?:이|은|상|진)|설태|설진|혈압|이완기|안색|변증/;

export function checkManuscript(params: { caseData: any; state: StudyWriteState }): ManuscriptFinding[] {
  const { caseData, state } = params;
  const visits = recordVisits(caseData);
  const visitDays = new Set(visits.map((visit) => visit.day).filter((day) => !Number.isNaN(day)));
  // 초진: 내용이 있는 첫 방문 (첫 기록일에 기록이 비어 있는 프리셋이 있다)
  const firstContentVisit = visits.find(
    (visit) =>
      !/기재되어\s*있지\s*않|내용이\s*없/.test(visit.text) &&
      visit.text.replace(/\[[^\]]*\]|내원일\s*:.*|익명 진료기록.*/g, '').trim().length > 20
  );
  const firstDay = firstContentVisit ? firstContentVisit.day : 0;
  const { herbs, pairs, hasUnitG } = recordHerbDoses(visits);
  const formulas = recordFormulaNames(visits);
  const qaText = allQuestions(state)
    .map((question) => `${question.text} ${question.answer || ''}`)
    .join('\n');
  const findings: ManuscriptFinding[] = [];
  let seq = 0;
  const add = (finding: Omit<ManuscriptFinding, 'id' | 'sectionName'>) => {
    seq += 1;
    findings.push({ id: `mc-${seq}`, sectionName: CARE_SECTION_NAMES[finding.sectionId] || finding.sectionId, ...finding });
  };

  const sections = CARE_SECTION_ORDER.map((sectionId) => ({ sectionId, text: state.sections?.[sectionId]?.draftText || '' })).filter(
    (section) => section.text.trim()
  );

  for (const { sectionId, text } of sections) {
    // ---- 약재 용량 (기록에 첩약 목록이 있을 때)
    if (herbs.size > 0) {
      const herbAlt = [...herbs].sort((a, b) => b.length - a.length).map((herb) => herb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const doseRe = new RegExp(`(${herbAlt.join('|')})(?:을|를|은|는|이|가)?\\s*([\\d.]+)(\\s*g)?(?![\\d.])`, 'g');
      const reported = new Set<string>();
      for (const match of text.matchAll(doseRe)) {
        const [whole, herb, dose, unit] = match;
        const key = `${herb} ${Number(dose)}`;
        if (Number(dose) === 0) {
          add({ sectionId, kind: 'dose', severity: 'error', message: `양이 0인 약재 "${herb} 0"이 있습니다. 쓰기 규칙상 0인 약재는 뺍니다.`, excerpt: whole });
          continue;
        }
        if (!pairs.has(key) && !reported.has(key)) {
          reported.add(key);
          add({ sectionId, kind: 'dose', severity: 'error', message: `"${herb} ${dose}"이 기록 첩약에 없습니다. 용량을 기록과 대조해 주세요.`, excerpt: whole });
        }
        if (unit && !hasUnitG) {
          add({ sectionId, kind: 'unit', severity: 'warn', message: `기록 첩약에는 단위가 없는데 "${herb} ${dose} g"으로 단위를 붙였습니다. 쓰기 규칙상 숫자만 씁니다.`, excerpt: whole });
        }
      }
      for (const match of text.matchAll(/\(또는\s*0\)/g)) {
        add({ sectionId, kind: 'dose', severity: 'warn', message: '"(또는 0)" 표기가 있습니다. 넣고 뺀 약재는 따로 문장으로 씁니다.', excerpt: match[0] });
      }
    }

    // ---- 날짜: 범위가 아닌 한 시점의 "첫 기록일 +N일"
    if (visitDays.size > 0) {
      const dateRe = /(첫\s*기록일\s*)?\+(\d{1,4})일?(?:\s*[~∼-]\s*\+?\d{1,4}일?)?/g;
      for (const match of text.matchAll(dateRe)) {
        const isRange = /[~∼-]/.test(match[0]);
        const before = text.slice(Math.max(0, match.index! - 2), match.index!);
        const partOfRange = /[~∼-]\s*$/.test(before);
        const day = Number(match[2]);
        if (!isRange && !partOfRange && !visitDays.has(day)) {
          add({
            sectionId,
            kind: 'date',
            severity: 'warn',
            message: `첫 기록일 +${day}일은 기록의 방문일이 아닙니다. 날짜를 기록과 대조해 주세요.`,
            excerpt: clip(text.slice(Math.max(0, match.index! - 20), match.index! + match[0].length + 20), 80)
          });
        }
        // 시점: 환자 정보·임상 소견은 초진까지
        if ((sectionId === 'PATIENT_INFORMATION' || sectionId === 'CLINICAL_FINDINGS') && day > firstDay) {
          add({
            sectionId,
            kind: 'timing',
            severity: 'error',
            message: `초진(첫 기록일 +${firstDay}일) 이후인 +${day}일 내용이 있습니다. 이 섹션은 진료 시작 시점까지만 씁니다(경과는 추적 관찰로).`,
            excerpt: clip(text.slice(Math.max(0, match.index! - 30), match.index! + match[0].length + 30), 90)
          });
        }
      }
    }

    // ---- 처방명
    if (formulas.size > 0) {
      const seen = new Set<string>();
      for (const name of text.match(FORMULA) || []) {
        if (formulas.has(name) || seen.has(name)) continue;
        const longer = [...formulas].find((item) => item.startsWith(name) && item !== name);
        if (longer && !text.includes(longer)) {
          seen.add(name);
          add({ sectionId, kind: 'formula', severity: 'warn', message: `"${name}"은 기록에 없고, 기록의 처방명은 "${longer}"입니다.`, excerpt: name, evidence: longer });
        }
      }
    }

    for (const sentence of sentences(text)) {
      // ---- 추측 표현
      if (FACT_SECTIONS.has(sectionId) && SPECULATION.test(sentence) && !/고\s*하였다|라고|다고/.test(sentence)) {
        add({ sectionId, kind: 'speculation', severity: 'warn', message: '사실을 쓰는 섹션에 추측 표현이 있습니다. 기록에 있는 사실이면 단정해 쓰고, 없으면 뺍니다.', excerpt: clip(sentence) });
      }
      // ---- 부재 문장
      if (!ABSENCE_SKIP.has(sectionId) && !sentence.includes('[확인 필요') && isAbsenceSentence(sentence)) {
        add({ sectionId, kind: 'absence', severity: 'warn', message: '"기록되지 않았다" 류의 부재 문장입니다. 쓰기 규칙상 없는 정보는 쓰지 않습니다(이상반응 유무는 예외).', excerpt: clip(sentence) });
      }
      // ---- 환자 관점: 임상의 기록이 환자 말로
      if (sectionId === 'PATIENT_PERSPECTIVE' && PATIENT_VOICE_CLINICIAN_CUES.test(sentence)) {
        add({
          sectionId,
          kind: 'voice',
          severity: 'warn',
          message: '임상의의 기록(계획·처방·진찰 소견)이 환자의 말로 들어갔을 수 있습니다. 환자가 실제로 말한 것인지 확인해 주세요.',
          excerpt: clip(sentence)
        });
      }
    }

    // ---- 남은 표시
    const markers: Array<[RegExp, string]> = [
      [/\[확인 필요[^\]]*\]/g, '확인 필요'],
      [/\[문헌 보완 필요[^\]]*\]/g, '문헌 보완 필요'],
      [/\[한자 확인\]/g, '한자 확인'],
      [/\[기록 외 내용[^\]]*\]/g, '기록 외 내용'],
      [/\[[A-Z][A-Z_]*_\d+\]/g, '비식별 표기'],
      [/\(단위 미상\)/g, '단위 미상']
    ];
    for (const [re, label] of markers) {
      const hits = text.match(re) || [];
      if (hits.length > 0) {
        add({ sectionId, kind: 'marker', severity: 'info', message: `"${label}" 표시가 ${hits.length}곳 남아 있습니다. 제출 전에 채우거나 지웁니다.`, excerpt: clip(hits.slice(0, 3).join(' '), 140) });
      }
    }
  }

  // ---- 이상반응 표현이 섹션마다 다름
  const unsure = sections.filter((section) => /\[확인 필요[^\]]*이상반응/.test(section.text));
  if (unsure.length > 0) {
    for (const section of sections) {
      const definite = sentences(section.text).find(
        (sentence) => /이상반응|부작용/.test(sentence) && /(없었다|없다|기록되지 않|관찰되지 않|보고되지 않)/.test(sentence) && !sentence.includes('[확인 필요')
      );
      if (definite) {
        add({
          sectionId: section.sectionId,
          kind: 'consistency',
          severity: 'warn',
          message: `${unsure.map((item) => CARE_SECTION_NAMES[item.sectionId]).join(', ')}에서는 그 밖의 이상반응을 [확인 필요]로 두었는데, 여기서는 단정합니다.`,
          excerpt: clip(definite)
        });
      }
    }
  }

  // ---- 초안 단계에서 더한 답 (질문 받기·CARE 정보 입력)
  for (const question of allQuestions(state).filter((item) => item.source === 'care_check' && item.status === 'answered')) {
    add({
      sectionId: question.targetSectionIds[0] || 'THERAPEUTIC_INTERVENTIONS',
      kind: 'added_answer',
      severity: 'info',
      message: `초안 단계에서 더한 답입니다${question.chatEntryId ? '(수정 요청 · AI 질문)' : '(CARE 점검 · 정보 입력)'}. 테스트로 넣은 값이면 지웁니다.`,
      excerpt: clip(question.answer, 140),
      evidence: clip(question.text, 100)
    });
  }

  // 기록·답 어디에도 없는 숫자 근거는 모델 검사(다음 단계)에서 본다. 여기서는 qaText 를 쓰지 않는 검사만 한다.
  void qaText;
  const order: Record<CheckSeverity, number> = { error: 0, warn: 1, info: 2 };
  return findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || CARE_SECTION_ORDER.indexOf(a.sectionId as any) - CARE_SECTION_ORDER.indexOf(b.sectionId as any)
  );
}
