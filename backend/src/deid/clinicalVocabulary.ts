import { seedTermDb } from '../rag/termDb';

/**
 * Trusted clinical vocabulary used to suppress patient-name false positives.
 *
 * The name rule `([가-힣]{2,4})(?=\s*(?:환자|씨|님))` cannot tell "홍길동 환자"
 * from "견비통 환자" - both are 2-4 Hangul characters followed by 환자. The only
 * safe discriminator is positive evidence that the token is clinical
 * vocabulary, so a candidate is rejected ONLY when it is found here.
 *
 * Direction of error matters: a term missing from this vocabulary keeps today's
 * behaviour (it is redacted), which is the privacy-safe direction. A term listed
 * here is never redacted, so nothing that could be a real personal name is added.
 *
 * Source order follows the project's terminology policy:
 *   1. the project's own terminology DB (grows automatically as it is extended)
 *   2. a small curated set of standard Korean-medicine symptom / pattern terms
 *      that the current 36-entry DB does not yet cover
 */

/**
 * Curated Korean-medicine symptom, sign and pattern-identification terms.
 * Every entry is standard clinical vocabulary (증상 / 변증 용어); none is usable
 * as a Korean personal name in ordinary writing. Extend this list rather than
 * loosening the name rule itself.
 */
export const CURATED_CLINICAL_TERMS: string[] = [
  // 통증 (pain)
  '견비통', '요통', '두통', '슬통', '경항통', '요각통', '흉통', '복통',
  '상복부통', '하복통', '협통', '배통', '견통', '항강통', '지절통', '치통',
  // 일반 증상 (general symptoms)
  '현훈', '오심', '구토', '불면', '소화불량', '식욕부진', '변비', '설사',
  '피로', '권태', '도한', '자한', '이명', '난청', '기침', '해수', '천식',
  '호흡곤란', '부종', '저림', '마비', '경련', '발열', '오한', '번열',
  '구갈', '다한', '실면', '건망', '정충', '경계', '매핵기', '탈모',
  // 변증 / 병기 (pattern identification)
  '비증', '담음', '기허', '혈허', '어혈', '간기울결', '기체', '혈어',
  '음허', '양허', '기혈양허', '심비양허', '간양상항', '풍한', '풍열',
  '습열', '한습', '표증', '리증', '허증', '실증', '한증', '열증',
  // 진단 / 병명 (diagnoses)
  '중풍', '비만', '불안장애', '우울증', '수면장애', '위염', '역류성식도염',
  '견관절염', '퇴행성관절염', '추간판탈출증', '척추관협착증', '안면마비',
  // 진찰 / 소견 (examination vocabulary)
  '설진', '설질', '설태', '맥진', '안색', '안정', '진찰', '정서'
];

/**
 * Common Korean words that follow a bare 환자 in clinical narrative but can never
 * be a personal name — "환자 이후 경과를 관찰하였다", "환자 상태 확인" and so on.
 *
 * The patient-name rule accepts `환자` without a colon so that "환자 홍길동은" is
 * still caught, which unavoidably also matches the word right after any bare
 * 환자. This list is the same kind of guard as the existing 에서/으로/부터/까지
 * suffix check, just extended to whole words. It is grammatical/contextual
 * vocabulary only: nothing here is usable as a Korean given name, so name recall
 * is unaffected. Not exhaustive — an unlisted word simply keeps today's
 * behaviour and is redacted.
 */
export const NON_NAME_CONTEXT_WORDS: string[] = [
  '이후', '이전', '당시', '본인', '상태', '정보', '기록', '경과', '진술',
  '방문', '내원', '관련', '확인', '대상', '등록', '번호', '연락', '보호',
  '최초', '현재', '지속', '주소', '증상', '치료', '검사', '소견', '평가',
  '문진', '설명', '교육', '동의', '분류', '구분', '전체', '일부', '해당',
  '추적', '관찰', '병력', '가족', '직업', '나이', '연령', '성별'
];

function normalize(value: string): string {
  return String(value || '').trim();
}

function buildVocabulary(): Set<string> {
  const vocabulary = new Set<string>();

  const add = (value: unknown) => {
    const normalized = normalize(String(value ?? ''));
    if (normalized) vocabulary.add(normalized);
  };

  // 1. The project's terminology DB, including every recorded surface form.
  for (const entry of seedTermDb || []) {
    add(entry.standardTerm);
    (entry.synonyms || []).forEach(add);
    (entry.typoVariants || []).forEach(add);
    (entry.aliases || []).forEach(add);
  }

  // 2. Curated Korean-medicine vocabulary.
  CURATED_CLINICAL_TERMS.forEach(add);

  return vocabulary;
}

let cachedVocabulary: Set<string> | null = null;

function getVocabulary(): Set<string> {
  if (!cachedVocabulary) cachedVocabulary = buildVocabulary();
  return cachedVocabulary;
}

/**
 * True when the token is confirmed clinical vocabulary, i.e. positive evidence
 * that it is not a personal name.
 */
export function isKnownClinicalTerm(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  return getVocabulary().has(normalized);
}

const NON_NAME_CONTEXT_SET = new Set(NON_NAME_CONTEXT_WORDS);

/** True when the token is a grammatical/contextual word, never a personal name. */
export function isNonNameContextWord(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  return NON_NAME_CONTEXT_SET.has(normalized);
}

export function getClinicalVocabularySize(): number {
  return getVocabulary().size;
}

/** Test seam so a suite can assert against a known vocabulary state. */
export function resetClinicalVocabularyCache(): void {
  cachedVocabulary = null;
}
