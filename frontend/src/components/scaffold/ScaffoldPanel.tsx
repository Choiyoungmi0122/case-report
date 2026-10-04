import type { ReactNode } from 'react';

type ScaffoldPanelProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
};

export default function ScaffoldPanel({
  title,
  description,
  actions,
  children,
  compact = false
}: ScaffoldPanelProps) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e2e5ea',
        borderRadius: 8,
        padding: compact ? 20 : 24,
        boxShadow: '0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)'
      }}
    >
      {title || description || actions ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 16
          }}
        >
          <div>
            {typeof title === 'string' ? (
              <h2 style={{ marginTop: 0, color: '#1f2733', fontSize: 18 }}>{title}</h2>
            ) : title ? (
              title
            ) : null}
            {description ? <div style={{ color: '#4b5563', lineHeight: 1.7 }}>{description}</div> : null}
          </div>
          {actions ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
