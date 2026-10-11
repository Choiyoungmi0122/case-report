/**
 * Scaffold CHAIN3 초안의 생성 뒤 거르기 (2026-10-12, SCAFFOLD-FILTER:v1).
 *
 * 프롬프트 규칙(v4 의 11 없는 내용 서술 금지, 12 표기 보존, 13 마무리 문장 금지)이 긴 기록에서 실행마다 지켜지지 않아
 * (docs/scaffold_prompt_improvement_phase1.md §10) 코드로 한 번 더 거른다. 원칙은 "확실한 것만 고치고, 애매한 것은 표시만".
 *
 * 고치는 것
 *  1. 무엇이 기록에 없는지 말하는 문장(…은 기록되어 있지 않다 / 기재·명시되어 있지 않다 / 기록에 나타나지 않는다,
 *     정보·언급·기록과 함께 쓴 "확인되지 않는다"). 문장 전체가 그 얘기면 뺀다. "~하였으며, ~은 기록되어 있지 않다"처럼
 *     앞에 사실 절이 있으면 사실 절만 남긴다("~하였다."). "특이 소견은 확인되지 않았다" 같은 기록된 음성 소견은 건드리지 않는다.
 *  2. "~된/한 기록이 있다" → "~되었다/하였다", "기록된 바와 같이" 삭제 (자료 설명 군말).
 *  3. 근거에 단위 없이 적힌 약재 양에 붙인 g ("생반하 9" → 초안 "생반하 9g")을 뗀다. 근거에 g 이 있으면 그대로 둔다.
 *  4. 용법 오기 "1회 3회" → "1일 3회".
 *  5. 마지막 문장이 "이상의/이러한/위와 같은 치료…반복·지속·조정·병행·적용되었다" 같은 요약이면 뺀다.
 * 표시만 하는 것(본문은 그대로)
 *  - 근거에 없는 숫자+단위 표기(날짜 제외), "기록되어 있다/기재되어 있다"처럼 사실과 섞인 자료 설명 문장.
 * 고치거나 표시한 내용은 초안의 postFilter 에 남긴다(연구 기록용).
 */

export const SCAFFOLD_DRAFT_FILTER_VERSION = 'SCAFFOLD-FILTER:v1';

export type ScaffoldDraftFilterReport = {
  version: string;
  removedSentences: string[];
  trimmedSentences: Array<{ before: string; after: string }>;
  rewrittenPhrases: Array<{ before: string; after: string }>;
  strippedUnits: string[];
  fixedTypos: Array<{ before: string; after: string }>;
  flaggedNumbers: string[];
  flaggedMetaSentences: string[];
};

type CardLike = { sourceText?: string; normalizedText?: string };

const ABSENCE_CORE =
  /(기록|기재|명시)(되어|돼)?\s*(있지|있진)\s*않|(기록|기재|명시)되지\s*않|기록에\s*(나타나지|없)|(기록|기재|명시)(된|한)\s*(바|것)(가|이)?\s*없/;
const CONFIRM_NEG = /확인(되지|할\s*수)\s*않|확인되지\s*않/;
const META_SUBJECT = /정보|언급|기록|기재|세부|명시/;

function isAbsenceText(text: string): boolean {
  return ABSENCE_CORE.test(text) || (CONFIRM_NEG.test(text) && META_SUBJECT.test(text));
}

/** "~하였으며, " 같은 연결 어미를 문장 끝으로 바꾼다. 바꿀 수 없으면 null. */
function closeClause(clause: string): string | null {
  const trimmed = clause.replace(/[,\s]+$/, '');
  const m = trimmed.match(/^(.*?)(었|았|였|졌|됐|했)(으며|고|으나|지만|는데)$/);
  if (m) return `${m[1]}${m[2]}다.`;
  const isMatch = trimmed.match(/^(.*?)(이)(며|고)$/);
  if (isMatch) return `${isMatch[1]}이다.`;
  const haveMatch = trimmed.match(/^(.*?)있(으며|고|으나|지만)$/);
  if (haveMatch) return `${haveMatch[1]}있다.`;
  return null;
}

/** 문장 하나에서 없는 내용 서술을 다룬다: 그대로 / 사실 절만 남김 / 통째로 뺌 */
function handleAbsence(sentence: string): { kind: 'keep' } | { kind: 'remove' } | { kind: 'trim'; text: string } {
  if (!isAbsenceText(sentence)) return { kind: 'keep' };
  // 가운데 끼인 경우: "…병행되었으며, 부위는 명확히 기재되어 있지 않으나 반복적으로 시행되었다."
  const middle = sentence.match(/^(.*?,\s*)([^,]*?(기록|기재|명시)(되어|돼)?\s*있지\s*않(으나|지만),?\s*)(.+)$/);
  if (middle && !isAbsenceText(middle[1]) && !isAbsenceText(middle[6])) {
    return { kind: 'trim', text: `${middle[1]}${middle[6]}`.replace(/\s{2,}/g, ' ') };
  }
  // 뒤에 붙은 경우: "…시행되었으며, 시술 부위나 시간 등은 기록되어 있지 않다."
  // 앞에서부터 연결 어미로 끝나는 사실 절의 끝을 찾는다(뒤쪽은 "기구, 시간, 부위 등은 …"처럼 쉼표가 여럿일 수 있다)
  const parts = sentence.split(/,\s+/);
  for (let i = 1; i < parts.length; i += 1) {
    const head = parts.slice(0, i).join(', ');
    const tail = parts.slice(i).join(', ');
    if (isAbsenceText(head)) break;
    const closed = closeClause(head);
    if (closed && isAbsenceText(tail)) return { kind: 'trim', text: closed };
  }
  return { kind: 'remove' };
}

const POSITIVE_META = /(기록|기재|명시)(되어|돼)\s*있|기록이\s*있|기록된\s*바|확인된다|확인되었다/;

function rewriteRecordPhrases(sentence: string, report: ScaffoldDraftFilterReport): string {
  let out = sentence;
  const rules: Array<[RegExp, (substring: string, ...args: any[]) => string]> = [
    [/([가-힣]+)된\s*기록이\s*있(다|으며|고|으나)/g, (_m, stem, ending) => `${stem}되었${ending === '다' ? '다' : ending}`],
    [/([가-힣]+)한\s*기록이\s*있(다|으며|고|으나)/g, (_m, stem, ending) => `${stem}하였${ending === '다' ? '다' : ending}`],
    [/기록된\s*바와\s*같이\s*/g, () => '']
  ];
  for (const [pattern, replacer] of rules) {
    out = out.replace(pattern, (...args: any[]) => {
      const before = args[0];
      const after = replacer(...(args as [string, ...any[]]));
      report.rewrittenPhrases.push({ before, after });
      return after;
    });
  }
  return out;
}

function fixTypos(sentence: string, report: ScaffoldDraftFilterReport): string {
  return sentence.replace(/(^|[\s(,])1회\s*([2-9])회/g, (match, lead, n) => {
    const after = `${lead}1일 ${n}회`;
    report.fixedTypos.push({ before: match.trim(), after: after.trim() });
    return after;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAddedGrams(sentence: string, evidence: string, report: ScaffoldDraftFilterReport): string {
  return sentence.replace(/([가-힣]{1,10})\s*(\d+(?:\.\d+)?)\s*g(?![a-zA-Z])/g, (match, name, num) => {
    const withUnit = new RegExp(`${escapeRegExp(name)}\\s*${escapeRegExp(num)}\\s*g(?![a-zA-Z])`);
    const withoutUnit = new RegExp(`${escapeRegExp(name)}\\s*${escapeRegExp(num)}(?![\\d.]|\\s*(g|mg|kg|ml|cc))`);
    if (!withUnit.test(evidence) && withoutUnit.test(evidence)) {
      report.strippedUnits.push(match);
      return match.replace(/\s*g$/, '');
    }
    return match;
  });
}

const CLOSING = /^(이상의|이러한|위와\s*같은|이와\s*같은|이상과\s*같은)\s*[^.]*?(치료|처치|시술)[^.]*(반복|지속|조정|병행|적용)[^.]*(되었|하였)다\.?$/;

const DATE_LIKE = /\d{4}-\d{1,2}-\d{1,2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일|\d{1,2}\s*\/\s*\d{1,2}/g;
const DETAIL_TOKEN = /\d+(?:\.\d+)?\s*(?:mg|g|cc|ml|mL|포|분|mm|정|캡슐|cap|%)/g;

function detailTokens(text: string): Set<string> {
  return new Set(
    (String(text || '').replace(DATE_LIKE, ' ').match(DETAIL_TOKEN) || []).map((token) => token.replace(/\s+/g, '').toLowerCase())
  );
}

function splitSentences(paragraph: string): string[] {
  return paragraph.split(/(?<=\.)\s+/).filter((sentence) => sentence.trim());
}

export function filterScaffoldDraftText(text: string, evidenceCards: CardLike[]): { text: string; report: ScaffoldDraftFilterReport } {
  const report: ScaffoldDraftFilterReport = {
    version: SCAFFOLD_DRAFT_FILTER_VERSION,
    removedSentences: [],
    trimmedSentences: [],
    rewrittenPhrases: [],
    strippedUnits: [],
    fixedTypos: [],
    flaggedNumbers: [],
    flaggedMetaSentences: []
  };
  const evidence = evidenceCards.map((card) => `${card.sourceText || ''}\n${card.normalizedText || ''}`).join('\n');
  const paragraphs = String(text || '').split(/\n\s*\n/);
  const outParagraphs: string[][] = [];

  for (const paragraph of paragraphs) {
    const kept: string[] = [];
    for (const raw of splitSentences(paragraph.trim())) {
      const absence = handleAbsence(raw);
      if (absence.kind === 'remove') {
        report.removedSentences.push(raw);
        continue;
      }
      let sentence = raw;
      if (absence.kind === 'trim') {
        report.trimmedSentences.push({ before: raw, after: absence.text });
        sentence = absence.text;
      }
      sentence = rewriteRecordPhrases(sentence, report);
      sentence = fixTypos(sentence, report);
      sentence = stripAddedGrams(sentence, evidence, report);
      if (POSITIVE_META.test(sentence)) report.flaggedMetaSentences.push(sentence);
      kept.push(sentence);
    }
    outParagraphs.push(kept);
  }

  // 마지막 문장의 요약·일반화
  for (let p = outParagraphs.length - 1; p >= 0; p -= 1) {
    const list = outParagraphs[p];
    if (list.length === 0) continue;
    const last = list[list.length - 1];
    if (CLOSING.test(last.trim())) {
      report.removedSentences.push(last);
      list.pop();
    }
    break;
  }

  const outText = outParagraphs
    .map((list) => list.join(' '))
    .filter((paragraph) => paragraph.trim())
    .join('\n\n');

  const evidenceTokens = detailTokens(evidence);
  report.flaggedNumbers = [...detailTokens(outText)].filter((token) => !evidenceTokens.has(token));
  return { text: outText, report };
}

export function isFilterReportEmpty(report: ScaffoldDraftFilterReport): boolean {
  return (
    report.removedSentences.length === 0 &&
    report.trimmedSentences.length === 0 &&
    report.rewrittenPhrases.length === 0 &&
    report.strippedUnits.length === 0 &&
    report.fixedTypos.length === 0 &&
    report.flaggedNumbers.length === 0 &&
    report.flaggedMetaSentences.length === 0
  );
}
