import type { ReactNode } from 'react';
import ScaffoldActionButton from './ScaffoldActionButton';

type Option = {
  value: string;
  label: string;
};

type ScaffoldReviewCardProps = {
  badgeLabel: string;
  title: string;
  helperText?: string;
  judgmentValue: string;
  judgmentOptions: Option[];
  onJudgmentChange: (value: string) => void;
  noteValue: string;
  onNoteChange: (value: string) => void;
  notePlaceholder: string;
  saveLabel: string;
  savePendingLabel?: string;
  saveDisabled?: boolean;
  validationMessage?: string;
  onSave: () => void;
  saving?: boolean;
  children?: ReactNode;
};

export default function ScaffoldReviewCard({
  badgeLabel,
  title,
  helperText,
  judgmentValue,
  judgmentOptions,
  onJudgmentChange,
  noteValue,
  onNoteChange,
  notePlaceholder,
  saveLabel,
  savePendingLabel = '저장 중...',
  saveDisabled = false,
  validationMessage,
  onSave,
  saving = false,
  children
}: ScaffoldReviewCardProps) {
  return (
    <div
      style={{
        border: '1px solid #c9d8f5',
        borderLeft: '5px solid #3b6fd4',
        borderRadius: 8,
        padding: 18,
        background: '#ffffff'
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          padding: '4px 10px',
          borderRadius: 999,
          background: '#eff4ff',
          color: '#244a86',
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 8
        }}
      >
        {badgeLabel}
      </div>
      <div style={{ fontWeight: 700, color: '#17324d', marginBottom: 12, fontSize: 17, lineHeight: 1.7 }}>{title}</div>
      {helperText ? (
        <div style={{ color: '#52606d', lineHeight: 1.6, marginBottom: 12 }}>{helperText}</div>
      ) : null}

      <div style={{ display: 'grid', gap: 12 }}>
        <select
          value={judgmentValue}
          onChange={(event) => onJudgmentChange(event.target.value)}
          style={{ padding: 10, borderRadius: 6, border: '1px solid #c8d2dd' }}
        >
          {judgmentOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {children}

        <textarea
          value={noteValue}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          placeholder={notePlaceholder}
          style={{ padding: 12, borderRadius: 6, border: '1px solid #c8d2dd' }}
        />

        {validationMessage ? (
          <div style={{ color: '#9f3412', fontSize: 14, lineHeight: 1.5 }}>
            {validationMessage}
          </div>
        ) : null}

        <ScaffoldActionButton
          variant="primary"
          onClick={onSave}
          disabled={saving || saveDisabled}
          style={{ width: 'fit-content' }}
        >
          {saving ? savePendingLabel : saveLabel}
        </ScaffoldActionButton>
      </div>
    </div>
  );
}
