import { useState } from 'react';
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

const UNGROUPED_LABEL = '기타';

function comparisonKey(text: string) {
  return text
    .replace(/^[\s•\-·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 근거 후보는 방문마다 같은 처방과 진단명이 반복 기록되어 매우 길어진다.
 * 똑같은 문장은 처음 나온 방문에만 남기고(이미 선택한 것은 유지), 방문별로 묶어 접어 둔다.
 */
function groupChoices(choices: EvidenceChoice[], selectedIds: string[]) {
  const seen = new Set<string>();
  const groups: Array<{ label: string; items: EvidenceChoice[] }> = [];
  let hiddenCount = 0;

  for (const choice of choices) {
    const key = comparisonKey(choice.text);
    const isDuplicate = seen.has(key);
    seen.add(key);
    if (isDuplicate && !selectedIds.includes(choice.id)) {
      hiddenCount += 1;
      continue;
    }

    const label = choice.sourceLabel || UNGROUPED_LABEL;
    const group = groups.find((item) => item.label === label);
    if (group) {
      group.items.push(choice);
    } else {
      groups.push({ label, items: [choice] });
    }
  }

  return { groups, hiddenCount };
}

export default function ScaffoldEvidenceSelector({
  choices,
  selectedIds,
  onToggle,
  helperText = '연결할 기록 근거를 선택할 수 있습니다.',
  collapsible = false
}: ScaffoldEvidenceSelectorProps) {
  // 사용자가 직접 펼치거나 접은 방문은 그 상태를 유지한다.
  const [openByLabel, setOpenByLabel] = useState<Record<string, boolean>>({});

  if (choices.length === 0) {
    return null;
  }

  const { groups, hiddenCount } = groupChoices(choices, selectedIds);

  const list = (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ color: '#52606d', fontSize: 15 }}>{helperText}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {groups.map((group) => {
          const selectedInGroup = group.items.filter((item) => selectedIds.includes(item.id)).length;
          return (
            <details
              key={group.label}
              open={openByLabel[group.label] ?? selectedInGroup > 0}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpenByLabel((previous) =>
                  previous[group.label] === isOpen ? previous : { ...previous, [group.label]: isOpen }
                );
              }}
              style={{ border: '1px solid #d7e0e8', borderRadius: 6, background: '#f8fafc' }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  padding: '10px 12px',
                  color: '#17324d',
                  fontSize: 15,
                  fontWeight: 700
                }}
              >
                {group.label}
                <span style={{ marginLeft: 8, color: '#5a6c81', fontWeight: 500 }}>{group.items.length}개</span>
                {selectedInGroup > 0 ? (
                  <span style={{ marginLeft: 8, color: '#23663a', fontWeight: 700 }}>선택 {selectedInGroup}개</span>
                ) : null}
              </summary>
              <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
                {group.items.map((choice) => (
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
                    <span style={{ color: '#334155', fontSize: 15, lineHeight: 1.5, minWidth: 0 }}>
                      {renderClinicalAnonymizedText(choice.text)}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        <div style={{ color: '#7a8fa1', fontSize: 13, lineHeight: 1.5 }}>
          여러 방문에 똑같이 반복 기록된 내용 {hiddenCount}개는 처음 나온 방문에만 표시했습니다.
        </div>
      ) : null}
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
