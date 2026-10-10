import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/care';

if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI environment variable is not set. Falling back to localhost.');
} else {
  console.log('Using configured MONGODB_URI');
}

const CaseSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    experiment_code: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
    mode: {
      type: String,
      enum: ['write', 'scaffold'],
      default: 'write',
      required: true
    },
    title: { type: String, default: null },
    studyMetadata: { type: Object, default: null },
    versionMetadata: { type: Object, default: null },
    caseInputValidation: { type: Object, default: null },
    sessionOutcome: { type: Object, default: null },
    researcherAssistance: { type: Array, default: [] },
    technicalIssues: { type: Array, default: [] },
    visits: { type: Array, required: true },
    timelineEvents: { type: Array, default: [] },
    deidentifiedEMRs: { type: Array, default: [] },
    pendingTermConfirmations: { type: Array, default: [] },
    reviewRequired: { type: Object, default: null },
    staleState: { type: Object, default: null },
    processingCache: { type: Object, default: null },
    chainCache: { type: Object, default: {} },
    chainProgress: { type: Object, default: null },
    chainPerformanceLogs: { type: Array, default: [] },
    exportLogs: { type: Array, default: [] },
    finalComposeStatus: { type: Object, default: null },
    sectionEvidenceMap: { type: Object, default: {} },
    sectionStatusMap: { type: Object, default: {} },
    draftsBySection: { type: Object, default: {} },
    evidenceCards: { type: Array, default: [] },
    sectionStates: { type: Array, default: [] },
    commonMissingItems: { type: Array, default: [] },
    commonQuestionSets: { type: Array, default: [] },
    answerUndoStack: { type: Array, default: [] },
    sectionDrafts: { type: Array, default: [] },
    sectionAdequacyReviews: { type: Object, default: {} },
    scaffoldState: { type: Object, default: null },
    // 실험용 Write 상태 (질의응답, 제출). Scaffold 상태와 별개.
    studyWrite: { type: Object, default: null },
    researchState: { type: Object, default: null },
    studyConfig: { type: Object, default: null },
    finalDraft: { type: Object, default: null }
  },
  {
    collection: 'cases'
  }
);

const ExperimentCounterSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: ['write', 'scaffold'], unique: true },
    lastNumber: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: Date.now }
  },
  {
    collection: 'experiment_counters'
  }
);

const SectionInteractionSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true },
    sectionId: { type: String, required: true },
    qnaHistory: { type: Array, required: true, default: [] }
  },
  {
    collection: 'section_interactions'
  }
);

const ManuscriptReviewSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
    sourceType: { type: String, required: true },
    fileName: { type: String, required: true },
    parseStatus: { type: String, required: true },
    rawText: { type: String, required: true },
    rawHtml: { type: String, default: '' },
    blocks: { type: Array, default: [] },
    sectionCandidates: { type: Array, default: [] },
    sectionTextsBySection: { type: Object, default: {} },
    reviewResults: { type: Object, default: null },
    manualConfirmationRequired: { type: Boolean, default: false },
    errorMessage: { type: String, default: null }
  },
  {
    collection: 'manuscript_reviews'
  }
);

CaseSchema.index(
  { experiment_code: 1 },
  {
    unique: true,
    partialFilterExpression: { experiment_code: { $type: 'string' } }
  }
);
SectionInteractionSchema.index({ caseId: 1, sectionId: 1 }, { unique: true });

export const CaseModel = mongoose.model('Case', CaseSchema);
export const ExperimentCounterModel = mongoose.model('ExperimentCounter', ExperimentCounterSchema);
export const SectionInteractionModel = mongoose.model('SectionInteraction', SectionInteractionSchema);
export const ManuscriptReviewModel = mongoose.model('ManuscriptReview', ManuscriptReviewSchema);

// 실험용 Write 의 표·그림 첨부. 파일 하나가 문서 하나 (그림 5MB 이하).
const StudyWriteAttachmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    caseId: { type: String, required: true, index: true },
    sectionId: { type: String, required: true },
    kind: { type: String, required: true, enum: ['image', 'table'] },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    caption: { type: String, default: '' },
    /** 그림: 원본 바이트. 표: 쓰지 않음 */
    data: { type: Buffer, default: null },
    /** 표: xlsx 첫 시트를 문자열 행렬로 */
    tableRows: { type: Array, default: null },
    size: { type: Number, default: 0 },
    createdAt: { type: Date, required: true, default: Date.now }
  },
  { collection: 'study_write_attachments' }
);

export const StudyWriteAttachmentModel = mongoose.model('StudyWriteAttachment', StudyWriteAttachmentSchema);

function formatExperimentCode(mode: 'write' | 'scaffold', number: number): string {
  const prefix = mode === 'scaffold' ? 'SQ' : 'EQ';
  return `${prefix}${String(number).padStart(3, '0')}`;
}

function parseExperimentNumber(code: unknown, mode: 'write' | 'scaffold'): number {
  const prefix = mode === 'scaffold' ? 'SQ' : 'EQ';
  const match = String(code || '').match(new RegExp(`^${prefix}(\\d+)$`));
  return match ? Number(match[1]) : 0;
}

async function migrateExperimentCodesForMode(mode: 'write' | 'scaffold'): Promise<void> {
  const modeFilter = mode === 'write' ? { $or: [{ mode: 'write' }, { mode: { $exists: false } }] } : { mode };
  const existingCases = await CaseModel.find(modeFilter).sort({ createdAt: 1, id: 1 }).exec();
  const lastNumber = existingCases.reduce(
    (max, doc) => Math.max(max, parseExperimentNumber((doc as any).experiment_code, mode)),
    0
  );

  await ExperimentCounterModel.findOneAndUpdate(
    { type: mode },
    { $max: { lastNumber }, $set: { updatedAt: new Date() } },
    { upsert: true, new: true }
  ).exec();

  for (const doc of existingCases) {
    if ((doc as any).experiment_code) continue;

    const experimentCode = await reserveExperimentCode(mode);
    await CaseModel.updateOne(
      {
        _id: doc._id,
        $or: [{ experiment_code: { $exists: false } }, { experiment_code: null }, { experiment_code: '' }]
      },
      { $set: { experiment_code: experimentCode } }
    ).exec();
  }
}

export async function reserveExperimentCode(mode: 'write' | 'scaffold'): Promise<string> {
  const counter = await ExperimentCounterModel.findOneAndUpdate(
    { type: mode },
    {
      $inc: { lastNumber: 1 },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();

  if (!counter) {
    throw new Error('Failed to reserve experiment code.');
  }

  return formatExperimentCode(mode, counter.lastNumber);
}

export async function advanceExperimentCounterForCode(
  mode: 'write' | 'scaffold',
  experimentCode: string
): Promise<void> {
  const number = parseExperimentNumber(experimentCode, mode);
  if (number <= 0) return;

  await ExperimentCounterModel.findOneAndUpdate(
    { type: mode },
    {
      $max: { lastNumber: number },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

async function migrateExperimentCodes(): Promise<void> {
  await migrateExperimentCodesForMode('write');
  await migrateExperimentCodesForMode('scaffold');
  await CaseModel.syncIndexes();
  await ExperimentCounterModel.syncIndexes();
}

export async function initDatabase(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI);
    await migrateExperimentCodes();
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function getDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  await initDatabase();
  return mongoose;
}
