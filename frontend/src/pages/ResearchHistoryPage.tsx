import { useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { caseApi, ResearchHistoryResponse } from '../services/api';
import ScaffoldSessionRecord from '../components/research/ScaffoldSessionRecord';

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function downloadJson(payload: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function latestTimestamp(values: Array<string | undefined>) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(String(b)).getTime() - new Date(String(a)).getTime())[0];
}

function TextBlock({ value }: { value?: string }) {
  const text = String(value || '').trim();
  if (!text) return <p style={styles.empty}>No content recorded.</p>;
  return <pre style={styles.pre}>{text}</pre>;
}

function SectionHistory({ section, exportData }: { section: any; exportData: any }) {
  const sectionId = section.sectionId;
  const scaffoldData = exportData.scaffoldData || {};
  const progress = asArray(scaffoldData.sectionProgress).find((item) => item.sectionId === sectionId);
  const reflection = asArray(scaffoldData.sectionReflections).find((item) => item.sectionId === sectionId);
  const snapshot = asArray(scaffoldData.preRevealSnapshots).find((item) => item.sectionId === sectionId);
  const qna = asArray(exportData.sectionQnaHistory).find((item) => item.sectionId === sectionId);
  const draft = asArray(exportData.sectionDrafts).find((item) => item.sectionId === sectionId);
  const reviewItems = asArray(scaffoldData.reviewItems).filter((item) => item.sectionId === sectionId);
  const postAiItems = reviewItems.filter((item) => item.sourceType === 'draft_sentence');
  const preAiItems = reviewItems.filter((item) => item.sourceType !== 'draft_sentence');
  const adequacy = exportData.sectionAdequacyReviews?.[sectionId];
  const sectionResearch = scaffoldData.sections?.[sectionId] || {};
  const timing = sectionResearch.sectionTiming || {};
  const duration = sectionResearch.durationSummary || {};
  const generation = sectionResearch.generationMetadata || draft?.generationMetadata || {};

  return (
    <section style={styles.sectionCard}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>{sectionId}</h3>
        <span style={styles.badge}>{section.status || '-'}</span>
      </div>

      <div style={styles.grid}>
        <div>
          <h4 style={styles.h4}>Post-AI Reflection</h4>
          {reflection?.postAiReflection ? (
            <ul style={styles.compactList}>
              <li>changed judgment: {reflection.postAiReflection.changedJudgment || '-'}</li>
              <li>unresolved question: {reflection.postAiReflection.unresolvedQuestion || '-'}</li>
              <li>transfer plan: {reflection.postAiReflection.transferPlan || '-'}</li>
              <li>saved at: {formatDate(reflection.postAiReflection.savedAt)}</li>
            </ul>
          ) : (
            <p style={styles.empty}>No post-AI reflection recorded.</p>
          )}
        </div>
        <div>
          <h4 style={styles.h4}>Grounded Review Coach</h4>
          <ul style={styles.compactList}>
            <li>feedback generated: {postAiItems.filter((item) => item.learningFeedback).length}</li>
            <li>
              evidence-linked feedback:{' '}
              {postAiItems.filter((item) => asArray(item.learningFeedback?.selectedEvidence).length > 0).length}
            </li>
          </ul>
        </div>
      </div>

      <div style={styles.grid}>
        <div>
          <h4 style={styles.h4}>Scaffold Progress</h4>
          {progress ? (
            <ul style={styles.compactList}>
              <li>record review: {String(Boolean(progress.recordReviewCompleted))}</li>
              <li>missing info review: {String(Boolean(progress.missingInfoReviewCompleted))}</li>
              <li>AI draft reveal: {String(Boolean(progress.draftRevealed))}</li>
              <li>draft review: {String(Boolean(progress.draftReviewCompleted))}</li>
              <li>completed at: {formatDate(progress.completedAt)}</li>
            </ul>
          ) : (
            <p style={styles.empty}>No scaffold progress recorded.</p>
          )}
        </div>

        <div>
          <h4 style={styles.h4}>Pre-AI Learner Data</h4>
          {reflection ? (
            <ul style={styles.compactList}>
              <li>key info: {asArray(reflection.learnerKeyInformationItems).join(', ') || '-'}</li>
              <li>missing info: {asArray(reflection.learnerIdentifiedMissingItems).join(', ') || '-'}</li>
              <li>additional confirmation: {asArray(reflection.additionalConfirmationItems).join(', ') || '-'}</li>
              <li>instructor review: {asArray(reflection.teacherReviewItems).join(', ') || '-'}</li>
              <li>notes: {reflection.learnerNotes || '-'}</li>
            </ul>
          ) : (
            <p style={styles.empty}>No learner reflection recorded.</p>
          )}
        </div>
      </div>

      <div style={styles.grid}>
        <div>
          <h4 style={styles.h4}>Timing</h4>
          <ul style={styles.compactList}>
            <li>entered: {formatDate(timing.enteredAt)}</li>
            <li>pre-reveal confirmed: {formatDate(timing.preRevealConfirmedAt)}</li>
            <li>AI revealed: {formatDate(timing.aiRevealedAt)}</li>
            <li>review started: {formatDate(timing.postAiReviewStartedAt)}</li>
            <li>review completed: {formatDate(timing.postAiReviewCompletedAt)}</li>
            <li>section completed: {formatDate(timing.completedAt)}</li>
            <li>pre-AI duration ms: {formatValue(duration.preAiReasoningMs)}</li>
            <li>post-AI duration ms: {formatValue(duration.postAiReviewMs)}</li>
            <li>section total ms: {formatValue(duration.sectionTotalMs)}</li>
          </ul>
        </div>
        <div>
          <h4 style={styles.h4}>AI Generation</h4>
          <ul style={styles.compactList}>
            <li>model: {formatValue(generation.model)}</li>
            <li>prompt version: {formatValue(generation.promptVersion)}</li>
            <li>prompt hash: {formatValue(generation.promptHash)}</li>
            <li>prompt template hash: {formatValue(generation.promptTemplateHash)}</li>
            <li>input hash: {formatValue(generation.inputHash)}</li>
            <li>temperature: {formatValue(generation.temperature)}</li>
            <li>top P: {formatValue(generation.topP)}</li>
            <li>max tokens: {formatValue(generation.maxTokens)}</li>
            <li>generated at: {formatDate(generation.generatedAt)}</li>
            <li>regeneration count: {formatValue(generation.regenerationCount)}</li>
            <li>cache hit: {formatValue(generation.cacheHit)}</li>
            <li>status: {formatValue(generation.generationStatus)}</li>
          </ul>
        </div>
      </div>

      <div style={styles.grid}>
        <div>
          <h4 style={styles.h4}>Selected Evidence / Pre-Reveal Snapshot</h4>
          {snapshot ? (
            <>
              <p style={styles.small}>snapshot at: {formatDate(snapshot.createdAt)}</p>
              <p style={styles.small}>selected evidence IDs: {asArray(snapshot.selectedEvidenceIds).join(', ') || '-'}</p>
              <details>
                <summary>Snapshot JSON</summary>
                <pre style={styles.pre}>{JSON.stringify(snapshot, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p style={styles.empty}>No pre-reveal snapshot recorded.</p>
          )}
        </div>
        <div>
          <h4 style={styles.h4}>AI Draft</h4>
          <TextBlock value={draft?.draftText} />
        </div>
      </div>

      <div style={styles.grid}>
        <div>
          <h4 style={styles.h4}>Post-AI Sentence Judgments</h4>
          {postAiItems.length ? (
            <ul style={styles.compactList}>
              {postAiItems.map((item: any) => (
                <li key={item.id}>
                  {item.judgment}: {item.sourceText}
                  {asArray(item.evidenceIds).length ? ` [evidence: ${item.evidenceIds.join(', ')}]` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p style={styles.empty}>No post-AI judgment recorded.</p>
          )}
        </div>
        <div>
          <h4 style={styles.h4}>Section Q&A</h4>
          {asArray(qna?.qnaHistory).length ? (
            <ol style={styles.compactList}>
              {asArray(qna.qnaHistory).map((item: any, index) => (
                <li key={`${sectionId}-qna-${index}`}>
                  Q. {item.question}
                  <br />
                  A. {item.answer}
                </li>
              ))}
            </ol>
          ) : (
            <p style={styles.empty}>No Q&A recorded.</p>
          )}
        </div>
      </div>

      <details>
        <summary>Pre-AI items and section review result</summary>
        <div style={styles.grid}>
          <pre style={styles.pre}>{JSON.stringify(preAiItems, null, 2)}</pre>
          <pre style={styles.pre}>{JSON.stringify(adequacy || null, null, 2)}</pre>
        </div>
      </details>
    </section>
  );
}

export default function ResearchHistoryPage() {
  const [experimentCode, setExperimentCode] = useState('');
  const [history, setHistory] = useState<ResearchHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistanceLevel, setAssistanceLevel] = useState<'minor' | 'major'>('minor');
  const [assistanceSectionId, setAssistanceSectionId] = useState('');
  const [assistanceReason, setAssistanceReason] = useState('');
  const [issueType, setIssueType] = useState('other');
  const [issueSectionId, setIssueSectionId] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [validationStatus, setValidationStatus] = useState('');
  const [validationMismatchCount, setValidationMismatchCount] = useState('');
  const [validationNote, setValidationNote] = useState('');
  const [outcomeStatus, setOutcomeStatus] = useState('');
  const [outcomeStopReason, setOutcomeStopReason] = useState('');

  const exportData = history?.researchExport;
  const sections = useMemo(() => asArray(exportData?.sectionStates), [exportData]);
  const mode = exportData?.mode || history?.case?.mode || '-';
  const latestObservedUpdate = useMemo(() => {
    if (!exportData) return undefined;
    return latestTimestamp([
      exportData.completedAt,
      exportData.finalComposeStatus?.completedAt,
      ...asArray(exportData.interactionEvents).map((event: any) => event.timestamp),
      ...asArray(exportData.scaffoldData?.interactionEvents).map((event: any) => event.timestamp),
      ...asArray(exportData.scaffoldData?.sectionProgress).map((item: any) => item.completedAt),
      ...asArray(exportData.scaffoldData?.preRevealSnapshots).map((item: any) => item.createdAt)
    ]);
  }, [exportData]);

  const applyLoadedState = (result: ResearchHistoryResponse) => {
    setHistory(result);
    const validation = result.researchExport?.caseInputValidation;
    setValidationStatus(validation?.validated === true ? 'true' : validation?.validated === false ? 'false' : '');
    setValidationMismatchCount(validation?.mismatchCount !== undefined ? String(validation.mismatchCount) : '');
    setValidationNote(validation?.note || '');
    setOutcomeStatus(result.researchExport?.sessionOutcome?.status || '');
    setOutcomeStopReason(result.researchExport?.sessionOutcome?.stopReason || '');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const code = experimentCode.trim();
    if (!code) return;

    setLoading(true);
    setError(null);
    setHistory(null);

    try {
      applyLoadedState(await caseApi.getResearchHistoryByExperimentCode(code));
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError.message || 'Failed to load research history.');
    } finally {
      setLoading(false);
    }
  };

  const reloadHistory = async () => {
    if (!history?.experimentCode) return;
    applyLoadedState(await caseApi.getResearchHistoryByExperimentCode(history.experimentCode));
  };

  const saveAssistance = async () => {
    if (!history?.caseId) return;
    await caseApi.updateResearchMetadata(history.caseId, {
      appendResearcherAssistance: {
        level: assistanceLevel,
        sectionId: assistanceSectionId || undefined,
        reason: assistanceReason || undefined
      }
    });
    setAssistanceReason('');
    await reloadHistory();
  };

  const saveIssue = async () => {
    if (!history?.caseId) return;
    await caseApi.updateResearchMetadata(history.caseId, {
      appendTechnicalIssue: {
        type: issueType as any,
        sectionId: issueSectionId || undefined,
        description: issueDescription || undefined,
        resolved: false
      }
    });
    setIssueDescription('');
    await reloadHistory();
  };

  const saveValidationAndOutcome = async () => {
    if (!history?.caseId) return;
    await caseApi.updateResearchMetadata(history.caseId, {
      caseInputValidation: {
        canonicalCaseId: exportData?.caseInputValidation?.canonicalCaseId || 'MAIN_CASE_01',
        canonicalCaseVersion: exportData?.caseInputValidation?.canonicalCaseVersion || 'v1.0',
        validated: validationStatus === 'true',
        mismatchCount: validationMismatchCount ? Number(validationMismatchCount) : undefined,
        note: validationNote || undefined
      },
      sessionOutcome: outcomeStatus
        ? {
            status: outcomeStatus as any,
            stopReason: outcomeStopReason || undefined
          }
        : undefined
    });
    await reloadHistory();
  };

  return (
    <div style={styles.page}>
      <main style={styles.container}>
        <header style={styles.hero}>
          <p style={styles.eyebrow}>Research History</p>
          <h1 style={styles.h1}>Experiment Code Lookup</h1>
          <p style={styles.lead}>Enter an experiment code such as EQ003, SQ005, SQ-005, or TEST-01.</p>
        </header>

        <form onSubmit={handleSubmit} style={styles.searchBox}>
          <input
            type="text"
            value={experimentCode}
            onChange={(event) => setExperimentCode(event.target.value)}
            placeholder="SQ005, SQ-005, TEST-01"
            style={styles.input}
          />
          <button type="submit" disabled={loading || !experimentCode.trim()} style={styles.button}>
            {loading ? 'Loading...' : 'Lookup'}
          </button>
        </form>

        {error ? <div style={styles.error}>{error}</div> : null}

        {history && exportData ? (
          <div style={styles.results}>
            <section style={styles.summary}>
              <div>
                <h2 style={styles.h2}>{history.experimentCode}</h2>
                <p style={styles.small}>mode: {mode}</p>
              </div>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => downloadJson(exportData, `${history.experimentCode}_research-export.json`)}
              >
                Download JSON
              </button>
            </section>

            <section style={styles.metaGrid}>
              <div><strong>participantCode</strong><span>{exportData.participantCode || '-'}</span></div>
              <div><strong>sessionId</strong><span>{exportData.sessionId || '-'}</span></div>
              <div><strong>caseId</strong><span>{history.caseId}</span></div>
              <div><strong>createdAt</strong><span>{formatDate(exportData.createdAt || history.case.createdAt)}</span></div>
              <div><strong>lastObservedAt</strong><span>{formatDate(latestObservedUpdate)}</span></div>
              <div><strong>startedAt</strong><span>{formatDate(exportData.startedAt)}</span></div>
              <div><strong>completedAt</strong><span>{formatDate(exportData.completedAt)}</span></div>
            </section>

            <details style={styles.sectionCard} open>
              <summary style={styles.sectionTitle}>Study Info</summary>
              <section style={styles.metaGrid}>
                <div><strong>Study Group</strong><span>{formatValue(exportData.studyMetadata?.studyGroup)}</span></div>
                <div><strong>Phase</strong><span>{formatValue(exportData.studyMetadata?.phase)}</span></div>
                <div><strong>Session No.</strong><span>{formatValue(exportData.studyMetadata?.sessionNo)}</span></div>
                <div><strong>Participation</strong><span>{formatValue(exportData.studyMetadata?.participationMode)}</span></div>
                <div><strong>App Version</strong><span>{formatValue(exportData.versionMetadata?.appVersion)}</span></div>
                <div><strong>Scaffold Version</strong><span>{formatValue(exportData.versionMetadata?.scaffoldVersion)}</span></div>
                <div><strong>Case ID / Version</strong><span>{history.caseId} / {formatValue(exportData.versionMetadata?.caseVersion)}</span></div>
                <div><strong>Outcome</strong><span>{formatValue(exportData.sessionOutcome?.status)}</span></div>
              </section>
            </details>

            {mode === 'scaffold' ? (
              <>
                <ScaffoldSessionRecord exportData={exportData} experimentCode={history.experimentCode} />
                <details style={styles.sectionCard}>
                  <summary style={styles.sectionTitle}>원자료 (전체 항목, 이전 형식)</summary>
                  {sections.map((section: any) => (
                    <SectionHistory key={section.sectionId} section={section} exportData={exportData} />
                  ))}
                </details>
              </>
            ) : sections.length ? (
              sections.map((section: any) => (
                <SectionHistory key={section.sectionId} section={section} exportData={exportData} />
              ))
            ) : (
              <section style={styles.sectionCard}>
                <p style={styles.empty}>No section state has been recorded yet.</p>
              </section>
            )}

            {mode === 'write' ? (
              <section style={styles.sectionCard}>
                <h3 style={styles.sectionTitle}>Write Trajectory / Final Manuscript</h3>
                <div style={styles.grid}>
                  <div>
                    <h4 style={styles.h4}>Draft Trajectory</h4>
                    <pre style={styles.pre}>{JSON.stringify(exportData.draftTrajectory || null, null, 2)}</pre>
                  </div>
                  <div>
                    <h4 style={styles.h4}>Final Draft</h4>
                    <pre style={styles.pre}>{JSON.stringify(exportData.finalDraft || null, null, 2)}</pre>
                  </div>
                </div>
              </section>
            ) : null}

            <details style={styles.sectionCard}>
              <summary style={styles.sectionTitle}>Research Notes</summary>
              <div style={styles.grid}>
                <div>
                  <h4 style={styles.h4}>Researcher Assistance</h4>
                  <select value={assistanceLevel} onChange={(event) => setAssistanceLevel(event.target.value as any)} style={styles.input}>
                    <option value="minor">minor</option>
                    <option value="major">major</option>
                  </select>
                  <input value={assistanceSectionId} onChange={(event) => setAssistanceSectionId(event.target.value)} placeholder="sectionId (optional)" style={styles.input} />
                  <textarea value={assistanceReason} onChange={(event) => setAssistanceReason(event.target.value)} placeholder="reason" style={styles.textarea} />
                  <button type="button" style={styles.secondaryButton} onClick={() => void saveAssistance()}>Add assistance</button>
                  <pre style={styles.pre}>{JSON.stringify(exportData.researcherAssistance || [], null, 2)}</pre>
                </div>
                <div>
                  <h4 style={styles.h4}>Technical Issues</h4>
                  <select value={issueType} onChange={(event) => setIssueType(event.target.value)} style={styles.input}>
                    {['ai_generation_failure', 'network', 'save_failure', 'refresh', 'session_recovery', 'ui_error', 'other'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <input value={issueSectionId} onChange={(event) => setIssueSectionId(event.target.value)} placeholder="sectionId (optional)" style={styles.input} />
                  <textarea value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} placeholder="description" style={styles.textarea} />
                  <button type="button" style={styles.secondaryButton} onClick={() => void saveIssue()}>Add issue</button>
                  <pre style={styles.pre}>{JSON.stringify(exportData.technicalIssues || [], null, 2)}</pre>
                </div>
              </div>
              <div style={styles.grid}>
                <div>
                  <h4 style={styles.h4}>Case Input Validation</h4>
                  <select value={validationStatus} onChange={(event) => setValidationStatus(event.target.value)} style={styles.input}>
                    <option value="">Unset</option>
                    <option value="true">validated true</option>
                    <option value="false">validated false</option>
                  </select>
                  <input value={validationMismatchCount} onChange={(event) => setValidationMismatchCount(event.target.value)} placeholder="mismatchCount" type="number" min={0} style={styles.input} />
                  <textarea value={validationNote} onChange={(event) => setValidationNote(event.target.value)} placeholder="note" style={styles.textarea} />
                </div>
                <div>
                  <h4 style={styles.h4}>Session Outcome</h4>
                  <select value={outcomeStatus} onChange={(event) => setOutcomeStatus(event.target.value)} style={styles.input}>
                    <option value="">Unset</option>
                    <option value="in_progress">in_progress</option>
                    <option value="completed">completed</option>
                    <option value="aborted">aborted</option>
                  </select>
                  <textarea value={outcomeStopReason} onChange={(event) => setOutcomeStopReason(event.target.value)} placeholder="stopReason" style={styles.textarea} />
                  <button type="button" style={styles.secondaryButton} onClick={() => void saveValidationAndOutcome()}>Save validation / outcome</button>
                </div>
              </div>
            </details>

            <details style={styles.rawDetails}>
              <summary>Raw research export</summary>
              <pre style={styles.pre}>{JSON.stringify(exportData, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </main>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f5f7fb',
    padding: 32,
    color: '#17324d'
  },
  container: {
    maxWidth: 1180,
    margin: '0 auto'
  },
  hero: {
    marginBottom: 24
  },
  eyebrow: {
    margin: '0 0 8px 0',
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    color: '#7a4e00',
    fontSize: 12,
    fontWeight: 800
  },
  h1: {
    margin: 0,
    fontSize: 36
  },
  h2: {
    margin: 0,
    fontSize: 24
  },
  h4: {
    margin: '0 0 10px 0',
    fontSize: 14
  },
  lead: {
    maxWidth: 720,
    color: '#4a5d73',
    lineHeight: 1.7
  },
  searchBox: {
    display: 'flex',
    gap: 12,
    padding: 16,
    background: '#fff',
    border: '1px solid rgba(23,50,77,0.12)',
    borderRadius: 8,
    boxShadow: '0 12px 30px rgba(23,50,77,0.06)',
    marginBottom: 18
  },
  input: {
    flex: 1,
    width: '100%',
    border: '1px solid #c8d2dd',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 16,
    marginBottom: 8
  },
  textarea: {
    width: '100%',
    minHeight: 76,
    border: '1px solid #c8d2dd',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 14,
    marginBottom: 8
  },
  button: {
    border: 'none',
    borderRadius: 8,
    padding: '12px 20px',
    background: '#17324d',
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer'
  },
  secondaryButton: {
    border: '1px solid #17324d',
    borderRadius: 8,
    padding: '10px 14px',
    background: '#fff',
    color: '#17324d',
    fontWeight: 700,
    cursor: 'pointer'
  },
  error: {
    padding: 14,
    borderRadius: 8,
    background: '#fdecec',
    color: '#b42318',
    marginBottom: 16
  },
  results: {
    display: 'grid',
    gap: 18
  },
  summary: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    background: '#fff',
    borderRadius: 8,
    padding: 20,
    border: '1px solid rgba(23,50,77,0.12)'
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10
  },
  sectionCard: {
    background: '#fff',
    borderRadius: 8,
    padding: 20,
    border: '1px solid rgba(23,50,77,0.12)',
    boxShadow: '0 12px 30px rgba(23,50,77,0.06)'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 14
  },
  sectionTitle: {
    margin: 0,
    fontSize: 18
  },
  badge: {
    borderRadius: 8,
    padding: '5px 10px',
    background: '#eef8f1',
    color: '#23663a',
    fontSize: 12,
    fontWeight: 800
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 16,
    marginTop: 14
  },
  compactList: {
    margin: 0,
    paddingLeft: 20,
    lineHeight: 1.7,
    color: '#334155'
  },
  small: {
    margin: '4px 0',
    color: '#4a5d73',
    fontSize: 13
  },
  empty: {
    margin: 0,
    color: '#6b7280'
  },
  pre: {
    maxHeight: 360,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 12,
    color: '#17324d',
    fontSize: 12,
    lineHeight: 1.6
  },
  rawDetails: {
    background: '#fff',
    borderRadius: 8,
    padding: 20,
    border: '1px solid rgba(23,50,77,0.12)'
  }
};
