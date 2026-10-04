import { renderClinicalAnonymizedText } from '../../utils/publicationRenderer';

type EvidenceChoice = {
  id: string;
  text: string;
  sourceLabel?: string;
};

type ScaffoldEvidenceSelectorProps = {
  choices: EvidenceChoice[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  helperText?: string;
};

export default function ScaffoldEvidenceSelector({
  choices,
  selectedIds,
  onToggle,
  helperText = '연결할 기록 근거를 선택할 수 있습니다.'
}: ScaffoldEvidenceSelectorProps) {
  if (choices.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ color: '#52606d', fontSize: 13 }}>{helperText}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {choices.map((choice) => (
          <label
            key={choice.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '20px minmax(0, 1fr)',
              alignItems: 'start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #d7e0e8',
              background: selectedIds.includes(choice.id) ? '#eef7ff' : '#fff',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(choice.id)}
              onChange={() => onToggle(choice.id)}
              style={{ marginTop: 3 }}
            />
            <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
              {choice.sourceLabel && (
                <span style={{ color: '#32647f', fontSize: 12, fontWeight: 700 }}>
                  {choice.sourceLabel}
                </span>
              )}
              <span style={{ color: '#334155', fontSize: 13, lineHeight: 1.5 }}>
                {renderClinicalAnonymizedText(choice.text)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
