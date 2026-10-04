import type { CSSProperties, ReactNode } from 'react';

type ScaffoldActionButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary';
  style?: CSSProperties;
};

const baseStyle: CSSProperties = {
  borderRadius: 6,
  padding: '10px 14px',
  fontWeight: 600,
  fontSize: 16,
  cursor: 'pointer'
};

const variantStyles: Record<NonNullable<ScaffoldActionButtonProps['variant']>, CSSProperties> = {
  primary: {
    border: 'none',
    background: '#2f8055',
    color: '#fff'
  },
  secondary: {
    border: '1px solid #d3d8df',
    background: '#fff',
    color: '#1f2733'
  }
};

export default function ScaffoldActionButton({
  children,
  onClick,
  disabled = false,
  type = 'button',
  variant = 'secondary',
  style
}: ScaffoldActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseStyle,
        ...variantStyles[variant],
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style
      }}
    >
      {children}
    </button>
  );
}
