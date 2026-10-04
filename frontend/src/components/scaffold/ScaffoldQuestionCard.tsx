import type { ReactNode } from 'react';
import ScaffoldActionButton from './ScaffoldActionButton';

type QuestionAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
};

type ScaffoldQuestionCardProps = {
  badgeLabel: string;
  badgeVariant?: 'common' | 'section';
  question: string;
  answerValue: string;
  onAnswerChange: (value: string) => void;
  answerPlaceholder: string;
  storedNote?: string;
  actions: QuestionAction[];
  children?: ReactNode;
};

export default function ScaffoldQuestionCard({
  badgeLabel,
  badgeVariant = 'section',
  question,
  answerValue,
  onAnswerChange,
  answerPlaceholder,
  storedNote,
  actions,
  children
}: ScaffoldQuestionCardProps) {
  const badgeStyle =
    badgeVariant === 'common'
      ? { background: '#fff5e6', color: '#9a6700' }
      : { background: '#eff4ff', color: '#244a86' };

  return (
    <div
      style={{
        border: '1px solid #d7e0e8',
        borderRadius: 8,
        padding: 16,
        background: '#fcfdff'
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 8,
          ...badgeStyle
        }}
      >
        {badgeLabel}
      </div>
      <div style={{ fontWeight: 700, color: '#17324d', marginBottom: 12 }}>{question}</div>
      <textarea
        value={answerValue}
        onChange={(event) => onAnswerChange(event.target.value)}
        rows={3}
        placeholder={answerPlaceholder}
        style={{
          width: '100%',
          padding: 12,
          borderRadius: 6,
          border: '1px solid #c8d2dd',
          marginBottom: 12
        }}
      />

      {children}

      {storedNote ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 6,
            background: '#f8fafc',
            color: '#52606d'
          }}
        >
          저장된 메모: {storedNote}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        {actions.map((action) => (
          <ScaffoldActionButton
            key={action.label}
            variant={action.variant || 'secondary'}
            onClick={action.onClick}
          >
            {action.label}
          </ScaffoldActionButton>
        ))}
      </div>
    </div>
  );
}
