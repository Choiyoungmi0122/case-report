import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaseMode } from '../services/api';
import {
  getStoredParticipantCode,
  resetResearchSession,
  setResearchParticipantCode
} from '../utils/research';

type StudyEntryPageProps = {
  mode: CaseMode;
};

function normalizeScaffoldExperimentCode(value: string) {
  const raw = value.trim();
  if (!raw) return '';

  const compact = raw.replace(/-/g, '').toUpperCase();
  const match = compact.match(/^SQ0*(\d+)$/);
  if (!match) {
    const customCode = raw.replace(/\s+/g, ' ').toUpperCase();
    return /^[A-Z0-9가-힣][A-Z0-9가-힣_\- ]{0,63}$/.test(customCode) ? customCode : '';
  }

  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return '';
  return `SQ${String(number).padStart(3, '0')}`;
}

export default function StudyEntryPage({ mode }: StudyEntryPageProps) {
  const navigate = useNavigate();
  const [participantCode, setParticipantCode] = useState(() => getStoredParticipantCode(mode));
  const [studyGroup, setStudyGroup] = useState<'expert' | 'novice' | ''>('');
  const [phase, setPhase] = useState<'pilot' | 'main' | 'followup' | ''>('main');
  const [sessionNo, setSessionNo] = useState('1');
  const [participationMode, setParticipationMode] = useState<'online' | 'offline' | ''>('');
  const [error, setError] = useState<string | null>(null);

  const isScaffold = mode === 'scaffold';
  const codeLabel = isScaffold ? '실험번호' : '참가자 코드';
  const normalizedScaffoldCode = isScaffold
    ? normalizeScaffoldExperimentCode(participantCode)
    : participantCode.trim();

  const navigateToInput = (codeToUse = isScaffold ? normalizedScaffoldCode : participantCode.trim()) => {
    const parsedSessionNo = Number(sessionNo);
    const state = {
      participantCode: codeToUse,
      experimentCode: isScaffold ? codeToUse : undefined,
      studyMetadata: {
        studyGroup: isScaffold ? undefined : studyGroup || undefined,
        phase: isScaffold ? undefined : phase || undefined,
        sessionNo:
          !isScaffold && Number.isFinite(parsedSessionNo) && parsedSessionNo > 0
            ? parsedSessionNo
            : undefined,
        participationMode: participationMode || undefined
      }
    };

    if (isScaffold) {
      navigate('/study/scaffold/input', { state });
      return;
    }

    navigate('/study/write/input', { state });
  };

  const handleEnterCode = async () => {
    const trimmedCode = participantCode.trim();
    if (!trimmedCode) {
      setError(`${codeLabel}를 입력해 주세요.`);
      return;
    }

    if (isScaffold && !normalizedScaffoldCode) {
      setError('실험번호는 SQ005, SQ-005, test-01처럼 영문, 숫자, 하이픈, 언더스코어로 입력해 주세요.');
      return;
    }

    if (!isScaffold && !studyGroup) {
      setError('연구 그룹을 선택해 주세요.');
      return;
    }

    if (!participationMode) {
      setError('참여 방식을 선택해 주세요.');
      return;
    }

    const codeToStore = isScaffold ? normalizedScaffoldCode : trimmedCode;
    setError(null);
    setParticipantCode(codeToStore);
    // 같은 기기에서 다음 참여자가 시작하면 이전 참여자의 sessionId를 물려받지 않도록
    // 코드가 바뀔 때 세션을 새로 만든다. 같은 코드로 다시 들어오면 기존 세션을 유지한다.
    if (getStoredParticipantCode(mode) !== codeToStore) {
      resetResearchSession(mode);
    }
    setResearchParticipantCode(mode, codeToStore);
    navigateToInput(codeToStore);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f7fb', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' }}>
        <h1 style={{ marginTop: 0, marginBottom: 8, color: '#17324d' }}>
          {isScaffold ? 'Study Scaffold' : 'Study Write'}
        </h1>
        <p style={{ marginTop: 0, marginBottom: 20, color: '#4a5d73', lineHeight: 1.7 }}>
          {isScaffold
            ? '배정받은 Scaffold 실험번호를 입력하고 시작하세요. SQ005 또는 test-01 같은 번호를 사용할 수 있습니다.'
            : '참가자 코드를 입력하여 실험을 시작하세요.'}
        </p>

        <label style={{ display: 'block', fontWeight: 700, color: '#17324d', marginBottom: 8 }}>
          {codeLabel}
        </label>
        <input
          type="text"
          value={participantCode}
          onChange={(event) => setParticipantCode(event.target.value)}
          placeholder={isScaffold ? '예: T01, 홍길동, 홍길동 1' : '예: E01'}
          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #c8d2dd', marginBottom: 12 }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleEnterCode();
            }
          }}
        />

        <div style={{ display: 'grid', gap: 10, margin: '8px 0 14px' }}>
          {!isScaffold ? (
            <>
              <label style={styles.fieldLabel}>Study group</label>
              <select value={studyGroup} onChange={(event) => setStudyGroup(event.target.value as any)} style={styles.select}>
                <option value="">Unset</option>
                <option value="novice">novice</option>
                <option value="expert">expert</option>
              </select>
              <label style={styles.fieldLabel}>Phase</label>
              <select value={phase} onChange={(event) => setPhase(event.target.value as any)} style={styles.select}>
                <option value="">Unset</option>
                <option value="pilot">pilot</option>
                <option value="main">main</option>
                <option value="followup">followup</option>
              </select>
            </>
          ) : null}
          {!isScaffold ? (
            <>
              <label style={styles.fieldLabel}>Session No.</label>
              <input
                type="number"
                min={1}
                value={sessionNo}
                onChange={(event) => setSessionNo(event.target.value)}
                style={styles.select}
              />
            </>
          ) : null}
          <label style={styles.fieldLabel}>Participation mode</label>
          <select
            value={participationMode}
            onChange={(event) => setParticipationMode(event.target.value as any)}
            style={styles.select}
          >
            <option value="">Unset</option>
            <option value="offline">offline</option>
            <option value="online">online</option>
          </select>
        </div>

        {error ? <div style={{ color: '#b42318', marginBottom: 12 }}>{error}</div> : null}

        <button
          type="button"
          onClick={() => void handleEnterCode()}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: 10,
            padding: '12px 16px',
            background: isScaffold ? '#23663a' : '#1d4f91',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          기록 입력하기
        </button>
      </div>
    </div>
  );
}

const styles = {
  fieldLabel: {
    display: 'block',
    fontWeight: 700,
    color: '#17324d',
    fontSize: 13
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #c8d2dd'
  }
} as const;
