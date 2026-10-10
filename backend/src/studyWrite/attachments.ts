import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { StudyWriteAttachmentModel } from '../db/schema';
import { normalizeUnicodeWhitespace } from '../utils/unicode';

/**
 * 실험용 Write 의 표·그림 첨부. 그림은 바이트 그대로, 표는 xlsx 첫 시트를 문자열 행렬로
 * 저장한다. Word 내보내기(4단계)에서 섹션 본문 아래에 "표 n. 제목" / "그림 n. 제목"으로 들어간다.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLS = 20;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);

export interface AttachmentSummary {
  id: string;
  caseId: string;
  sectionId: string;
  kind: 'image' | 'table';
  fileName: string;
  mimeType: string;
  caption: string;
  size: number;
  tableRows?: string[][] | null;
  createdAt: string;
}

function toSummary(doc: any): AttachmentSummary {
  return {
    id: doc.id,
    caseId: doc.caseId,
    sectionId: doc.sectionId,
    kind: doc.kind,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    caption: doc.caption || '',
    size: doc.size || 0,
    tableRows: doc.kind === 'table' ? doc.tableRows || [] : undefined,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt || '')
  };
}

export function parseTableWorkbook(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const name = workbook.SheetNames[0];
  if (!name) throw new Error('엑셀 파일에 시트가 없습니다.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', raw: false });
  const rows = matrix
    .map((row) => (row || []).slice(0, MAX_TABLE_COLS).map((cell) => normalizeUnicodeWhitespace(cell)))
    .filter((row) => row.some((cell) => cell !== ''));
  if (rows.length === 0) throw new Error('표에 내용이 없습니다.');
  return rows.slice(0, MAX_TABLE_ROWS);
}

export async function createAttachment(params: {
  caseId: string;
  sectionId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  caption?: string;
}): Promise<AttachmentSummary> {
  const lowerName = params.fileName.toLowerCase();
  const isImage = IMAGE_TYPES.has(params.mimeType) || /\.(png|jpe?g)$/.test(lowerName);
  const isTable = /\.xlsx$/.test(lowerName);
  if (!isImage && !isTable) throw new Error('그림은 png·jpg, 표는 xlsx 파일만 올릴 수 있습니다.');
  if (isImage && params.buffer.length > MAX_IMAGE_BYTES) throw new Error('그림은 5MB 이하만 올릴 수 있습니다.');

  const doc = await StudyWriteAttachmentModel.create({
    id: `swa-${randomUUID()}`,
    caseId: params.caseId,
    sectionId: params.sectionId,
    kind: isImage ? 'image' : 'table',
    fileName: params.fileName,
    mimeType: isImage ? (IMAGE_TYPES.has(params.mimeType) ? params.mimeType : lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg') : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    caption: (params.caption || '').trim(),
    data: isImage ? params.buffer : null,
    tableRows: isTable ? parseTableWorkbook(params.buffer) : null,
    size: params.buffer.length
  });
  return toSummary(doc);
}

export async function listAttachments(caseId: string): Promise<AttachmentSummary[]> {
  const docs = await StudyWriteAttachmentModel.find({ caseId }).select('-data').sort({ createdAt: 1 }).lean().exec();
  return docs.map(toSummary);
}

export async function getAttachmentFile(caseId: string, id: string): Promise<{ mimeType: string; data: Buffer; fileName: string } | null> {
  const doc: any = await StudyWriteAttachmentModel.findOne({ caseId, id }).lean().exec();
  if (!doc || !doc.data) return null;
  const data = Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer || doc.data);
  return { mimeType: doc.mimeType, data, fileName: doc.fileName };
}

export async function updateAttachmentCaption(caseId: string, id: string, caption: string): Promise<AttachmentSummary | null> {
  const doc = await StudyWriteAttachmentModel.findOneAndUpdate({ caseId, id }, { $set: { caption: caption.trim() } }, { new: true })
    .select('-data')
    .lean()
    .exec();
  return doc ? toSummary(doc) : null;
}

export async function deleteAttachment(caseId: string, id: string): Promise<boolean> {
  const result = await StudyWriteAttachmentModel.deleteOne({ caseId, id }).exec();
  return result.deletedCount > 0;
}
