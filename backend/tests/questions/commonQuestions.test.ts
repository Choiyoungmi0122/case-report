import assert from 'node:assert/strict';
import {
  mergeCommonMissingWithOverlaps,
  mergeCommonQuestionsWithOverlaps,
  sanitizeGeneratedQuestionSets,
  synthesizeCommonQuestionsFromMissing
} from '../../src/llm/chains';
import { CommonMissingItem } from '../../src/llm/schemas/chain4_missing';
import { CommonQuestionSet } from '../../src/llm/schemas/chain5_questions';
import {
  COMMON_QUESTION_FALLBACK_TEMPLATES,
  normalizeQuestionText
} from '../../src/questions/questionTemplates';
import { getCommonQuestionCategoryLabel } from '../../../frontend/src/utils/commonQuestionUi';

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

async function run() {
  const psychosocialCase = mergeCommonQuestionsWithOverlaps({
    commonQuestions: [
      {
        question:
          '\uAC00\uC871 \uAC08\uB4F1\uC774\uB098 \uC2A4\uD2B8\uB808\uC2A4\uAC00 \uC99D\uC0C1 \uBCC0\uD654\uC640 \uC5B4\uB5BB\uAC8C \uC5F0\uACB0\uB418\uC5C8\uB294\uC9C0 \uC54C\uB824\uC8FC\uC138\uC694.',
        targetSectionIds: ['PATIENT_INFORMATION', 'DISCUSSION_CONCLUSION'],
        category: 'psychosocial_context'
      },
      {
        question:
          '\uAC00\uC871 \uAC08\uB4F1 \uB610\uB294 \uC2A4\uD2B8\uB808\uC2A4 \uC694\uC778\uACFC \uC99D\uC0C1 \uBCC0\uD654\uC758 \uAD00\uB828\uC131\uC744 \uC124\uBA85\uD574 \uC8FC\uC138\uC694.',
        targetSectionIds: ['PATIENT_INFORMATION', 'DIAGNOSTIC_ASSESSMENT'],
        category: 'psychosocial_context'
      }
    ] as CommonQuestionSet[],
    sectionQuestions: []
  });

  assert.equal(psychosocialCase.commonQuestions.length, 1);
  assert.equal(psychosocialCase.commonQuestions[0]?.category, 'psychosocial_context');

  const nonPsychosocialMissing = [
    {
      item: '\uCE58\uB8CC \uD6C4 \uC99D\uC0C1 \uBCC0\uD654\uC640 \uB0A8\uC544 \uC788\uB294 \uC99D\uC0C1',
      relatedSectionIds: ['THERAPEUTIC_INTERVENTIONS', 'FOLLOW_UP_OUTCOMES'],
      category: 'treatment_response'
    }
  ] as CommonMissingItem[];
  const nonPsychQuestions = synthesizeCommonQuestionsFromMissing(nonPsychosocialMissing);
  assert.equal(nonPsychQuestions.length, 1);
  assert.equal(nonPsychQuestions[0]?.category, 'treatment_response');
  assert.ok(includesAny(nonPsychQuestions[0]?.question || '', ['치료 후', '체감한 변화', '남아 있는 증상']));
  assert.ok(!includesAny(nonPsychQuestions[0]?.question || '', ['가족', '스트레스']));

  const symptomCourseMissing = [
    {
      item: '\uBC29\uBB38 \uC2DC\uC810\uBCC4 \uC99D\uC0C1 \uC810\uC218 \uBCC0\uD654',
      relatedSectionIds: ['TIMELINE', 'FOLLOW_UP_OUTCOMES']
    }
  ] as CommonMissingItem[];
  const symptomQuestions = synthesizeCommonQuestionsFromMissing(symptomCourseMissing);
  assert.equal(symptomQuestions[0]?.category, 'symptom_course');
  assert.equal(
    symptomQuestions[0]?.question,
    COMMON_QUESTION_FALLBACK_TEMPLATES.symptom_course
  );
  assert.ok(!/[A-Za-z]{3,}/.test(symptomQuestions[0]?.question || ''));

  const patientPerspectiveMissing = [
    {
      item: '\uD658\uC790\uAC00 \uC911\uC694\uD558\uAC8C \uB290\uB080 \uBCC0\uD654',
      relatedSectionIds: ['PATIENT_PERSPECTIVE', 'DISCUSSION_CONCLUSION']
    }
  ] as CommonMissingItem[];
  const patientPerspectiveQuestions = synthesizeCommonQuestionsFromMissing(patientPerspectiveMissing);
  assert.equal(patientPerspectiveQuestions[0]?.category, 'patient_perspective');

  const diagnosticMissing = [
    {
      item: '\uC9C4\uB2E8\uC744 \uB4B7\uBC1B\uCE68\uD558\uB294 \uD575\uC2EC \uC99D\uC0C1\uACFC \uBC30\uACBD \uC694\uC778',
      relatedSectionIds: ['DIAGNOSTIC_ASSESSMENT', 'DISCUSSION_CONCLUSION']
    }
  ] as CommonMissingItem[];
  const diagnosticQuestions = synthesizeCommonQuestionsFromMissing(diagnosticMissing);
  assert.equal(diagnosticQuestions[0]?.category, 'diagnostic_reasoning');
  assert.equal(
    normalizeQuestionText('What evidence supported the diagnostic assessment?'),
    COMMON_QUESTION_FALLBACK_TEMPLATES.diagnostic_reasoning
  );

  const dedupedEnglishAndKorean = mergeCommonQuestionsWithOverlaps({
    commonQuestions: [
      {
        question: 'How did the patient\'s symptoms change over time during the treatment period?',
        targetSectionIds: ['TIMELINE', 'FOLLOW_UP_OUTCOMES'],
        category: 'symptom_course'
      },
      {
        question: '치료 기간 동안 환자의 주요 증상이 시간에 따라 어떻게 변화했는지 설명해 주세요.',
        targetSectionIds: ['TIMELINE', 'FOLLOW_UP_OUTCOMES'],
        category: 'symptom_course'
      }
    ] as CommonQuestionSet[],
    sectionQuestions: []
  });
  assert.equal(dedupedEnglishAndKorean.commonQuestions.length, 1);
  assert.equal(
    dedupedEnglishAndKorean.commonQuestions[0]?.question,
    COMMON_QUESTION_FALLBACK_TEMPLATES.symptom_course
  );

  const sanitizedEnglishSectionQuestions = sanitizeGeneratedQuestionSets({
    commonQuestions: [],
    sectionQuestions: [
      {
        sectionId: 'FOLLOW_UP_OUTCOMES',
        questions: [
          'How did the patient\'s symptoms change over time during the treatment period?',
          'What changes did the patient perceive after treatment?'
        ]
      }
    ]
  });
  assert.ok(
    sanitizedEnglishSectionQuestions.sectionQuestions[0]?.questions.every(
      (question) => !/[A-Za-z]{3,}/.test(question)
    )
  );

  assert.equal(getCommonQuestionCategoryLabel('symptom_course'), '증상 경과');

  const filteredPsychosocialMissing = mergeCommonMissingWithOverlaps({
    sectionMissing: [],
    commonMissing: [
      {
        item: '\uAC00\uC871 \uAC08\uB4F1 \uB610\uB294 \uC2A4\uD2B8\uB808\uC2A4\uC640\uC758 \uAD00\uB828\uC131',
        relatedSectionIds: ['PATIENT_INFORMATION', 'DISCUSSION_CONCLUSION'],
        category: 'psychosocial_context'
      }
    ] as CommonMissingItem[]
  });
  assert.equal(filteredPsychosocialMissing.commonMissing.length, 1);

  const invalidPsychosocialMissing = mergeCommonMissingWithOverlaps({
    sectionMissing: [],
    commonMissing: [
      {
        item: '\uBC30\uACBD \uC815\uBCF4 \uCD94\uAC00',
        relatedSectionIds: ['PATIENT_INFORMATION', 'DISCUSSION_CONCLUSION'],
        category: 'psychosocial_context'
      }
    ] as CommonMissingItem[]
  });
  assert.equal(invalidPsychosocialMissing.commonMissing.length, 0);

  const cappedCommonQuestions = mergeCommonQuestionsWithOverlaps({
    commonQuestions: [
      {
        question:
          '\uC8FC\uC694 \uC99D\uC0C1\uC774 \uCD08\uC9C4 \uC774\uD6C4 \uAC01 \uBC29\uBB38 \uC2DC\uC810\uC5D0\uC11C \uC5B4\uB5BB\uAC8C \uBCC0\uD654\uD588\uB294\uC9C0 \uC124\uBA85\uD574 \uC8FC\uC138\uC694.',
        targetSectionIds: ['TIMELINE', 'FOLLOW_UP_OUTCOMES'],
        category: 'symptom_course'
      },
      {
        question:
          '\uC99D\uC0C1\uC73C\uB85C \uC778\uD574 \uC218\uBA74, \uC2DD\uC0AC, \uC77C\uC0C1 \uD65C\uB3D9 \uB610\uB294 \uB300\uC778\uAD00\uACC4\uC5D0 \uC5B4\uB5A4 \uBCC0\uD654\uAC00 \uC788\uC5C8\uB294\uC9C0 \uC54C\uB824\uC8FC\uC138\uC694.',
        targetSectionIds: ['PATIENT_INFORMATION', 'DISCUSSION_CONCLUSION'],
        category: 'functional_impact'
      },
      {
        question:
          '\uCE58\uB8CC \uD6C4 \uD658\uC790\uAC00 \uAC00\uC7A5 \uB69C\uB837\uD558\uAC8C \uCCB4\uAC10\uD55C \uBCC0\uD654\uC640 \uC544\uC9C1 \uB0A8\uC544 \uC788\uB294 \uC99D\uC0C1\uC744 \uC124\uBA85\uD574 \uC8FC\uC138\uC694.',
        targetSectionIds: ['THERAPEUTIC_INTERVENTIONS', 'FOLLOW_UP_OUTCOMES'],
        category: 'treatment_response'
      },
      {
        question:
          '\uD658\uC790\uAC00 \uCE58\uB8CC \uACFC\uC815\uC5D0\uC11C \uC911\uC694\uD558\uAC8C \uB290\uAF08\uB358 \uBCC0\uD654\uB098 \uC9C1\uC811 \uD45C\uD604\uD55C \uC18C\uAC10\uC774 \uC788\uB2E4\uBA74 \uC54C\uB824\uC8FC\uC138\uC694.',
        targetSectionIds: ['PATIENT_PERSPECTIVE', 'DISCUSSION_CONCLUSION'],
        category: 'patient_perspective'
      }
    ] as CommonQuestionSet[],
    sectionQuestions: []
  });
  assert.equal(cappedCommonQuestions.commonQuestions.length, 3);

  console.log('common question tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
