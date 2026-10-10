import fs from 'fs';
import path from 'path';
import { DEFAULT_STUDY_CASE } from '../study/cases/defaultStudyCase';

/**
 * 실험용 Write 의 "실험 사례 불러오기" 목록.
 *
 * - 가상환자(68세 여, 한방신경정신과)는 코드에 들어 있다.
 * - 전문가 기록은 backend/data/study-write-presets/*.json 에서 읽는다 (backend/.gitignore 의 data/ 로 git 에 올라가지 않음). 실제 환자의
 *   익명 기록이므로 git 에 올리지 않고(docs/study_write_presets_README.md 참고) 실험 컴퓨터에만 둔다.
 *   JSON 은 scripts/buildStudyWritePreset.ts 로 만든다.
 * - 어느 경우든 방문 기록만 돌려준다. 분석 결과·AI 초안은 새로 만든다.
 */

export interface StudyWritePresetVisit {
  /** 'YYYY-MM-DDTHH:mm'. 상대 날짜 프리셋은 기준일 + 일수 (실제 날짜 아님) */
  date: string;
  type: '초진' | '재진';
  soapText: string;
  /** 상대 날짜 프리셋: 첫 기록일 기준 일수 */
  dayOffset?: number;
}

export interface StudyWritePreset {
  id: string;
  label: string;
  specialty: string;
  relativeDates: boolean;
  visitCount: number;
  visits: StudyWritePresetVisit[];
}

const PRESET_DIR = path.resolve(__dirname, '../../data/study-write-presets');

function virtualPatientPreset(): StudyWritePreset {
  const visits = DEFAULT_STUDY_CASE.visits.map((visit: any, index: number) => ({
    date: visit.date,
    type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
    soapText: visit.soapText || ''
  }));
  return {
    id: 'virtual-68f-neuropsychiatry',
    label: '가상환자 (68세 여, 한방신경정신과)',
    specialty: '한방신경정신과',
    relativeDates: false,
    visitCount: visits.length,
    visits
  };
}

function addDays(anchor: string, days: number): string {
  const base = new Date(`${anchor}T09:00:00`);
  base.setDate(base.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T09:00`;
}

function readFilePresets(): StudyWritePreset[] {
  if (!fs.existsSync(PRESET_DIR)) return [];
  return fs
    .readdirSync(PRESET_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, name), 'utf8'));
        const anchor = typeof raw.anchorDate === 'string' ? raw.anchorDate : '2025-01-01';
        const visits: StudyWritePresetVisit[] = (raw.visits || []).map((visit: any, index: number) => ({
          date: raw.relativeDates ? addDays(anchor, Number(visit.dayOffset) || 0) : String(visit.date || ''),
          type: index === 0 ? '초진' : '재진',
          soapText: String(visit.text || ''),
          dayOffset: raw.relativeDates ? Number(visit.dayOffset) || 0 : undefined
        }));
        return {
          id: String(raw.id || name.replace(/\.json$/, '')),
          label: String(raw.label || name),
          specialty: String(raw.specialty || ''),
          relativeDates: Boolean(raw.relativeDates),
          visitCount: visits.length,
          visits
        } as StudyWritePreset;
      } catch (error) {
        console.error(`[study-write] preset ${name} could not be read`, error);
        return null;
      }
    })
    .filter((preset): preset is StudyWritePreset => Boolean(preset));
}

export function listStudyWritePresets(): Array<Omit<StudyWritePreset, 'visits'>> {
  return [virtualPatientPreset(), ...readFilePresets()].map(({ visits: _visits, ...rest }) => rest);
}

export function getStudyWritePreset(id: string): StudyWritePreset | null {
  const all = [virtualPatientPreset(), ...readFilePresets()];
  return all.find((preset) => preset.id === id) || null;
}
