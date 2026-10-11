import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * EMR 원문 검색·강조 (Scaffold V2, V2-06).
 *
 * - 원문(soapText)은 바꾸지 않는다. 표시할 때만 조각으로 나눠 <mark>를 씌운다.
 * - 검색어 일치는 대소문자를 구분하지 않는 단순 부분 일치다.
 * - anchor는 메모·AI 추천이 가리키는 원문 구절이다. 검색어와 별도로 강조한다.
 * - 검색어·이동 기록은 저장하지 않는다(연구계획서상 단순 행동 로그 미수집).
 */

export type EmrSearchMatch = {
  /** 전체 일치 목록에서의 순번 (0부터). data-match-id로 쓴다. */
  id: number;
  /** 0부터 시작하는 방문 인덱스. */
  visitIndex: number;
  start: number;
  end: number;
};

export type EmrAnchor = {
  /** 0부터 시작하는 방문 인덱스. */
  visitIndex: number;
  quote: string;
};

export function normalizeSearchQuery(query: string) {
  return query.trim().toLowerCase();
}

export function findEmrMatches(texts: string[], query: string): EmrSearchMatch[] {
  const needle = normalizeSearchQuery(query);
  if (needle.length < 1) return [];
  const matches: EmrSearchMatch[] = [];
  texts.forEach((text, visitIndex) => {
    const haystack = (text || '').toLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      matches.push({ id: matches.length, visitIndex, start: at, end: at + needle.length });
      from = at + Math.max(needle.length, 1);
    }
  });
  return matches;
}

/**
 * 검색 상태. texts는 방문 순서대로 soapText.
 * activeIndex는 전체 일치 목록에서의 위치이며, 검색어가 바뀌면 첫 일치로 돌아간다.
 */
export function useEmrSearch(texts: string[]) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => findEmrMatches(texts, query), [texts, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, texts]);

  const goTo = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      setActiveIndex((previous) => (previous + direction + matches.length) % matches.length);
    },
    [matches.length]
  );

  const active = matches.length > 0 ? matches[Math.min(activeIndex, matches.length - 1)] : null;
  return { query, setQuery, matches, active, activeIndex, next: () => goTo(1), prev: () => goTo(-1) };
}

/**
 * 스크롤 컨테이너 안에서 요소가 보이도록 옮긴다. 부드러운 스크롤은 창이 가려져 있으면 멈추므로 쓰지 않는다.
 * 요소가 접힌 <details> 안에 있으면 먼저 펼친다.
 */
export function revealInContainer(container: HTMLElement | null, target: HTMLElement | null) {
  if (!container || !target) return;
  let parent: HTMLElement | null = target.parentElement;
  while (parent && parent !== container) {
    if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
    parent = parent.parentElement;
  }
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = targetRect.top - containerRect.top - Math.max(0, (containerRect.height - targetRect.height) / 3);
  container.scrollTop += offset;
}

type HighlightedTextProps = {
  text: string;
  /** 이 방문의 검색 일치 목록(visitIndex가 같은 것만 넘긴다). */
  matches?: EmrSearchMatch[];
  activeMatchId?: number | null;
  /** 강조할 원문 구절. 첫 번째 등장 위치만 강조한다. */
  anchorQuote?: string | null;
};

type Segment = { start: number; end: number; matchId?: number; isAnchor?: boolean };

/**
 * 원문을 그대로 두고 검색 일치와 anchor 구절에만 <mark>를 씌운다.
 * 일치와 anchor가 겹치면 그 구간은 둘 다 표시한다(중첩 mark).
 */
export function HighlightedText({ text, matches = [], activeMatchId = null, anchorQuote = null }: HighlightedTextProps) {
  const anchorStart = anchorQuote ? text.indexOf(anchorQuote) : -1;
  const anchorEnd = anchorStart >= 0 && anchorQuote ? anchorStart + anchorQuote.length : -1;

  if (matches.length === 0 && anchorStart < 0) return <>{text}</>;

  // 경계점을 모아 조각으로 나눈다. 각 조각은 어느 일치·anchor에 속하는지 안다.
  const bounds = new Set<number>([0, text.length]);
  for (const match of matches) {
    bounds.add(Math.max(0, match.start));
    bounds.add(Math.min(text.length, match.end));
  }
  if (anchorStart >= 0) {
    bounds.add(anchorStart);
    bounds.add(anchorEnd);
  }
  const points = Array.from(bounds).sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;
    const match = matches.find((item) => item.start <= start && item.end >= end);
    const isAnchor = anchorStart >= 0 && anchorStart <= start && anchorEnd >= end;
    segments.push({ start, end, matchId: match?.id, isAnchor });
  }

  return (
    <>
      {segments.map((segment) => {
        const slice = text.slice(segment.start, segment.end);
        let node: ReactNode = slice;
        if (segment.matchId !== undefined) {
          const isActive = segment.matchId === activeMatchId;
          node = (
            <mark
              className={`scaffold-emr-mark${isActive ? ' is-active' : ''}`}
              data-match-id={segment.matchId}
              aria-current={isActive ? 'true' : undefined}
            >
              {node}
            </mark>
          );
        }
        if (segment.isAnchor) {
          node = (
            <mark className="scaffold-emr-anchor" data-anchor="1">
              {node}
            </mark>
          );
        }
        return <span key={`${segment.start}-${segment.end}`}>{node}</span>;
      })}
    </>
  );
}

type EmrSearchBoxProps = {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  placeholder?: string;
  compact?: boolean;
};

/** 검색 입력 + "N/M" + 이전/다음. */
export function EmrSearchBox({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
  placeholder = '기록에서 찾기 (예: 황련해독탕, 약침, 용량)',
  compact = false
}: EmrSearchBoxProps) {
  const hasQuery = normalizeSearchQuery(query).length > 0;
  return (
    <div className={`scaffold-emr-search${compact ? ' is-compact' : ''}`} role="search">
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrev();
            else onNext();
          }
        }}
        placeholder={placeholder}
        aria-label="기록 검색"
      />
      <span className="scaffold-emr-search__count" aria-live="polite">
        {hasQuery ? (matchCount > 0 ? `${Math.min(activeIndex + 1, matchCount)}/${matchCount}` : '없음') : ''}
      </span>
      <button type="button" onClick={onPrev} disabled={matchCount === 0} aria-label="이전 결과" title="이전 결과 (Shift+Enter)">
        ↑
      </button>
      <button type="button" onClick={onNext} disabled={matchCount === 0} aria-label="다음 결과" title="다음 결과 (Enter)">
        ↓
      </button>
      {hasQuery ? (
        <button type="button" className="scaffold-emr-search__clear" onClick={() => onQueryChange('')} aria-label="검색 지우기">
          지우기
        </button>
      ) : null}
    </div>
  );
}
