const HYPHEN_VARIANTS_REGEX = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE58\uFE63\uFF0D]/g;
const NBSP_REGEX = /[\u00A0\u2007\u202F]/g;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;

export function normalizeUnicodeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(HYPHEN_VARIANTS_REGEX, '-')
    .replace(NBSP_REGEX, ' ')
    .replace(ZERO_WIDTH_REGEX, '')
    .normalize('NFC');
}

export function normalizeUnicodeWhitespace(value: unknown): string {
  return normalizeUnicodeText(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildContentDispositionHeader(fileName: string): string {
  const normalized = normalizeUnicodeText(fileName).trim() || 'download';
  const asciiFallback = normalized
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  // RFC 5987 keeps these out of the token, and encodeURIComponent leaves them untouched.
  const encoded = encodeURIComponent(normalized).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
