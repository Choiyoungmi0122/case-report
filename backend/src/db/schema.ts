import mongoose from 'mongoose';
import dotenv from 'dotenv';

// .env 파일 로드 (이미 로드되었을 수도 있지만 안전을 위해)
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/care';

if (!process.env.MONGODB_URI) {
  console.warn('⚠️  MONGODB_URI 환경 변수가 설정되지 않았습니다. 기본값(localhost)을 사용합니다.');
} else {
  console.log('✅ MONGODB_URI 환경 변수를 찾았습니다.');
}

// Case Schema
const CaseSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true, default: Date.now },
    title: { type: String, default: null },
    // visits: Chain 0 결과 (현재는 raw 텍스트, 추후 sanitizedText로 확장 가능)
    visits: { type: Array, required: true },
    // 기존 체인(A/B/C)용 필드 (호환성 유지)
    sectionEvidenceMap: { type: Object, default: {} },
    sectionStatusMap: { type: Object, default: {} },
    draftsBySection: { type: Object, default: {} },
    // 새 체인용 필드
    evidenceCards: { type: Array, default: [] },      // Chain 1
    sectionStates: { type: Array, default: [] },      // Chain 2
    sectionDrafts: { type: Array, default: [] },      // Chain 3/4
    finalDraft: { type: Object, default: null },      // Chain 5
    aiPipeline: { type: Object, default: null }       // ai_server Chain1~7 결과
  },
  {
    collection: 'cases'
  }
);

// Section Interaction Schema
const SectionInteractionSchema = new mongoose.Schema({
  caseId: { type: String, required: true },
  sectionId: { type: String, required: true },
  qnaHistory: { type: Array, required: true, default: [] }
}, {
  collection: 'section_interactions'
});

// Indexes for better query performance
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
