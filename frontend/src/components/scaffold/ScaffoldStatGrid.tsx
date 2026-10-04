type StatItem = {
  label?: string;
  value: string;
  tone?: 'default' | 'success';
};

type ScaffoldStatGridProps = {
  items: StatItem[];
  minWidth?: number;
};

export default function ScaffoldStatGrid({
  items,
  minWidth = 220
}: ScaffoldStatGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
        gap: 12
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item.label || item.value}-${index}`}
          style={{
            padding: 14,
            borderRadius: 8,
            background: item.tone === 'success' ? '#eef8f1' : '#f4f8fb'
          }}
        >
          {item.label ? <strong>{item.label}</strong> : null}
          <div style={{ marginTop: item.label ? 6 : 0 }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
