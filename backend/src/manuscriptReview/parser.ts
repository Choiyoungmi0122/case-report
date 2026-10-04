import mammoth from 'mammoth';
import { ImportedDocumentBlock } from './types';
import { normalizeUnicodeText, normalizeUnicodeWhitespace } from '../utils/unicode';

function decodeHtmlEntities(text: string): string {
  return normalizeUnicodeText(
    text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function normalizeWhitespace(text: string): string {
  return normalizeUnicodeWhitespace(decodeHtmlEntities(text));
}

function stripHtml(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|ul|ol|h1|h2|h3|h4|h5|h6)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

function headingLevelFromType(type: string): number | undefined {
  const match = type.match(/^h([1-6])$/i);
  return match ? Number(match[1]) : undefined;
}

function shouldPromoteToHeading(text: string): boolean {
  if (!text || text.length > 90) return false;
  return /^(keywords?|key words|abstract|introduction|discussion|conclusion|patient perspective|informed consent|title|case presentation|timeline|diagnosis|diagnostic|follow[- ]?up|outcome|results?|서론|초록|요약|키워드|주요어|환자 정보|임상 소견|타임라인|진단|진단 평가|치료|중재|추적|경과|고찰|논의|결론|동의)/i.test(
    text.trim()
  );
}

function fallbackBlocksFromRawText(rawText: string): ImportedDocumentBlock[] {
  const segments = normalizeWhitespace(rawText)
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.map((segment, index) => {
    const asHeading = shouldPromoteToHeading(segment);
    return {
      blockId: `block_${index + 1}`,
      blockType: asHeading ? 'heading' : 'paragraph',
      headingLevel: asHeading ? 2 : undefined,
      text: segment,
      order: index
    };
  });
}

function parseHtmlBlocks(html: string, rawText: string): ImportedDocumentBlock[] {
  const blocks: ImportedDocumentBlock[] = [];
  const regex = /<(h[1-6]|p|table)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null = null;
  let order = 0;

  while ((match = regex.exec(html)) !== null) {
    const type = match[1].toLowerCase();
    const innerHtml = match[2] || '';
    const text = stripHtml(innerHtml);
    if (!text) continue;

    blocks.push({
      blockId: `block_${order + 1}`,
      blockType: type === 'table' ? 'table' : type.startsWith('h') ? 'heading' : 'paragraph',
      headingLevel: headingLevelFromType(type),
      text,
      order
    });
    order += 1;
  }

  if (blocks.length === 0) {
    return fallbackBlocksFromRawText(rawText);
  }

  return blocks.map((block) => {
    if (block.blockType !== 'paragraph' || !shouldPromoteToHeading(block.text)) {
      return block;
    }

    return {
      ...block,
      blockType: 'heading',
      headingLevel: block.headingLevel || 2
    };
  });
}

export async function extractDocxContent(buffer: Buffer): Promise<{
  rawText: string;
  rawHtml: string;
  blocks: ImportedDocumentBlock[];
}> {
  const [rawTextResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer })
  ]);

  const rawText = normalizeWhitespace(rawTextResult.value || '');
  const rawHtml = normalizeUnicodeText(htmlResult.value || '');
  const blocks = parseHtmlBlocks(rawHtml, rawText);

  return {
    rawText,
    rawHtml,
    blocks
  };
}
