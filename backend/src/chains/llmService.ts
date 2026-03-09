import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';
import {
  SectionEvidenceMappingSchema,
  SectionStatusAssessmentSchema,
  DraftGenerationSchema,
  NextQuestionSchema,
  DraftUpdateSchema
} from './schemas';
import {
  getMockEvidenceMapping,
  getMockStatusAssessment,
  getMockDraftGeneration,
  getMockNextQuestion,
  getMockDraftUpdate
} from './mockData';

// .env 파일 로드 (이미 로드되었을 수도 있지만 안전을 위해)
dotenv.config();

const USE_MOCK = process.env.USE_MOCK === 'true' || !process.env.OPENAI_API_KEY;

// Mock 모드 상태 로깅
if (USE_MOCK) {
  if (process.env.USE_MOCK === 'true') {
    console.log('🔧 [MOCK MODE] USE_MOCK=true로 설정되어 Mock 모드를 사용합니다.');
  } else if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  [MOCK MODE] OPENAI_API_KEY가 설정되지 않아 Mock 모드를 사용합니다.');
    console.log('   실제 LLM을 사용하려면 .env 파일에 OPENAI_API_KEY를 설정하세요.');
  }
} else {
  console.log('✅ [LLM MODE] OpenAI API를 사용합니다.');
}

const openai = USE_MOCK ? null : new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MAX_RETRIES = 2;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4-turbo-preview';

async function callWithRetry<T>(
  schema: z.ZodSchema<T>,
  prompt: string,
  systemPrompt: string,
  retries = MAX_RETRIES
): Promise<T> {
  if (USE_MOCK || !openai) {
    throw new Error('LLM service not available in mock mode for this function');
  }

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI');

      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    } catch (error) {
      if (i === retries) {
        console.error(`LLM call failed after ${retries + 1} attempts:`, error);
        throw error;
      }
      console.warn(`LLM call attempt ${i + 1} failed, retrying...`);
    }
  }
  throw new Error('Unexpected retry loop exit');
}

// Chain A: Section Evidence Mapping
export async function mapSectionEvidence(visits: Array<{ date: string; soapText: string }>): Promise<z.infer<typeof SectionEvidenceMappingSchema>> {
  if (USE_MOCK) {
    console.log('[MOCK] Using mock data for mapSectionEvidence - 실제 입력 데이터 기반으로 생성');
    try {
      // 실제 입력 데이터를 기반으로 evidence 매핑 생성
      const visitsText = visits.map(v => v.soapText).join(' ');
      const mockData = {
        sectionToEvidenceMap: {
          TITLE: [],
          ABSTRACT: visitsText ? [visitsText] : [],
          INTRODUCTION: [],
          PATIENT_INFORMATION: visitsText ? [visitsText] : [],
          CLINICAL_FINDINGS: visitsText ? [visitsText] : [],
          TIMELINE: visits.map((v, idx) => `방문 ${idx + 1} (${v.date}): ${v.soapText}`),
          DIAGNOSTIC_ASSESSMENT: visitsText ? [visitsText] : [],
          THERAPEUTIC_INTERVENTIONS: visitsText ? [visitsText] : [],
          FOLLOW_UP_OUTCOMES: visitsText ? [visitsText] : [],
          DISCUSSION_CONCLUSION: [],
          PATIENT_PERSPECTIVE: [],
          INFORMED_CONSENT: []
        }
      };
      return SectionEvidenceMappingSchema.parse(mockData);
    } catch (error) {
      console.error('[MOCK] Error parsing mock data:', error);
      throw error;
    }
  }

  const visitsText = visits
    .map((v, idx) => `방문 ${idx + 1} (${v.date}):\n${v.soapText}`)
    .join('\n\n---\n\n');

  const systemPrompt = `You are a medical information extraction expert. Analyze EMR visit records and map relevant evidence to CARE report sections. Only extract factual information from the provided text. Do not add any information not present in the EMR.`;

  const userPrompt = `다음 EMR 방문 기록을 분석하여 CARE 보고서 섹션별로 관련된 evidence를 매핑하세요.

EMR 기록:
${visitsText}

각 CARE 섹션에 대해 해당 섹션에 사용할 수 있는 EMR evidence 조각(문장 또는 문단)을 리스트로 반환하세요.
- TITLE, INTRODUCTION, DISCUSSION_CONCLUSION, PATIENT_PERSPECTIVE, INFORMED_CONSENT는 EMR에서 근거가 거의 없을 수 있습니다.
- evidence가 없는 섹션은 빈 배열로 반환하세요.

JSON 형식:
{
  "sectionToEvidenceMap": {
    "TITLE": ["evidence1", "evidence2"],
    "ABSTRACT": [],
    ...
  }
}`;

  return callWithRetry(SectionEvidenceMappingSchema, userPrompt, systemPrompt);
}

// Chain B: Section Status Assessment
export async function assessSectionStatus(
  sectionEvidenceMap: Record<string, string[]>
): Promise<z.infer<typeof SectionStatusAssessmentSchema>> {
  if (USE_MOCK) {
    console.log('[MOCK] Using mock data for assessSectionStatus');
    try {
      const mockData = getMockStatusAssessment();
      return SectionStatusAssessmentSchema.parse(mockData);
    } catch (error) {
      console.error('[MOCK] Error parsing mock data:', error);
      throw error;
    }
  }

  const evidenceSummary = Object.entries(sectionEvidenceMap)
    .map(([section, evidence]) => `${section}: ${evidence.length}개 evidence`)
    .join('\n');

  const systemPrompt = `You are a medical report assessment expert. Evaluate whether each CARE section can be drafted based on EMR evidence alone.`;

  const userPrompt = `다음은 CARE 섹션별 EMR evidence 매핑 결과입니다:

${evidenceSummary}

각 섹션에 대해 다음 상태 중 하나를 판정하세요:
- IMPOSSIBLE: EMR만으로 섹션 구조 자체 불가 (예: 서론, 동의, 제목)
- PARTIAL_IMPOSSIBLE: EMR로 일부 가능하지만 추가정보 50% 이상 필요
- PARTIAL_POSSIBLE: EMR로 50% 이상 가능, 소수 질문으로 보완
- POSSIBLE: EMR로 구조는 가능하나 상세/정확성 보강 필요
- FULLY_POSSIBLE: EMR만으로 CARE 필수항목 수준 초안 생성 가능

각 섹션에 대해:
1. status: 상태 enum
2. rationaleText: 판정 근거 (2~4문장)
3. missingInfoBullets: 부족 정보 bullet 3~8개 (있으면)
4. recommendedQuestions: 사용자에게 물어볼 질문 리스트 (있으면)

JSON 형식:
{
  "sectionStatusMap": {
    "TITLE": {
      "status": "IMPOSSIBLE",
      "rationaleText": "...",
      "missingInfoBullets": [],
      "recommendedQuestions": ["질문1", "질문2"]
    },
    ...
  }
}`;

  return callWithRetry(SectionStatusAssessmentSchema, userPrompt, systemPrompt);
}

// Chain C: EMR-only Draft Generation
export async function generateDrafts(
  sectionEvidenceMap: Record<string, string[]>
): Promise<z.infer<typeof DraftGenerationSchema>> {
  if (USE_MOCK) {
    console.log('[MOCK] Using mock data for generateDrafts - 실제 evidence 기반으로 생성');
    try {
      // 실제 evidence를 기반으로 초안 생성 (하드코딩된 정보 추가하지 않음)
      const draftsBySection: Record<string, string> = {};
      const citations: Record<string, string[]> = {};
      
      Object.entries(sectionEvidenceMap).forEach(([section, evidence]) => {
        if (evidence.length > 0) {
          // evidence를 그대로 사용하되, 간단히 정리
          draftsBySection[section] = evidence.join(' ');
          citations[section] = ['visit1'];
        } else {
          draftsBySection[section] = '';
        }
      });
      
      const mockData = {
        draftsBySection,
        citations
      };
      return DraftGenerationSchema.parse(mockData);
    } catch (error) {
      console.error('[MOCK] Error parsing mock data:', error);
      throw error;
    }
  }

  const evidenceText = Object.entries(sectionEvidenceMap)
    .map(([section, evidence]) => `[${section}]\n${evidence.join('\n\n')}`)
    .join('\n\n---\n\n');

  const systemPrompt = `You are a medical report writer. Generate CARE report section drafts based ONLY on the provided EMR evidence. CRITICAL RULES:
1. NEVER add facts, numbers, dates, or treatments not present in the evidence
2. If information is uncertain or missing, explicitly state "정보 없음" or "기록 없음"
3. Do not use external medical knowledge to fill gaps
4. The draft should be a skeleton/structure, not a complete polished paper`;

  const userPrompt = `다음 EMR evidence를 기반으로 CARE 보고서 섹션별 초안을 생성하세요.

EMR Evidence:
${evidenceText}

규칙:
- evidence에 없는 사실/수치/날짜/치료를 추가 생성하지 마세요
- 불확실하면 "정보 없음/기록 없음"으로 명시하세요
- 초안은 "완성 논문"이 아니라 "골격"이어야 합니다
- evidence가 없는 섹션은 빈 문자열로 반환하세요

JSON 형식:
{
  "draftsBySection": {
    "TITLE": "초안 텍스트",
    "ABSTRACT": "",
    ...
  },
  "citations": {
    "TITLE": ["visit1", "visit2"],
    ...
  }
}`;

  return callWithRetry(DraftGenerationSchema, userPrompt, systemPrompt);
}

// Chain D: Next Question Generation
export async function generateNextQuestion(
  sectionId: string,
  currentDraft: string,
  missingInfo: string[],
  qnaHistory: Array<{ question: string; answer: string }>
): Promise<z.infer<typeof NextQuestionSchema>> {
  if (USE_MOCK) {
    console.log('[MOCK] Using mock data for generateNextQuestion');
    return NextQuestionSchema.parse(getMockNextQuestion());
  }

  const historyText = qnaHistory
    .map((qna, idx) => `Q${idx + 1}: ${qna.question}\nA${idx + 1}: ${qna.answer}`)
    .join('\n\n');

  const systemPrompt = `You are a medical information gathering assistant. Generate targeted questions to gather missing information for a CARE report section.`;

  const userPrompt = `CARE 섹션: ${sectionId}

현재 초안:
${currentDraft || '(초안 없음)'}

부족 정보:
${missingInfo.join('\n- ')}

이전 Q&A:
${historyText || '(없음)'}

다음 질문을 생성하세요. 모든 필요한 정보를 수집했다면 isComplete를 true로 설정하세요.

JSON 형식:
{
  "question": "질문 텍스트",
  "context": "질문 배경 (선택)",
  "isComplete": false
}`;

  return callWithRetry(NextQuestionSchema, userPrompt, systemPrompt);
}

// Chain E: Section Draft Update
export async function updateSectionDraft(
  sectionId: string,
  currentDraft: string,
  evidence: string[],
  userAnswers: Array<{ question: string; answer: string }>
): Promise<z.infer<typeof DraftUpdateSchema>> {
  if (USE_MOCK) {
    console.log('[MOCK] Using mock data for updateSectionDraft');
    return DraftUpdateSchema.parse(getMockDraftUpdate());
  }

  const evidenceText = evidence.join('\n\n');
  const answersText = userAnswers
    .map((qna, idx) => `Q${idx + 1}: ${qna.question}\nA${idx + 1}: ${qna.answer}`)
    .join('\n\n');

  const systemPrompt = `You are a medical report writer. Update a CARE section draft using ONLY the provided EMR evidence and user answers. CRITICAL RULES:
1. NEVER add facts not present in evidence or user answers
2. Do not use external medical knowledge
3. addedFacts array MUST be empty - if you add any new facts, the response will be rejected
4. Only improve sentence structure/formatting, do not add content`;

  const userPrompt = `CARE 섹션: ${sectionId}

현재 초안:
${currentDraft || '(초안 없음)'}

EMR Evidence:
${evidenceText}

사용자 답변:
${answersText}

위 정보만을 사용하여 섹션 초안을 업데이트하세요.
- 사용자가 제공하지 않은 정보는 절대 추가하지 마세요
- 외부 의학지식/일반지식으로 메우지 마세요
- 문장 연결/형식 정리는 가능합니다 ("표현 개선"은 허용)
- addedFacts는 반드시 빈 배열이어야 합니다

JSON 형식:
{
  "updatedDraft": "업데이트된 초안",
  "addedFacts": [],
  "isComplete": false,
  "nextQuestion": "추가 질문 (필요시)"
}`;

  const result = await callWithRetry(DraftUpdateSchema, userPrompt, systemPrompt);
  
  // Validation: addedFacts must be empty
  if (result.addedFacts.length > 0) {
    throw new Error(`Hallucination detected: addedFacts must be empty, but got: ${result.addedFacts.join(', ')}`);
  }

  return result;
}
