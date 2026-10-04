/**
 * "내가 정리한 내용" - the learner's own record, rendered read-only.
 *
 * Every line here is something the learner typed or selected. Nothing is
 * generated: no LLM call, no summarisation, no inference. The component only
 * regroups existing learner state, so what the learner sees on the right is
 * exactly what will end up in the pre-reveal snapshot.
 */

export type SelfSummaryGroup = {
  key: string;
  label: string;
  items: string[];
  /** Free text (notes) renders as a paragraph rather than a list. */
  text?: string;
};

type ScaffoldSelfSummaryProps = {
  groups: SelfSummaryGroup[];
  /** After the AI draft is revealed the panel shows the frozen pre-AI state. */
  frozen?: boolean;
  frozenNote?: string;
  emptyMessage: string;
};

export default function ScaffoldSelfSummary({
  groups,
  frozen = false,
  frozenNote,
  emptyMessage
}: ScaffoldSelfSummaryProps) {
  // Empty groups are dropped entirely - a section like Introduction has few
  // source-derived entries and should not show a column of empty cards.
  const filled = groups.filter((group) => (group.text ? group.text.trim().length > 0 : group.items.length > 0));

  if (filled.length === 0) {
    return <p className="scaffold-summary__empty">{emptyMessage}</p>;
  }

  return (
    <div className={`scaffold-summary${frozen ? ' is-frozen' : ''}`}>
      {frozen && frozenNote ? <p className="scaffold-summary__frozen">{frozenNote}</p> : null}
      {filled.map((group) => (
        <section className="scaffold-summary__group" key={group.key}>
          <h4 className="scaffold-summary__label">{group.label}</h4>
          {group.text ? (
            <p className="scaffold-summary__note">{group.text}</p>
          ) : (
            <ul className="scaffold-summary__list">
              {group.items.map((item, index) => (
                <li key={`${group.key}-${index}`}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
