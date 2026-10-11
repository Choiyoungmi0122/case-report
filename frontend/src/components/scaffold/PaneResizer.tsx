import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react';

/**
 * 작성 화면 3열(원기록 · 현재 작업 · 내가 정리한 내용)의 폭을 드래그로 조절한다 (Scaffold V2, V2-03).
 *
 * - 기본 배치는 기존 CSS와 같다(31% / 나머지 / 29%).
 * - 각 열은 최소 폭을 지킨다. 화면이 좁으면(900px 미만) 기존 1열 배치 CSS가 그대로 적용되고 조절은 꺼진다.
 * - 조절한 폭은 이 브라우저에만 localStorage로 기억한다. 연구 데이터로 저장하거나 이벤트로 남기지 않는다.
 */

const STORAGE_KEY = 'scaffold-v2-pane-widths';
const DEFAULT_WIDTHS: PaneWidths = { left: 31, right: 29 };
const MIN_SIDE_PX = 240;
const MIN_CENTER_PX = 360;
const HANDLE_PX = 10;
const WIDE_QUERY = '(min-width: 900px)';

export type PaneWidths = { left: number; right: number };

function readStoredWidths(): PaneWidths {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTHS;
    const parsed = JSON.parse(raw);
    const left = Number(parsed?.left);
    const right = Number(parsed?.right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return DEFAULT_WIDTHS;
    return { left, right };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

function writeStoredWidths(widths: PaneWidths) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* 저장소를 쓸 수 없으면 이번 화면에서만 유지한다 */
  }
}

function clampWidths(next: PaneWidths, gridWidthPx: number): PaneWidths {
  if (!gridWidthPx) return next;
  const minSide = (MIN_SIDE_PX / gridWidthPx) * 100;
  const minCenter = (MIN_CENTER_PX / gridWidthPx) * 100;
  const handles = ((HANDLE_PX * 2) / gridWidthPx) * 100;
  const maxTotal = Math.max(minSide * 2, 100 - minCenter - handles);
  let left = Math.max(minSide, next.left);
  let right = Math.max(minSide, next.right);
  if (left + right > maxTotal) {
    // 지금 끌고 있는 쪽을 우선하지 않고, 넘친 만큼을 둘 다에서 비례해 줄인다.
    const overflow = left + right - maxTotal;
    const share = left / (left + right);
    left = Math.max(minSide, left - overflow * share);
    right = Math.max(minSide, right - overflow * (1 - share));
  }
  return { left, right };
}

export function usePaneResize(enabled: boolean, gridRef: RefObject<HTMLElement | null>) {
  const [widths, setWidths] = useState<PaneWidths>(() => readStoredWidths());
  const [isWide, setIsWide] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true
  );
  const dragRef = useRef<{ side: 'left' | 'right'; pointerId: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(WIDE_QUERY);
    const onChange = () => setIsWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const applyWidths = useCallback(
    (next: PaneWidths) => {
      const gridWidth = gridRef.current?.getBoundingClientRect().width || 0;
      const clamped = clampWidths(next, gridWidth);
      setWidths(clamped);
      writeStoredWidths(clamped);
    },
    [gridRef]
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      const grid = gridRef.current;
      if (!drag || !grid) return;
      const rect = grid.getBoundingClientRect();
      if (rect.width <= 0) return;
      if (drag.side === 'left') {
        const leftPercent = ((event.clientX - rect.left) / rect.width) * 100;
        applyWidths({ left: leftPercent, right: widths.right });
      } else {
        const rightPercent = ((rect.right - event.clientX) / rect.width) * 100;
        applyWidths({ left: widths.left, right: rightPercent });
      }
    },
    [applyWidths, gridRef, widths.left, widths.right]
  );

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    document.body.classList.remove('scaffold-pane-resizing');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (side: 'left' | 'right', event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !isWide) return;
      event.preventDefault();
      dragRef.current = { side, pointerId: event.pointerId };
      document.body.classList.add('scaffold-pane-resizing');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
    },
    [enabled, isWide, onPointerMove, stopDrag]
  );

  useEffect(() => stopDrag, [stopDrag]);

  const nudge = useCallback(
    (side: 'left' | 'right', deltaPercent: number) => {
      applyWidths(
        side === 'left'
          ? { left: widths.left + deltaPercent, right: widths.right }
          : { left: widths.left, right: widths.right + deltaPercent }
      );
    },
    [applyWidths, widths.left, widths.right]
  );

  const reset = useCallback(() => {
    setWidths(DEFAULT_WIDTHS);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const active = enabled && isWide;
  const gridStyle = useMemo<CSSProperties | undefined>(
    () =>
      active
        ? {
            gridTemplateColumns: `${widths.left}% ${HANDLE_PX}px minmax(0, 1fr) ${HANDLE_PX}px ${widths.right}%`
          }
        : undefined,
    [active, widths.left, widths.right]
  );
  const isDefault = Math.abs(widths.left - DEFAULT_WIDTHS.left) < 0.01 && Math.abs(widths.right - DEFAULT_WIDTHS.right) < 0.01;

  return { active, gridStyle, startDrag, nudge, reset, isDefault };
}

type PaneResizeHandleProps = {
  side: 'left' | 'right';
  label: string;
  onPointerDown: (side: 'left' | 'right', event: ReactPointerEvent<HTMLElement>) => void;
  onNudge: (side: 'left' | 'right', deltaPercent: number) => void;
};

/** 두 열 사이의 세로 손잡이. 마우스·터치로 끌거나, 포커스한 뒤 ←/→ 키로 2%씩 옮긴다. */
export function PaneResizeHandle({ side, label, onPointerDown, onNudge }: PaneResizeHandleProps) {
  return (
    <div
      className="scaffold-pane-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label} (끌어서 조절, 키보드 ←/→)`}
      onPointerDown={(event) => onPointerDown(side, event)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          // 왼쪽 손잡이는 오른쪽으로 끌면 왼쪽 열이 넓어지고, 오른쪽 손잡이는 반대다.
          onNudge(side, side === 'left' ? 2 * direction : -2 * direction);
        }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
