import { terminologyEntries } from '../rag/loader';

/**
 * 처방명·변증명의 한자 병기를 용어 사전에서 가져온다.
 *
 * 사전(backend/data/terminology/terminology.json)의 herbal_prescription·변증 항목은 aliases 에 한자를
 * 둔다(예: 황련온담탕 → 黃連溫膽湯). 모델이 기억으로 붙인 한자는 가끔 틀리므로(湯 누락 등), 사전에
 * 있는 용어는 프롬프트에 목록으로 주고, 결과물에서도 그 한자로 맞춘다. 사전에 없는 용어만
 * "[한자 확인]" 표시가 남는다 (사용자 결정 2026-10-11).
 */

const CJK = /[一-鿿]/;
const HANJA_MARK = '[한자 확인]';

let cache: Map<string, string> | null = null;

/** 표준 용어(한글) → 한자. 긴 용어부터 처리되도록 길이 내림차순으로 정렬해 돌려준다. */
export function getHanjaGlossary(): Map<string, string> {
  if (cache) return cache;
  const pairs: Array<[string, string]> = [];
  for (const entry of terminologyEntries) {
    if (CJK.test(entry.standardTerm)) continue;
    const hanja = (entry.aliases || []).find((alias) => CJK.test(alias) && !/[가-힣]/.test(alias));
    if (hanja) pairs.push([entry.standardTerm, hanja.trim()]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  cache = new Map(pairs);
  return cache;
}

/** 주어진 글들에 나오는 용어만 추린다. */
export function glossaryForTexts(texts: string[]): Map<string, string> {
  const joined = texts.filter(Boolean).join('\n');
  const found = new Map<string, string>();
  for (const [term, hanja] of getHanjaGlossary()) {
    if (joined.includes(term)) found.set(term, hanja);
  }
  return found;
}

export function formatHanjaGlossary(glossary: Map<string, string>): string {
  return [...glossary.entries()].map(([term, hanja]) => `- ${term} = ${hanja}`).join('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 결과물의 한자 병기를 사전에 맞춘다.
 * - "용어(아무 한자)[한자 확인]", "용어[한자 확인]" → "용어(사전 한자)"
 * - 용어가 처음 나오는 자리에 한자가 없으면 "(사전 한자)"를 붙인다 (그 뒤는 손대지 않는다)
 */
export function applyHanjaGlossary(text: string, glossary: Map<string, string>): string {
  let result = String(text || '');
  for (const [term, hanja] of glossary) {
    if (!result.includes(term)) continue;
    const t = escapeRegExp(term);
    const mark = escapeRegExp(HANJA_MARK);
    // 표시가 붙은 자리는 사전 한자로 바꾼다
    result = result.replace(new RegExp(`${t}\\(([^()]*)\\)\\s*${mark}`, 'g'), `${term}(${hanja})`);
    result = result.replace(new RegExp(`${t}\\s*${mark}`, 'g'), `${term}(${hanja})`);
    // 이미 사전 한자가 있으면 끝. 없으면 첫 등장에 붙인다 (뒤에 괄호가 바로 이어지면 그대로 둔다)
    if (result.includes(`${term}(${hanja})`)) continue;
    // 더 긴 용어의 일부("가미사물탕" 속 "사물탕")가 아닌 첫 등장을 찾는다
    let first = -1;
    for (let at = result.indexOf(term); at >= 0; at = result.indexOf(term, at + 1)) {
      const before = at > 0 ? result[at - 1] : '';
      if (!/[가-힣]/.test(before)) {
        first = at;
        break;
      }
    }
    if (first < 0) continue;
    const after = result.slice(first + term.length);
    if (after.startsWith('(')) continue;
    result = `${result.slice(0, first + term.length)}(${hanja})${after}`;
  }
  return result;
}
