import assert from 'node:assert/strict';
import {
  buildAcademicKeywordPreview,
  buildAcademicTitlePreview
} from '../../../frontend/src/utils/frontMatterPreview';

function run() {
  const draftsBySection = {
    PATIENT_INFORMATION:
      '\u0034\u0037\uC138 \uC5EC\uC131 \uD658\uC790\uC774\uB2E4. \uAC00\uC871 \uAC08\uB4F1 \uC774\uD6C4 \uC99D\uC0C1\uC774 \uC545\uD654\uB418\uC5C8\uB2E4.',
    CLINICAL_FINDINGS: 'C/C \uAC00\uC2B4\uB2F5\uB2F5, \uC0C1\uC5F4\uAC10',
    DIAGNOSTIC_ASSESSMENT: '\uD654\uBCD1 r/o',
    THERAPEUTIC_INTERVENTIONS: 'AT PC6 LI4 LR3 \uC8FC2\uD68C',
    FOLLOW_UP_OUTCOMES: ''
  };

  const evidenceCards = [
    {
      normalizedText: '\uAC00\uC2B4\uB2F5\uB2F5, \uC0C1\uC5F4\uAC10',
      evidenceType: 'clinical_finding',
      tags: ['CLINICAL_FINDINGS']
    },
    {
      normalizedText: '\uD654\uBCD1 r/o',
      evidenceType: 'diagnostic_assessment',
      tags: ['DIAGNOSTIC_ASSESSMENT']
    },
    {
      normalizedText: 'AT PC6 LI4 LR3 \uC8FC2\uD68C',
      evidenceType: 'therapeutic_intervention',
      tags: ['THERAPEUTIC_INTERVENTIONS']
    }
  ];

  const title = buildAcademicTitlePreview(draftsBySection, evidenceCards);
  const keywords = buildAcademicKeywordPreview(draftsBySection, evidenceCards);

  assert.equal(title.startsWith('\uD658\uC790\uB294'), false);
  assert.match(title, /\uC99D\uB840\uBCF4\uACE0/);

  for (const banned of [
    '\uD658\uC790\uB294',
    '\uCD5C\uADFC',
    '\uAC00\uC871',
    '\uBB38\uC81C\uB85C',
    '\uC778\uD55C'
  ]) {
    assert.equal(keywords.includes(banned), false);
  }

  assert.ok(keywords.includes('\uC99D\uB840\uBCF4\uACE0'));
  assert.ok(keywords.includes('\uD654\uBCD1'));
  assert.ok(keywords.includes('\uCE68 \uCE58\uB8CC'));
  assert.ok(
    keywords.includes('\uAC00\uC2B4 \uB2F5\uB2F5') ||
      keywords.includes('\uAC00\uC2B4\uB2F5\uB2F5') ||
      keywords.includes('\uC0C1\uC5F4\uAC10')
  );

  console.log('frontMatterPreview tests passed');
}

run();
