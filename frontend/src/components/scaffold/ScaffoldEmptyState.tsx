type ScaffoldEmptyStateProps = {
  message: string;
};

export default function ScaffoldEmptyState({ message }: ScaffoldEmptyStateProps) {
  return (
    <div style={{ padding: 16, borderRadius: 8, background: '#f8fafc', color: '#4a5d73' }}>
      {message}
    </div>
  );
}
