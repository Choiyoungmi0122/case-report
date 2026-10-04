import type { ReactNode } from 'react';
import ScaffoldPanel from './ScaffoldPanel';

type ScaffoldHeroProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badgeText?: string;
};

export default function ScaffoldHero({
  title,
  description,
  actions,
  badgeText = 'Scaffold 모드'
}: ScaffoldHeroProps) {
  return (
    <ScaffoldPanel
      actions={actions}
      title={
        <>
          <div
            style={{
              display: 'inline-flex',
              padding: '3px 8px',
              borderRadius: 4,
              background: '#f8f9fa',
              border: '1px solid #d3d8df',
              color: '#4b5563',
              fontWeight: 600,
              marginBottom: 12,
              fontSize: 14
            }}
          >
            {badgeText}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1f2733', lineHeight: 1.3 }}>{title}</div>
        </>
      }
      description={description}
    >
      <></>
    </ScaffoldPanel>
  );
}
