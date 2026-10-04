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
  /** 접힌 상태로 시작한다. 문장마다 긴 근거 목록이 반복되는 화면에서 쓴다. */
  collapsible?: boolean;
};

export default function ScaffoldEvidenceSelector({
  choices,
  selectedIds,
  onToggle,
  helperText = '연결할 기록 근거를 선택할 수 있습니다.',
  collapsible = false
}: ScaffoldEvidenceSelectorProps) {
  if (choices.length === 0) {
    return null;
  }

  const list = (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ color: '#52606d', fontSize: 15 }}>{helperText}</div>
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
                <span style={{ color: '#32647f', fontSize: 14, fontWeight: 700 }}>
                  {choice.sourceLabel}
                </span>
              )}
              <span style={{ color: '#334155', fontSize: 15, lineHeight: 1.5 }}>
                {renderClinicalAnonymizedText(choice.text)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  if (!collapsible) return list;

  return (
    <details>
      <summary style={{ cursor: 'pointer', color: '#32647f', fontSize: 15, fontWeight: 700, padding: '4px 0' }}>
        기록 근거 연결하기 (선택 {selectedIds.length}개)
      </summary>
      <div style={{ marginTop: 10 }}>{list}</div>
    </details>
  );
}
