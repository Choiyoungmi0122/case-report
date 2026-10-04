import assert from 'node:assert/strict';
import { preprocessVisitsForChain1 } from '../../src/llm/chains';
import {
  applyDraftUpdateResultToEntry,
  buildFinalComposeWarning,
  buildStaleState,
  clearStaleState
} from '../../src/routes/cases';

const GUIBO = '\uADC0\uBCF4\uD0D5';
const GUIBI_TANG = '\uADC0\uBE44\uD0D5';
const CUSTOM_TERM = '\uADC0\uBCF4\uD0D5(\uC6D0\uBB38 \uC720\uC9C0)';

async function run() {
  const base = await preprocessVisitsForChain1([
    {
      index: 1,
      date: '2024-03-02',
      text: `${GUIBO} \uBCF5\uC6A9 \uD6C4 \uC218\uBA74\uC774 \uD638\uC804\uB428`
    },
    {
      index: 2,
      date: '2024-03-09',
      text: `${GUIBO} \uBCF5\uC6A9 \uD6C4 \uBD88\uC548\uAC10 \uAC10\uC18C`
    }
  ]);

  assert.equal(base.pendingTermConfirmations.length, 2);
  assert.equal(base.pendingTermConfirmations[0]?.status, 'PENDING');
  assert.ok(base.pendingTermConfirmations[0]?.pendingId);
  assert.ok(base.pendingTermConfirmations[1]?.pendingId);
  assert.notEqual(base.pendingTermConfirmations[0]?.pendingId, base.pendingTermConfirmations[1]?.pendingId);
  assert.ok(base.preparedVisits[0]?.normalizedText.includes(GUIBO));
  assert.ok(base.preparedVisits[1]?.normalizedText.includes(GUIBO));

  const firstPendingId = base.pendingTermConfirmations[0]!.pendingId;
  const secondPendingId = base.pendingTermConfirmations[1]!.pendingId;

  const confirmedFirstOnly = await preprocessVisitsForChain1(
    [
      {
        index: 1,
        date: '2024-03-02',
        text: `${GUIBO} \uBCF5\uC6A9 \uD6C4 \uC218\uBA74\uC774 \uD638\uC804\uB428`
      },
      {
        index: 2,
        date: '2024-03-09',
        text: `${GUIBO} \uBCF5\uC6A9 \uD6C4 \uBD88\uC548\uAC10 \uAC10\uC18C`
      }
    ],
    {
      storedConfirmations: base.pendingTermConfirmations.map((item) =>
        item.pendingId === firstPendingId
          ? {
              ...item,
              status: 'CONFIRMED' as const,
              confirmedTerm: GUIBI_TANG,
              normalizedTerm: GUIBI_TANG,
              needsUserConfirmation: false,
              resolvedAt: new Date().toISOString()
            }
          : item
      )
    }
  );

  assert.equal(
    confirmedFirstOnly.pendingTermConfirmations.find((item) => item.pendingId === firstPendingId)?.status,
    'CONFIRMED'
  );
  assert.equal(
    confirmedFirstOnly.pendingTermConfirmations.find((item) => item.pendingId === secondPendingId),
    undefined
  );
  assert.ok(confirmedFirstOnly.preparedVisits[0]?.normalizedText.includes(GUIBI_TANG));
  assert.ok(confirmedFirstOnly.preparedVisits[1]?.normalizedText.includes(GUIBI_TANG));

  const rejectedFirst = await preprocessVisitsForChain1(
    [
      {
        index: 1,
        date: '2024-03-02',
        text: `${GUIBO} \uBCF5\uC6A9 \uD6C4 \uC218\uBA74\uC774 \uD638\uC804\uB428`
      },
      {
        index: 2,
        date: '2024-03-09',
        text: `${GUIBO} \uBCF5\uC6A9 \uD6C4 \uBD88\uC548\uAC10 \uAC10\uC18C`
      }
    ],
    {
      storedConfirmations: base.pendingTermConfirmations.map((item) =>
        item.pendingId === firstPendingId
          ? {
              ...item,
              status: 'REJECTED' as const,
              customReplacement: CUSTOM_TERM,
              normalizedTerm: '',
              needsUserConfirmation: false,
              resolvedAt: new Date().toISOString()
            }
          : item
      )
    }
  );

  assert.equal(rejectedFirst.pendingTermConfirmations.find((item) => item.pendingId === firstPendingId)?.status, 'REJECTED');
  assert.ok(rejectedFirst.preparedVisits[0]?.normalizedText.includes(CUSTOM_TERM));
  assert.ok(rejectedFirst.preparedVisits[1]?.normalizedText.includes(CUSTOM_TERM));

  const staleAfterAnswer = buildStaleState('ANSWER_UPDATED');
  assert.equal(staleAfterAnswer.isStale, true);
  assert.equal(staleAfterAnswer.staleReason, 'ANSWER_UPDATED');
  assert.ok(buildFinalComposeWarning({ staleState: staleAfterAnswer })?.includes('ANSWER_UPDATED'));

  const draftEntry: any = {
    sectionId: 'PATIENT_INFORMATION',
    draftText: '\uAE30\uC874 \uBB38\uC7A5',
    evidenceLinks: [],
    unsupportedClaims: [],
    evidenceCardIdsUsed: []
  };
  applyDraftUpdateResultToEntry(draftEntry, {
    updatedDraftText: '\uC0C8\uB85C\uC6B4 \uBB38\uC7A5',
    evidenceLinks: [
      {
        sentence: '\uC0C8\uB85C\uC6B4 \uBB38\uC7A5',
        evidenceCardIds: ['evidence_1', 'evidence_2']
      }
    ],
    unsupportedClaims: [
      {
        sentence: '\uADFC\uAC70 \uC5C6\uB294 \uBB38\uC7A5',
        reason: 'No sufficiently similar evidence card was found.'
      }
    ]
  });

  assert.equal(draftEntry.draftText, '\uC0C8\uB85C\uC6B4 \uBB38\uC7A5');
  assert.deepEqual(draftEntry.evidenceCardIdsUsed, ['evidence_1', 'evidence_2']);
  assert.equal(draftEntry.evidenceLinks.length, 1);
  assert.equal(draftEntry.unsupportedClaims.length, 1);

  const cleared = clearStaleState();
  assert.equal(cleared.isStale, false);

  console.log('pending term workflow tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
