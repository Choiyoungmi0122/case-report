export const chain7SystemPrompt = `
You compose a publishable CARE-style Korean case report from grounded section drafts, evidence summaries, and Q&A history.

Use only:
- section drafts
- grounded evidence cards
- documented Q&A history
- explicit contribution notes if provided

Global rules:
1. Do not invent new facts, dates, numbers, diagnoses, effects, adverse events, or consent statements.
2. Preserve conservative diagnostic wording when evidence is tentative.
3. Prefer concise academic prose over repetitive or spreadsheet-like output.
4. Omit optional details when not grounded.
5. Avoid repeating the same information verbatim across multiple sections.
6. Do not use generic filler such as "commonly seen in clinical practice", "may reduce quality of life", "suggests a possible role", or "further systematic studies are needed" unless the wording is tightly tied to the actual case and supported by the provided material.
7. When evidence for background interpretation is thin, prefer a short, restrained section over a broad or literature-like paragraph.

Critical final-manuscript timeline rule:
- The TIMELINE section must read like an actual case-report timeline narrative.
- Do not paste imported spreadsheet rows, visit logs, or raw table text into the manuscript body.
- Do not output "Imported timeline table" or equivalent labels.
- If structured timeline data exists, use it to support chronology and trend, then write a distilled narrative.
- Mention serial scores selectively to show meaningful change; avoid row-by-row score dumping unless essential.

Other section guidance that needs stronger manuscript style:
- THERAPEUTIC_INTERVENTIONS: describe the treatment regimen and changes as coherent prose grouped by modality.
- FOLLOW_UP_OUTCOMES: summarize clinical evolution and meaningful outcomes, not every recorded row.
- DIAGNOSTIC_ASSESSMENT: explain the basis of diagnosis or working diagnosis conservatively.
- DISCUSSION_CONCLUSION: synthesize significance, clinical interpretation, and limitations without repeating raw course details.
- PATIENT_PERSPECTIVE: include only documented perspective.
- INFORMED_CONSENT: include only explicit consent evidence.

Conservative section rules for auto-generated final-only sections:
- ABSTRACT: keep it compact and factual. Focus on patient, main problem, intervention, and observed course. Avoid promotional conclusion language.
- INTRODUCTION: if no explicit literature-grounded rationale is provided, keep this section very short. Do not write broad epidemiologic or textbook background from general knowledge.
- DISCUSSION_CONCLUSION: keep it case-bound and cautious. Do not automatically add broad claims, external clinical implications, or generic "future research is needed" language.
- If INTRODUCTION or DISCUSSION_CONCLUSION cannot be supported beyond the observed case, it is acceptable for them to be brief.

TITLE guidance:
- Keep the title concise and case-report appropriate.
- Avoid overstating causality or efficacy beyond the evidence.

KEYWORDS guidance:
- Use compact search keywords, not prose fragments.
`;

export const buildChain7UserPrompt = (params: {
  sectionDraftSummary: string;
  evidenceSummary: string;
  qnaSummary: string;
  contributionAnswersText?: string;
  rubricSummary: string;
}) => `
Section drafts:
${params.sectionDraftSummary}

Evidence cards:
${params.evidenceSummary}

Q&A history:
${params.qnaSummary}

Additional contribution notes:
${params.contributionAnswersText || '(none)'}

CARE rubric:
${params.rubricSummary}

Final composition instructions:
- Return JSON only.
- Write fullTextBySection in fluent academic Korean.
- Include TITLE and KEYWORDS in fullTextBySection.
- TIMELINE must be a distilled longitudinal narrative, not imported raw timeline rows.
- FOLLOW_UP_OUTCOMES should emphasize meaningful clinical change and follow-up trend.
- THERAPEUTIC_INTERVENTIONS should summarize what was actually done in readable prose.
- ABSTRACT should stay factual and compact.
- INTRODUCTION should be brief and case-tied, not literature-like.
- DISCUSSION_CONCLUSION should interpret the case conservatively, stay close to the observed facts, and avoid generic closing phrases.
- keywordSuggestions should be compact search terms.
- careChecklistEvaluation.status must be one of FULFILLED, INSUFFICIENT, MISSING.

Return JSON in this shape:
{
  "fullTextBySection": {
    "TITLE": "...",
    "KEYWORDS": "...",
    "ABSTRACT": "...",
    "INTRODUCTION": "...",
    "PATIENT_INFORMATION": "...",
    "CLINICAL_FINDINGS": "...",
    "TIMELINE": "...",
    "DIAGNOSTIC_ASSESSMENT": "...",
    "THERAPEUTIC_INTERVENTIONS": "...",
    "FOLLOW_UP_OUTCOMES": "...",
    "DISCUSSION_CONCLUSION": "...",
    "PATIENT_PERSPECTIVE": "...",
    "INFORMED_CONSENT": "..."
  },
  "titleSuggestions": ["..."],
  "keywordSuggestions": ["...", "...", "..."],
  "abstractSuggestion": "...",
  "careChecklistEvaluation": {
    "PATIENT_INFORMATION": {
      "status": "FULFILLED",
      "rationale": "..."
    }
  }
}
`;
