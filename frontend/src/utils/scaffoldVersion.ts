import type { CaseMode, VersionMetadata } from '../services/api';
import { STUDY_SECTION_IDS, STUDY_SECTION_IDS_V2 } from './scaffoldUi';

/**
 * 연구에서 "Scaffold V2"(교수 평가, 학생 후속)로 부르는 교육용 Scaffold의 시스템 버전 값.
 * 학생 V1(S1~S10) 기록이 이미 scaffoldVersion 'v2.0'으로 저장되어 있어 같은 값을 쓸 수 없다.
 * 백엔드 config/researchMetadata.ts의 STUDY_SCAFFOLD_V2_VERSION과 같아야 한다.
 */
export const STUDY_SCAFFOLD_V2_VERSION = 'v3.0';

/** 학생 V1 실험 코드 형식(S1, S3-1 …). V2 진입에서 거부한다. */
export const STUDENT_V1_CODE_PATTERN = /^S\d+(-\d+)?$/i;

/** 진입 버튼이 정하는 Scaffold 버전. 'v1'은 기존 "실험용 Scaffold 시작", 'v2'는 "실험용 Scaffold V2 시작". */
export type ScaffoldEntryVersion = 'v1' | 'v2';

/** localStorage 세션 키 범위. V1과 V2가 같은 기기에서 세션 id를 물려받지 않게 분리한다. */
export type ResearchStorageScope = CaseMode | 'scaffold-v2';

export function getResearchStorageScope(mode: CaseMode, version: ScaffoldEntryVersion = 'v1'): ResearchStorageScope {
  return mode === 'scaffold' && version === 'v2' ? 'scaffold-v2' : mode;
}

export function isScaffoldV2Version(version?: string | null) {
  return String(version || '') === STUDY_SCAFFOLD_V2_VERSION;
}

type HasVersionMetadata = { versionMetadata?: VersionMetadata | null } | null | undefined;

/** 서버가 돌려준 케이스 데이터가 Scaffold V2 실험 케이스인지. 화면 분기는 이 값으로만 한다. */
export function isScaffoldV2Data(data: HasVersionMetadata) {
  return isScaffoldV2Version(data?.versionMetadata?.scaffoldVersion);
}

export function getStudySectionIdsForVersion(version?: string | null) {
  return isScaffoldV2Version(version) ? STUDY_SECTION_IDS_V2 : STUDY_SECTION_IDS;
}

/** 실험용 경로에서 다룰 CARE 항목. 케이스의 저장 버전에 따라 V1(2개) 또는 V2(치료 개입만)를 돌려준다. */
export function getStudySectionIds(data: HasVersionMetadata) {
  return getStudySectionIdsForVersion(data?.versionMetadata?.scaffoldVersion);
}

/**
 * Scaffold V2 케이스를 만들 때 생성 요청 metadata에 붙이는 값.
 * - versionMetadata.scaffoldVersion: 서버 기본값(v2.0) 대신 v3.0을 저장한다.
 * - studyConfig.studyMode: 서버 공개 게이트를 켠다(V1은 꺼진 채 진행됐다).
 */
export function buildScaffoldV2CaseMetadata(participantCode?: string) {
  return {
    versionMetadata: { scaffoldVersion: STUDY_SCAFFOLD_V2_VERSION },
    studyConfig: {
      studyMode: true,
      condition: 'scaffold' as CaseMode,
      participantCode: participantCode || undefined,
      lockedMode: true,
      fixedCase: true
    }
  };
}
