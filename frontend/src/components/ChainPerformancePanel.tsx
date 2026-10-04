import { useMemo, useState } from 'react';
import { ChainPerformanceLog } from '../services/api';
import './ChainPerformancePanel.css';

const CHAIN_LABELS: Record<string, string> = {
  CHAIN1: '근거 추출',
  CHAIN2: '섹션 평가',
  CHAIN3: '초안 생성',
  CHAIN4: '부족 정보 탐지',
  CHAIN5: '질문 생성',
  CHAIN6: '답변 반영',
  CHAIN7: '최종 원고 생성'
};

function getChainLabel(chainName: string) {
  if (chainName.startsWith('REVIEW:')) return 'Review AI 검토';
  return CHAIN_LABELS[chainName] || chainName;
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 0) return '-';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatTokenUsage(log: ChainPerformanceLog) {
  if (!log.tokenUsage?.totalTokens) {
    return log.cacheHit ? '캐시 재사용' : '-';
  }
  return `${log.tokenUsage.totalTokens.toLocaleString()} tokens`;
}

function getSpeedClass(durationMs?: number) {
  if (!durationMs) return '';
  if (durationMs >= 5000) return 'chain-performance-item-slow';
  if (durationMs >= 2000) return 'chain-performance-item-warm';
  return '';
}

function getSpeedLabel(durationMs?: number) {
  if (!durationMs) return '';
  if (durationMs >= 5000) return '느린 단계';
  if (durationMs >= 2000) return '조금 오래 걸림';
  return '';
}

export default function ChainPerformancePanel({
  logs,
  title = '최근 처리 로그'
}: {
  logs?: ChainPerformanceLog[];
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const recentLogs = useMemo(() => [...(logs || [])].slice(-6).reverse(), [logs]);

  if (!recentLogs.length) return null;

  return (
    <div className="chain-performance-panel">
      <button
        type="button"
        className="chain-performance-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>{title}</span>
        <span>{isOpen ? '숨기기' : '보기'}</span>
      </button>

      {isOpen ? (
        <div className="chain-performance-list">
          {recentLogs.map((log, index) => {
            const speedLabel = getSpeedLabel(log.durationMs);
            return (
              <div
                key={`${log.chainName}-${log.startedAt}-${index}`}
                className={['chain-performance-item', getSpeedClass(log.durationMs)].join(' ').trim()}
              >
                <div className="chain-performance-top">
                  <strong>{getChainLabel(log.chainName)}</strong>
                  <span>{formatDuration(log.durationMs)}</span>
                </div>
                <div className="chain-performance-meta">
                  <span>{log.cacheHit ? '캐시 사용' : '새로 실행'}</span>
                  <span>{formatTokenUsage(log)}</span>
                  {speedLabel ? <span className="chain-performance-speed">{speedLabel}</span> : null}
                  {log.error ? <span className="chain-performance-error">오류 기록 있음</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
