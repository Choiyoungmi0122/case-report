/**
 * "원고 검사"(코드 검사) — studyWrite/manuscriptCheck.ts. 네트워크·DB·AI 를 쓰지 않는다.
 * 2026-10-12 임교수 테스트 6에서 사람이 찾은 문제 유형을 하나씩 넣어 잡히는지 본다.
 */
import assert from 'node:assert/strict';
import { checkManuscript, recordHerbDoses, recordVisits } from '../../src/studyWrite/manuscriptCheck';

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString();
const caseData = {
  visits: [0, 16, 24, 32, 141].map((n) => ({ date: day(n), soapText: '' })),
  deidentifiedEMRs: [
    { deidentifiedText: '첫 기록일에는 진료 내용이 기재되어 있지 않습니다.' },
    { deidentifiedText: '2-3일에 한번 두근거림. 잠을 3-4시간 자면 깬다.\n[첩약]\n황련온담탕 (생반하 9,복령 9,생강 7.5,황련 2,용안육 6,지실 0)' },
    { deidentifiedText: '약먹고 아랫배가 살살 아픈것 있음.' },
    { deidentifiedText: '황련온담탕 1차 (생반하 9,복령 9,생강 4,건강 2,황련 4.5)' },
    { deidentifiedText: '반하후박탕합생맥산 1차 (반하생강백반제 12,후박 6)' }
  ]
};
const section = (sectionId: string, draftText: string) => ({ sectionId, draftText, version: 1, history: [], chat: [], attachmentIds: [], careCheck: null });
const state: any = {
  rounds: [
    {
      roundNo: 9,
      kind: 'care_check',
      questions: [
        { id: 'q1', source: 'care_check', status: 'answered', text: '유침 시간은?', answer: '15분', targetSectionIds: ['THERAPEUTIC_INTERVENTIONS'], chatEntryId: 'c1', editHistory: [] }
      ]
    }
  ],
  sections: {
    THERAPEUTIC_INTERVENTIONS: section(
      'THERAPEUTIC_INTERVENTIONS',
      '(1) 첫 기록일 +16일: 황련온담탕을 투여하였다. 생반하 9, 복령 9 g, 생강을 4로 바꾸고 황련 3, 지실 0, 용안육 6(또는 0). 건식부항은 배수혈에 적용된 것으로 보인다. 첫 기록일 +20일에 다시 처방하였다. +24일~+29일에는 계속 복용하였다.'
    ),
    PATIENT_INFORMATION: section('PATIENT_INFORMATION', '환자는 68세 남성이다. 첫 기록일 +32일에 생활 습관을 바꾸었다.'),
    TIMELINE: section('TIMELINE', '첫 기록일 +141일 | 호전 | - | 반하후박탕(半夏厚朴湯)합생맥산 처방'),
    FOLLOW_UP_OUTCOMES: section('FOLLOW_UP_OUTCOMES', '이상반응으로 아랫배 통증이 있었다. [확인 필요: 그 외 이상반응 유무]'),
    ABSTRACT: section('ABSTRACT', '그 외의 이상반응은 없었다. 침 규격은 기록되지 않았다.'),
    PATIENT_PERSPECTIVE: section('PATIENT_PERSPECTIVE', '수면시간이 5시간 이상으로 늘어나는 것을 확인하고 싶다고 하였다. 부정맥이 시작되면 하루 종일 간다고 하였다.'),
    INTRODUCTION: section('INTRODUCTION', '배경이다. [문헌 보완 필요: 정의]')
  }
};

const visits = recordVisits(caseData);
assert.deepEqual(visits.map((v) => v.day), [0, 16, 24, 32, 141]);
const doses = recordHerbDoses(visits);
assert.ok(doses.pairs.has('생강 4') && doses.pairs.has('황련 4.5') && !doses.pairs.has('황련 3'));
assert.equal(doses.hasUnitG, false);

const findings = checkManuscript({ caseData, state });
const has = (kind: string, sectionId: string, re: RegExp) =>
  findings.some((f) => f.kind === kind && f.sectionId === sectionId && re.test(`${f.message} ${f.excerpt || ''}`));

// 약재 용량
assert.ok(has('dose', 'THERAPEUTIC_INTERVENTIONS', /황련 3"이 기록 첩약에 없습니다/), '기록에 없는 용량');
assert.ok(!has('dose', 'THERAPEUTIC_INTERVENTIONS', /생강 4"이 기록/), '"생강을 4로"는 기록에 있음');
assert.ok(has('dose', 'THERAPEUTIC_INTERVENTIONS', /양이 0인 약재 "지실 0"/), '0 약재');
assert.ok(has('dose', 'THERAPEUTIC_INTERVENTIONS', /\(또는 0\)/), '(또는 0)');
assert.ok(has('unit', 'THERAPEUTIC_INTERVENTIONS', /복령 9 g/), '기록에 없는 단위 g');
// 날짜
assert.ok(has('date', 'THERAPEUTIC_INTERVENTIONS', /\+20일은 기록의 방문일이 아닙니다/), '방문일이 아닌 날짜');
assert.ok(!has('date', 'THERAPEUTIC_INTERVENTIONS', /\+29일/), '범위의 끝은 보지 않음');
// 시점
assert.ok(has('timing', 'PATIENT_INFORMATION', /초진\(첫 기록일 \+16일\) 이후인 \+32일/), '환자 정보에 초진 이후');
// 처방명
assert.ok(has('formula', 'TIMELINE', /"반하후박탕"은 기록에 없고, 기록의 처방명은 "반하후박탕합생맥산"/), '처방명 앞부분만');
// 추측·부재
assert.ok(has('speculation', 'THERAPEUTIC_INTERVENTIONS', /것으로 보인다/), '추측 표현');
assert.ok(has('absence', 'ABSTRACT', /기록되지 않았다/), '부재 문장');
// 이상반응 일관성
assert.ok(has('consistency', 'ABSTRACT', /추적 관찰 및 결과에서는 그 밖의 이상반응을 \[확인 필요\]/), '이상반응 단정');
// 환자 관점
assert.ok(has('voice', 'PATIENT_PERSPECTIVE', /확인하고 싶다/), '임상의 계획이 환자 말로');
assert.ok(!has('voice', 'PATIENT_PERSPECTIVE', /부정맥이 시작되면/), '"부정맥"은 진찰 소견이 아님');
// 표시·추가 답
assert.ok(has('marker', 'INTRODUCTION', /"문헌 보완 필요" 표시가 1곳/));
assert.ok(has('added_answer', 'THERAPEUTIC_INTERVENTIONS', /수정 요청 · AI 질문/));
// 정렬: 오류 먼저
assert.equal(findings[0].severity, 'error');

console.log(`manuscriptCheck tests passed (${findings.length} findings)`);
