/**
 * LLM 사용량 기록(backend/data/llm_usage.jsonl)에 사례 id 를 남기기 위한 요청 단위 문맥 (2026-10-12).
 *
 * 체인 함수의 인자를 바꾸지 않고, 요청이 시작될 때 만든 문맥이 그 요청에서 이어지는 모든 비동기 작업
 * (응답 뒤에 계속 도는 처리·최종 원고 작업 포함)에 따라간다(Node AsyncLocalStorage). 사용량 기록 함수가 이 문맥을 읽는다.
 * 기록만 하는 용도이며, 동작에는 영향을 주지 않는다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type UsageContext = {
  caseId?: string;
  manuscriptReviewId?: string;
};

const storage = new AsyncLocalStorage<UsageContext>();

export function getUsageContext(): UsageContext | undefined {
  return storage.getStore();
}

export function runWithUsageContext<T>(context: UsageContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

/**
 * 경로만으로 사례 id 를 알 수 없는 곳(처리 함수 등)에서 사례 id 를 채운다. 이미 있으면 바꾸지 않는다.
 * 요청 문맥 밖이면 아무것도 하지 않는다.
 */
export function setUsageCaseId(caseId: string | undefined): void {
  const store = storage.getStore();
  if (store && caseId && !store.caseId) store.caseId = caseId;
}

/** /api/cases 아래에서 사례 id 가 아닌 첫 경로 조각 */
const CASE_ROUTE_RESERVED = new Set(['study']);

/** 요청 경로에서 사례 id 를 읽는다. 쿼리 문자열은 무시한다. */
export function usageContextFromPath(originalUrl: string): UsageContext {
  const pathname = String(originalUrl || '').split('?')[0];
  const segments = pathname.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (segments[0] !== 'api') return {};
  // /api/cases/:id/...
  if (segments[1] === 'cases' && segments[2] && !CASE_ROUTE_RESERVED.has(segments[2])) {
    return { caseId: segments[2] };
  }
  // /api/study-write/cases/:caseId/...
  if (segments[1] === 'study-write' && segments[2] === 'cases' && segments[3]) {
    return { caseId: segments[3] };
  }
  // /api/manuscript-review/:id/... (원고 검토는 사례가 아니라 검토 문서 id)
  if (segments[1] === 'manuscript-review' && segments[2] && segments[2] !== 'import') {
    return { manuscriptReviewId: segments[2] };
  }
  return {};
}

/** 모든 /api 요청에 문맥을 만든다. 경로에 사례 id 가 없어도 문맥은 만들어 setUsageCaseId 로 채울 수 있게 한다. */
export function usageContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  runWithUsageContext(usageContextFromPath(req.originalUrl || req.url), () => next());
}
