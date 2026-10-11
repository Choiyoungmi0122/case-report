/**
 * 제목 섹션 초안("제목 한 줄 + 핵심 단어: …" 줄)을 제목과 핵심 단어로 나누고 다시 합친다.
 * 제목·핵심 단어를 따로 다시 만들거나 직접 고칠 때 쓴다(사용자 요청 2026-10-12).
 * backend/src/studyWrite/titleKeywords.ts 와 같은 코드다. 한쪽을 고치면 다른 쪽도 고친다.
 */

export type TitlePart = 'title' | 'keywords';

export interface ParsedTitleDraft {
  lines: string[];
  /** 제목 줄 번호 (없으면 -1) */
  titleIndex: number;
  title: string;
  /** 핵심 단어 줄 번호 (없으면 -1) */
  keywordsIndex: number;
  keywords: string[];
}

const KEYWORDS_LINE = /^\s*(?:핵심\s*단어|주제어|키워드|key\s*words?)\s*[:：]\s*(.*)$/i;
const TITLE_LABEL = /^\s*(?:제목|title)\s*[:：]\s*/i;

export function splitKeywords(raw: string): string[] {
  return String(raw || '')
    .split(/[,，;；]/)
    .map((item) => item.trim().replace(/[.。]$/, '').trim())
    .filter(Boolean);
}

export function parseTitleDraft(text: string): ParsedTitleDraft {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let keywordsIndex = -1;
  let keywords: string[] = [];
  let titleIndex = -1;
  let title = '';
  lines.forEach((line, index) => {
    const match = line.match(KEYWORDS_LINE);
    if (match && keywordsIndex < 0) {
      keywordsIndex = index;
      keywords = splitKeywords(match[1]);
      return;
    }
    if (titleIndex < 0 && line.trim() && !match) {
      titleIndex = index;
      title = line.replace(TITLE_LABEL, '').trim();
    }
  });
  return { lines, titleIndex, title, keywordsIndex, keywords };
}

export function formatKeywordsLine(keywords: string[]): string {
  return `핵심 단어: ${keywords.map((item) => item.trim()).filter(Boolean).join(', ')}`;
}

/** 제목이나 핵심 단어만 바꿔 다시 합친다. 다른 줄은 글자 그대로 둔다 */
export function composeTitleDraft(parsed: ParsedTitleDraft, next: { title?: string; keywords?: string[] }): string {
  const lines = [...parsed.lines];
  if (next.title !== undefined) {
    const title = next.title.replace(/\s*\n\s*/g, ' ').trim();
    if (parsed.titleIndex >= 0) lines[parsed.titleIndex] = title;
    else lines.unshift(title);
  }
  // 제목 줄을 앞에 넣었으면 핵심 단어 줄 번호가 하나 밀린다
  const shift = next.title !== undefined && parsed.titleIndex < 0 ? 1 : 0;
  if (next.keywords !== undefined) {
    const line = formatKeywordsLine(next.keywords);
    if (parsed.keywordsIndex >= 0) lines[parsed.keywordsIndex + shift] = line;
    else lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 다시 만든 초안에서 바꾸려던 부분만 가져와, 원래 초안의 나머지와 합친다 */
export function mergeRegeneratedPart(originalText: string, regeneratedText: string, part: TitlePart): string {
  const original = parseTitleDraft(originalText);
  const regenerated = parseTitleDraft(regeneratedText);
  if (part === 'title') {
    return regenerated.title ? composeTitleDraft(original, { title: regenerated.title }) : originalText;
  }
  return regenerated.keywords.length > 0 ? composeTitleDraft(original, { keywords: regenerated.keywords }) : originalText;
}
