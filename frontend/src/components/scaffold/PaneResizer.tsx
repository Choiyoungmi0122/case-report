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
 * - 양쪽 열(원기록, 내가 정리한 내용)은 각각 접고 펼 수 있다 (2026-10-12). 접은 열은 좁은 띠로 남고,
 *   가운데 작업 열이 빈 폭을 채운다. 접은 쪽 손잡이는 숨긴다. 접힘 상태는 기억하지 않는다
 *   (같은 컴퓨터를 다음 참가자가 써도 처음에는 세 열이 다 보이게).
 */

const STORAGE_KEY = 'scaffold-v2-pane-widths';
const DEFAULT_WIDTHS: PaneWidths = { left: 31, right: 29 };
const MIN_SIDE_PX = 240;
const MIN_CENTER_PX = 360;
const HANDLE_PX = 10;
/** 접은 열이 남기는 띠의 폭 */
export const COLLAPSED_RAIL_PX = 44;
const WIDE_QUERY = '(min-width: 900px)';

export type PaneWidths = { left: number; right: number };
export type PaneSide = 'left' | 'right';
export type PaneCollapsed = { left: boolean; right: boolean };

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

function clampWidths(next: PaneWidths, gridWidthPx: number, collapsed: PaneCollapsed = { left: false, right: false }): PaneWidths {
  if (!gridWidthPx) return next;
  const minSide = (MIN_SIDE_PX / gridWidthPx) * 100;
  const minCenter = (MIN_CENTER_PX / gridWidthPx) * 100;
  const handle = (HANDLE_PX / gridWidthPx) * 100;
  const rail = (COLLAPSED_RAIL_PX / gridWidthPx) * 100;
  // 한쪽이 접혀 있으면 펼친 쪽만 맞춘다. 접힌 쪽의 저장 폭은 그대로 두어 다시 펼 때 돌아온다.
  if (collapsed.left || collapsed.right) {
    if (collapsed.left && collapsed.right) return next;
    const maxOpen = Math.max(minSide, 100 - minCenter - rail - handle);
    const clampOpen = (value: number) => Math.min(maxOpen, Math.max(minSide, value));
    return collapsed.left ? { left: next.left, right: clampOpen(next.right) } : { left: clampOpen(next.left), right: next.right };
  }
  const handles = handle * 2;
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
  // 저장된 폭(사용자가 끈 값)과 화면에 실제로 쓰는 폭을 나눈다. 실제 폭은 지금 격자 폭과 접힘 상태에 맞춰
  // 매번 다시 맞춘다. 넓은 창에서 저장한 폭이나 한쪽을 접은 채 넓힌 폭을 그대로 쓰면 가운데 칸이 짓눌린다.
  const [storedWidths, setStoredWidths] = useState<PaneWidths>(() => readStoredWidths());
  const [collapsed, setCollapsed] = useState<PaneCollapsed>({ left: false, right: false });
  const [gridWidth, setGridWidth] = useState(0);
  const observedRef = useRef<{ element: HTMLElement; observer: ResizeObserver } | null>(null);
  // 격자는 데이터를 불러온 뒤에 그려지므로 렌더마다 확인해, 새 요소가 생기면 그때 관찰을 건다.
  useEffect(() => {
    const element = gridRef.current;
    if (observedRef.current?.element === element) return;
    observedRef.current?.observer.disconnect();
    observedRef.current = null;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setGridWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    observedRef.current = { element, observer };
    setGridWidth(element.getBoundingClientRect().width);
  });
  useEffect(() => () => observedRef.current?.observer.disconnect(), []);
  const widths = useMemo(() => clampWidths(storedWidths, gridWidth, collapsed), [storedWidths, gridWidth, collapsed]);
  const [isWide, setIsWide] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true
  );
  // 끄는 동안 쓰는 값은 ref 로 읽는다. 예전에는 폭이 바뀔 때마다 핸들러가 새로 만들어지고, 정리 effect 가
  // 옛 stopDrag 를 불러 첫 이동 뒤에 끌기가 끊겼다(한 번에 조금만 움직임). 2026-10-12 고침.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const dragCleanupRef = useRef<(() => void) | null>(null);

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
      const clamped = clampWidths(next, gridWidth, collapsedRef.current);
      setStoredWidths(clamped);
      writeStoredWidths(clamped);
    },
    [gridRef]
  );

  const startDrag = useCallback(
    (side: 'left' | 'right', event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !isWide) return;
      event.preventDefault();
      dragCleanupRef.current?.();
      document.body.classList.add('scaffold-pane-resizing');
      const onMove = (moveEvent: PointerEvent) => {
        const grid = gridRef.current;
        if (!grid) return;
        const rect = grid.getBoundingClientRect();
        if (rect.width <= 0) return;
        const current = widthsRef.current;
        if (side === 'left') {
          applyWidths({ left: ((moveEvent.clientX - rect.left) / rect.width) * 100, right: current.right });
        } else {
          applyWidths({ left: current.left, right: ((rect.right - moveEvent.clientX) / rect.width) * 100 });
        }
      };
      const stop = () => {
        document.body.classList.remove('scaffold-pane-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        dragCleanupRef.current = null;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      dragCleanupRef.current = stop;
    },
    [enabled, isWide, applyWidths, gridRef]
  );

  // 화면을 떠날 때 끌던 중이면 정리한다
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const nudge = useCallback(
    (side: 'left' | 'right', deltaPercent: number) => {
      const current = widthsRef.current;
      applyWidths(
        side === 'left'
          ? { left: current.left + deltaPercent, right: current.right }
          : { left: current.left, right: current.right + deltaPercent }
      );
    },
    [applyWidths]
  );

  const reset = useCallback(() => {
    setStoredWidths(DEFAULT_WIDTHS);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // 다시 펼칠 때 가운데가 최소 폭보다 좁아지지 않는 것은 위의 widths(실제 폭) 계산이 맡는다.
  const setPaneCollapsed = useCallback((side: PaneSide, value: boolean) => {
    setCollapsed((prev) => (prev[side] === value ? prev : { ...prev, [side]: value }));
  }, []);

  const active = enabled && isWide;
  const gridStyle = useMemo<CSSProperties | undefined>(() => {
    if (!active) return undefined;
    // 접은 쪽은 띠 폭만 남기고 손잡이 열을 뺀다. 가운데(1fr)가 남은 폭을 채운다.
    const columns = [
      collapsed.left ? `${COLLAPSED_RAIL_PX}px` : `${widths.left}%`,
      ...(collapsed.left ? [] : [`${HANDLE_PX}px`]),
      'minmax(0, 1fr)',
      ...(collapsed.right ? [] : [`${HANDLE_PX}px`]),
      collapsed.right ? `${COLLAPSED_RAIL_PX}px` : `${widths.right}%`
    ];
    return { gridTemplateColumns: columns.join(' ') };
  }, [active, collapsed.left, collapsed.right, widths.left, widths.right]);
  /** 그 쪽 손잡이를 그릴지. 접은 쪽은 손잡이가 없다. */
  const showHandle = (side: PaneSide) => active && !collapsed[side];
  const isDefault = Math.abs(widths.left - DEFAULT_WIDTHS.left) < 0.01 && Math.abs(widths.right - DEFAULT_WIDTHS.right) < 0.01;

  return { active, gridStyle, startDrag, nudge, reset, isDefault, collapsed, setPaneCollapsed, showHandle };
}

type PaneCollapseButtonProps = {
  /** 왼쪽 열(원기록)인지 오른쪽 열(내 정리)인지. 화살표 방향을 정한다. */
  side: PaneSide;
  collapsed: boolean;
  /** 열 이름. 버튼 이름과 띠에 세로로 쓴다. */
  paneLabel: string;
  controlsId: string;
  onToggle: () => void;
};

/** 열 머리말의 접기·펼치기 버튼. 접힌 열에서는 띠 전체가 이 버튼이 된다. */
export function PaneCollapseButton({ side, collapsed, paneLabel, controlsId, onToggle }: PaneCollapseButtonProps) {
  // 접기는 열이 줄어드는 쪽(바깥), 펼치기는 열이 늘어나는 쪽(안쪽)을 가리킨다.
  const outward = side === 'left' ? '«' : '»';
  const inward = side === 'left' ? '»' : '«';
  return (
    <button
      type="button"
      className={`scaffold-pane__collapse${collapsed ? ' is-collapsed' : ''}`}
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      aria-label={collapsed ? `${paneLabel} 펼치기` : `${paneLabel} 접기`}
      title={collapsed ? `${paneLabel} 펼치기` : `${paneLabel} 접기 (가운데 작업 칸이 넓어집니다)`}
      onClick={onToggle}
    >
      {collapsed ? (
        <>
          <span className="scaffold-pane__collapse-arrow" aria-hidden="true">{inward}</span>
          <span className="scaffold-pane__collapse-text">펼치기</span>
          <span className="scaffold-pane__collapse-label">{paneLabel}</span>
        </>
      ) : (
        <span className="scaffold-pane__collapse-text">
          {side === 'left' ? `${outward} 접기` : `접기 ${outward}`}
        </span>
      )}
    </button>
  );
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

/**
 * 좁은 화면(900px 미만, 세 열이 세로로 쌓임)에서 원기록·내 정리 열의 높이를 끌어서 조절한다 (2026-10-12).
 * 넓은 화면에서는 폭 손잡이를 쓰고 이 높이는 쓰지 않는다(CSS 에서 좁은 화면에만 적용).
 * 높이는 이 브라우저에만 기억한다. 연구 데이터로 저장하지 않는다.
 */
const HEIGHT_STORAGE_KEY = 'scaffold-v2-pane-heights';
const DEFAULT_HEIGHTS: Record<PaneSide, number> = { left: 420, right: 280 };
const MIN_HEIGHT_PX = 160;
const MAX_HEIGHT_PX = 1600;

function readStoredHeights(): Record<PaneSide, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HEIGHT_STORAGE_KEY) || 'null');
    const left = Number(parsed?.left);
    const right = Number(parsed?.right);
    return {
      left: Number.isFinite(left) ? left : DEFAULT_HEIGHTS.left,
      right: Number.isFinite(right) ? right : DEFAULT_HEIGHTS.right
    };
  } catch {
    return DEFAULT_HEIGHTS;
  }
}

const clampHeight = (value: number) => Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, Math.round(value)));

export function usePaneHeights() {
  const [heights, setHeights] = useState<Record<PaneSide, number>>(() => readStoredHeights());
  const heightsRef = useRef(heights);
  heightsRef.current = heights;

  const save = useCallback((next: Record<PaneSide, number>) => {
    setHeights(next);
    try {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 저장소를 쓸 수 없으면 이번 화면에서만 유지한다 */
    }
  }, []);

  const startDrag = useCallback(
    (side: PaneSide, event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = heightsRef.current[side];
      document.body.classList.add('scaffold-pane-resizing-y');
      const onMove = (moveEvent: PointerEvent) => {
        save({ ...heightsRef.current, [side]: clampHeight(startHeight + moveEvent.clientY - startY) });
      };
      const onUp = () => {
        document.body.classList.remove('scaffold-pane-resizing-y');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [save]
  );

  const nudge = useCallback(
    (side: PaneSide, delta: number) => save({ ...heightsRef.current, [side]: clampHeight(heightsRef.current[side] + delta) }),
    [save]
  );

  /** 열 section 에 붙이는 스타일. CSS 가 좁은 화면에서만 이 값을 본문 높이로 쓴다. */
  const styleFor = (side: PaneSide) => ({ ['--pane-body-height' as string]: `${heights[side]}px` }) as CSSProperties;

  return { heights, startDrag, nudge, styleFor };
}

type PaneHeightHandleProps = {
  side: PaneSide;
  label: string;
  onPointerDown: (side: PaneSide, event: ReactPointerEvent<HTMLElement>) => void;
  onNudge: (side: PaneSide, delta: number) => void;
};

/** 좁은 화면에서 열 아래쪽에 붙는 가로 손잡이. 끌거나, 포커스한 뒤 ↑/↓ 키로 40px씩 바꾼다. */
export function PaneHeightHandle({ side, label, onPointerDown, onNudge }: PaneHeightHandleProps) {
  return (
    <div
      className="scaffold-pane-height-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      title={`${label} (끌어서 조절, 키보드 ↑/↓)`}
      onPointerDown={(event) => onPointerDown(side, event)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          onNudge(side, event.key === 'ArrowDown' ? 40 : -40);
        }
      }}
    >
      <span aria-hidden="true" />
      <em>끌어서 높이 조절</em>
    </div>
  );
}
