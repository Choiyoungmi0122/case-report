import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getReadOnlyViewCaseId,
  startReadOnlyView,
  stopReadOnlyView
} from '../utils/readOnlyView';

/**
 * 다시 보기 모드의 진입/해제와 화면 잠금을 맡는다.
 * - `?readonly=1`로 케이스 화면에 들어오면 그 케이스를 다시 보기 대상으로 기억한다.
 * - 대상 케이스 화면을 벗어나면 모드를 해제한다.
 * - 모드가 켜져 있는 동안 입력란 수정과 선택 변경을 막고 안내 띠를 띄운다.
 *   (화면 이동 버튼은 그대로 동작하고, 저장은 API 계층과 서버가 막는다.)
 */
export default function ReadOnlyViewGuard() {
  const location = useLocation();
  const navigate = useNavigate();
  // Decided during the first render, before any page effect can send a request.
  const [activeCaseId, setActiveCaseId] = useState<string | null>(() => {
    const pathCaseId = window.location.pathname.match(/\/cases\/([^/]+)/)?.[1] || null;
    if (pathCaseId && new URLSearchParams(window.location.search).get('readonly') === '1') {
      startReadOnlyView(pathCaseId);
    }
    return getReadOnlyViewCaseId();
  });

  useEffect(() => {
    const pathCaseId = location.pathname.match(/\/cases\/([^/]+)/)?.[1] || null;
    const requested = new URLSearchParams(location.search).get('readonly') === '1';

    if (requested && pathCaseId) {
      startReadOnlyView(pathCaseId);
    } else if (getReadOnlyViewCaseId() && getReadOnlyViewCaseId() !== pathCaseId) {
      stopReadOnlyView();
    }
    setActiveCaseId(getReadOnlyViewCaseId());
  }, [location.pathname, location.search]);

  // 안내 띠는 화면 아래쪽을 가리므로 닫을 수 있게 한다. 닫아도 다시 보기 모드(편집
  // 차단)는 그대로이고, 구석의 작은 표시로 다시 열 수 있다.
  const [bannerOpen, setBannerOpen] = useState(true);

  useEffect(() => {
    if (!activeCaseId) return undefined;

    const blockEdit = (event: Event) => {
      event.preventDefault();
    };
    const blockChoice = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const control = target.closest('input[type="checkbox"], input[type="radio"], select, label');
      if (!control) return;
      if (control.tagName === 'LABEL' && !control.querySelector('input, select') && !(control as HTMLLabelElement).htmlFor) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    // Keep the page's own bottom buttons clear of the fixed notice bar.
    const previousPadding = document.body.style.paddingBottom;
    document.body.style.paddingBottom = bannerOpen ? '56px' : previousPadding;

    document.addEventListener('beforeinput', blockEdit, true);
    document.addEventListener('paste', blockEdit, true);
    document.addEventListener('drop', blockEdit, true);
    document.addEventListener('click', blockChoice, true);
    document.addEventListener('mousedown', blockChoice, true);
    return () => {
      document.body.style.paddingBottom = previousPadding;
      document.removeEventListener('beforeinput', blockEdit, true);
      document.removeEventListener('paste', blockEdit, true);
      document.removeEventListener('drop', blockEdit, true);
      document.removeEventListener('click', blockChoice, true);
      document.removeEventListener('mousedown', blockChoice, true);
    };
  }, [activeCaseId, bannerOpen]);

  if (!activeCaseId) return null;

  if (!bannerOpen) {
    return (
      <button
        type="button"
        onClick={() => setBannerOpen(true)}
        title="다시 보기 모드 안내 열기"
        style={{
          position: 'fixed',
          right: 12,
          bottom: 12,
          zIndex: 9999,
          padding: '4px 10px',
          borderRadius: 999,
          border: 'none',
          background: 'rgba(31, 39, 51, 0.75)',
          color: '#fff',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        다시 보기 모드
      </button>
    );
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '10px 16px',
        background: '#1f2733',
        color: '#fff',
        fontSize: 14
      }}
    >
      <span>
        <strong>다시 보기 모드</strong> · 참가자가 보던 화면을 그대로 보여줍니다. 수정하거나 눌러도 이
        참가자의 기록은 바뀌지 않습니다.
      </span>
      <button
        type="button"
        onClick={() => {
          stopReadOnlyView();
          setActiveCaseId(null);
          navigate('/research/history');
        }}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid #fff',
          background: 'transparent',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 14
        }}
      >
        조회 화면으로 돌아가기
      </button>
      <button
        type="button"
        aria-label="안내 닫기"
        onClick={() => setBannerOpen(false)}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 14
        }}
      >
        닫기 ✕
      </button>
    </div>
  );
}
