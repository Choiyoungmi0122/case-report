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
    createdAt: { type: Date, required: true, default: Date.now },
    title: { type: String, default: null },
    visits: { type: Array, required: true },
    processingCache: { type: Object, default: null },
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
    finalDraft: { type: Object, default: null }
  },
  {
    collection: 'cases'
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

SectionInteractionSchema.index({ caseId: 1, sectionId: 1 }, { unique: true });

export const CaseModel = mongoose.model('Case', CaseSchema);
export const SectionInteractionModel = mongoose.model('SectionInteraction', SectionInteractionSchema);

export async function initDatabase(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI);
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
