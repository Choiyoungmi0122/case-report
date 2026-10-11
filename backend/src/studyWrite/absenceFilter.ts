/**
 * 초안에서 "기록·언급·정보가 없다"는 부재 문장을 걸러낸다.
 *
 * 국내 한의 증례보고는 기록에 없는 항목을 그냥 쓰지 않는다. 모델은 "~는 기록되지 않았다",
 * "~에 대한 언급은 확인되지 않는다"를 지시에도 불구하고 계속 쓰므로 최초 초안(SW-D)에서만 코드로
 * 걸러내고, 걸러낸 문장은 notes 로 알린다 (사용자 결정 2026-10-12).
 *
 * 남기는 문장: 검사·진찰의 음성 소견("이상 소견은 없었다"), 환자가 말한 내용("~라고 하였다"),
 * 이상반응 문장, "[확인 필요 …]" 표시가 있는 문장. 타임라인 표의 행(| 가 있는 줄)은 건드리지 않는다.
 * 한 문장 안에 소견과 부재가 함께 있으면("입마름은 없었고, … 기록은 없었다") 부재 절만 뺀다.
 */

const ABSENCE_SUBJECT = /(기록|언급|정보|내용|자료)/;
const ABSENCE_PREDICATE = /(없(?:다|었다|으며|고|는|음|으나)|않(?:다|는다|았다|으며|고|음|으나|아)|나타나지\s*않|남아\s*있지\s*않|확인할\s*수\s*없)/;
// "~지 않았다고 기록되었다"처럼 기록된 소견을 전하는 문장은 부재 문장이 아니다
const KEEP = /(\[확인 필요|이상반응|부작용|라고|다고\s*(?:하였|했|진술|말|답|호소|기록|관찰)|진술하였|호소하였|답하였|기록되었다|기록하였다|기록됐다)/;

export function isAbsenceSentence(sentence: string): boolean {
  const s = sentence.replace(/첫\s*기록일/g, '').trim();
  if (!s) return false;
  if (KEEP.test(s)) return false;
  return ABSENCE_SUBJECT.test(s) && ABSENCE_PREDICATE.test(s);
}

/** 연결 어미(~고, ~며)로 이은 절을 끝맺는 꼴로 바꾼다: "없었고" → "없었다.", "하였으며" → "하였다." */
function closeClause(clause: string): string {
  const c = clause.trim().replace(/[,\s]+$/, '');
  if (/으며$/.test(c)) return `${c.slice(0, -2)}다.`;
  if (/[며고]$/.test(c)) return `${c.slice(0, -1)}다.`;
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

/** 한 문장 안에서 부재 절만 뺀다. 남길 절이 없으면 null */
function dropAbsenceClauses(sentence: string, removed: string[]): string | null {
  if (!isAbsenceSentence(sentence)) return sentence;
  const clauses = sentence.split(/(?<=(?:고|며|나)),\s+/);
  if (clauses.length === 1) {
    removed.push(sentence.trim());
    return null;
  }
  const kept: string[] = [];
  clauses.forEach((clause) => {
    if (isAbsenceSentence(clause)) removed.push(clause.trim());
    else kept.push(clause);
  });
  if (kept.length === 0) return null;
  if (kept.length === clauses.length) {
    // 절로 나눠도 어느 절이 부재인지 못 가르면 문장째 뺀다
    removed.push(sentence.trim());
    return null;
  }
  const last = kept.length - 1;
  if (kept[last] !== clauses[clauses.length - 1]) kept[last] = closeClause(kept[last]);
  return kept.join(', ');
}

export function dropAbsenceSentences(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = String(text || '').split('\n').map((line) => {
    if (line.includes('|') || !line.trim()) return line;
    const sentences = line.split(/(?<=[.!?])\s+/);
    return sentences
      .map((sentence) => dropAbsenceClauses(sentence, removed))
      .filter((sentence): sentence is string => sentence !== null)
      .join(' ');
  });
  // 문장을 지워 빈 문단이 생기면 정리한다
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, removed };
}
