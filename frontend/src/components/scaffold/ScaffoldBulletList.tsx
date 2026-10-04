import ScaffoldEmptyState from './ScaffoldEmptyState';

type BulletItem = {
  id: string;
  text: string;
};

type ScaffoldBulletListProps = {
  items: BulletItem[];
  emptyMessage: string;
};

export default function ScaffoldBulletList({
  items,
  emptyMessage
}: ScaffoldBulletListProps) {
  if (items.length === 0) {
    return <ScaffoldEmptyState message={emptyMessage} />;
  }

  return (
    <ul style={{ color: '#4a5d73', lineHeight: 1.8, margin: 0 }}>
      {items.map((item) => (
        <li key={item.id}>{item.text}</li>
      ))}
    </ul>
  );
}
