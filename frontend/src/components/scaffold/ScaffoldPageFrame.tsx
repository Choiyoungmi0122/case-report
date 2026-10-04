import type { ReactNode } from 'react';

type ScaffoldPageFrameProps = {
  children: ReactNode;
};

export default function ScaffoldPageFrame({ children }: ScaffoldPageFrameProps) {
  return (
    <div style={{ padding: 24, background: '#f3f4f6', minHeight: '100vh' }}>
      <div
        style={{
          maxWidth: 1560,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20
        }}
      >
        {children}
      </div>
    </div>
  );
}
