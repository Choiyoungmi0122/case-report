import { useEffect, useMemo, useState } from 'react';
import { caseApi, PendingTermConfirmation, PendingTermMutationResponse } from '../services/api';
import {
  formatPendingTermHeadline,
  getPendingTermStatusClass,
  getPendingTermStatusLabel
} from '../utils/caseStatusUi';
import './PendingTermConfirmationModal.css';

type PendingTermConfirmationModalProps = {
  caseId: string;
  isOpen: boolean;
  onClose: () => void;
  onResolved: (result: PendingTermMutationResponse) => Promise<void> | void;
  pendingTerms: PendingTermConfirmation[];
};

export default function PendingTermConfirmationModal({
  caseId,
  isOpen,
  onClose,
  onResolved,
  pendingTerms
}: PendingTermConfirmationModalProps) {
  const [customReplacementByPendingId, setCustomReplacementByPendingId] = useState<Record<string, string>>({});
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const visibleTerms = useMemo(
    () => pendingTerms.filter((item) => item.status === 'PENDING'),
    [pendingTerms]
  );

  useEffect(() => {
    if (!isOpen) {
      setCustomReplacementByPendingId({});
      setPendingActionId(null);
      setErrorMessage(null);
      setFeedbackMessage(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingActionId) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, pendingActionId]);

  const handleConfirm = async (item: PendingTermConfirmation, confirmedTerm?: string) => {
    setPendingActionId(item.pendingId);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const result = await caseApi.confirmPendingTerm(caseId, item.pendingId, confirmedTerm);
      await onResolved(result);
      setFeedbackMessage(
        result.blocked
          ? '전문용어 확인 결과는 반영되었지만 개인정보 검토가 필요해 처리가 차단되었습니다.'
          : result.httpStatus === 202
            ? '전문용어 확인 결과를 저장했고, 지금 반영 중입니다.'
            : '전문용어 확인 결과를 반영해 케이스를 다시 처리했습니다.'
      );
    } catch (error: any) {
      setErrorMessage(error?.message || '전문용어 확인 결과를 저장하지 못했습니다.');
    } finally {
      setPendingActionId(null);
    }
  };

  const handleReject = async (item: PendingTermConfirmation) => {
    setPendingActionId(item.pendingId);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const customReplacement = (customReplacementByPendingId[item.pendingId] || '').trim();
      const result = await caseApi.rejectPendingTerm(
        caseId,
        item.pendingId,
        customReplacement || undefined
      );
      setCustomReplacementByPendingId((prev) => ({ ...prev, [item.pendingId]: '' }));
      await onResolved(result);
      setFeedbackMessage(
        result.blocked
          ? '입력한 용어는 반영되었지만 개인정보 검토가 필요해 처리가 차단되었습니다.'
          : result.httpStatus === 202
            ? '용어 선택을 저장했고, 지금 반영 중입니다.'
            : customReplacement
              ? '직접 입력한 용어를 반영해 케이스를 다시 처리했습니다.'
              : '원문 유지로 처리하고 케이스를 다시 처리했습니다.'
      );
    } catch (error: any) {
      setErrorMessage(error?.message || '전문용어 처리 결과를 저장하지 못했습니다.');
    } finally {
      setPendingActionId(null);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="pending-term-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pending-term-modal-title"
      onClick={() => {
        if (!pendingActionId) {
          onClose();
        }
      }}
    >
      <div className="pending-term-modal" onClick={(event) => event.stopPropagation()}>
        <div className="pending-term-modal-header">
          <div>
            <h2 id="pending-term-modal-title">전문용어 확인</h2>
            <p>
              애매한 전문용어는 확인되기 전까지 draft와 최종 원고에 자동 반영되지 않습니다.
              아래 후보를 선택하거나 직접 입력해 주세요.
            </p>
          </div>
          <button
            type="button"
            className="pending-term-modal-close"
            onClick={onClose}
            disabled={Boolean(pendingActionId)}
            aria-label="전문용어 확인 창 닫기"
          >
            ×
          </button>
        </div>

        {errorMessage ? <div className="pending-term-modal-error">{errorMessage}</div> : null}
        {feedbackMessage ? <div className="pending-term-modal-success">{feedbackMessage}</div> : null}

        {visibleTerms.length === 0 ? (
          <div className="pending-term-modal-empty">현재 확인이 필요한 전문용어가 없습니다.</div>
        ) : (
          <div className="pending-term-modal-list">
            {visibleTerms.map((item) => {
              const customReplacement = customReplacementByPendingId[item.pendingId] || '';
              const isBusy = pendingActionId === item.pendingId;
              const defaultCandidate =
                item.candidates?.[0]?.standardTerm || item.normalizedTerm || '';

              return (
                <div key={item.pendingId} className="pending-term-modal-card">
                  <div className="pending-term-modal-card-top">
                    <div>
                      <div className="pending-term-modal-headline">
                        {formatPendingTermHeadline(item)}
                      </div>
                      <div className="pending-term-modal-meta">
                        방문 {item.visitIndex} · {item.category} · confidence {item.confidence.toFixed(2)}
                      </div>
                    </div>
                    <span
                      className={`pending-term-modal-status ${getPendingTermStatusClass(item.status)}`}
                    >
                      {getPendingTermStatusLabel(item.status)}
                    </span>
                  </div>

                  <div className="pending-term-modal-source">원문: {item.sourceText}</div>

                  {item.candidates?.length ? (
                    <div className="pending-term-modal-candidates">
                      {item.candidates.map((candidate) => (
                        <button
                          key={`${item.pendingId}-${candidate.termId}`}
                          type="button"
                          className="pending-term-modal-chip"
                          disabled={isBusy}
                          onClick={() => handleConfirm(item, candidate.standardTerm)}
                        >
                          {candidate.standardTerm} ({candidate.confidence.toFixed(2)})
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="pending-term-modal-actions">
                    <input
                      type="text"
                      className="pending-term-modal-input"
                      value={customReplacement}
                      onChange={(event) =>
                        setCustomReplacementByPendingId((prev) => ({
                          ...prev,
                          [item.pendingId]: event.target.value
                        }))
                      }
                      placeholder="직접 사용할 용어를 입력할 수 있습니다."
                    />

                    <div className="pending-term-modal-action-row">
                      <button
                        type="button"
                        className="pending-term-modal-confirm"
                        disabled={isBusy || !(customReplacement.trim() || defaultCandidate)}
                        onClick={() =>
                          handleConfirm(item, customReplacement.trim() || defaultCandidate)
                        }
                      >
                        {isBusy ? '처리 중...' : '이 용어로 승인'}
                      </button>
                      <button
                        type="button"
                        className="pending-term-modal-reject"
                        disabled={isBusy}
                        onClick={() => handleReject(item)}
                      >
                        {customReplacement.trim() ? '직접 입력 적용' : '원문 유지 / 거절'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
