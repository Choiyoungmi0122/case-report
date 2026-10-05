import { useEffect, useState } from 'react';

type SessionTimerProps = {
  /** 세션이 시작된 시각(ISO). 실험 사례를 넣고 분석을 시작한 순간이다. */
  startedAt?: string | null;
};

function formatElapsed(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 실험용 경로에서 세션 시작 이후 흐른 시간을 보여준다. 시작 시각은 서버에 저장된
 * 값이라 화면을 옮기거나 새로고침해도 이어서 흐른다.
 */
export default function SessionTimer({ startedAt }: SessionTimerProps) {
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(startMs)) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startMs]);

  if (Number.isNaN(startMs)) return null;

  return (
    <div
      role="timer"
      aria-label="세션 경과 시간"
      style={{
        position: 'fixed',
        top: 10,
        right: 14,
        zIndex: 50,
        padding: '6px 12px',
        borderRadius: 999,
        border: '1px solid #c8d2dd',
        background: 'rgba(255, 255, 255, 0.95)',
        color: '#17324d',
        fontSize: 14,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08)'
      }}
    >
      경과 {formatElapsed(Math.floor((now - startMs) / 1000))}
    </div>
  );
}
