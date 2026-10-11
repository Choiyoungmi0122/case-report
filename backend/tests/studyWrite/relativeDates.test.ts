import assert from 'node:assert/strict';
import { convertRelativeDates, toRawOffset, parseAnchorDate } from '../../src/studyWrite/relativeDates';

function run() {
  const iso = { date: '2025-03-02', format: 'iso' as const };
  const ko = { date: '2025-03-02', format: 'ko' as const };
  const conv = (text: string, anchor: any = iso) => convertRelativeDates(text, anchor).text;

  // 단일
  assert.equal(conv('첫 기록일 +18일 | 증상 지속'), '2025-03-20 | 증상 지속');
  assert.equal(conv('+32일에는 맥완 소견'), '2025-04-03에는 맥완 소견');
  assert.equal(conv('첫 기록일 | 초진'), '2025-03-02 | 초진');
  assert.equal(conv('첫 기록일 이후 16일째 방문에서'), '2025-03-18 방문에서');
  assert.equal(conv('첫 기록일부터 +141일까지'), '2025-03-02부터 2025-07-21까지');
  // 범위
  assert.equal(conv('첫 기록일 +18일~+29일 | 동일 치료'), '2025-03-20~2025-03-31 | 동일 치료');
  assert.equal(conv('+24~+29일에 아랫배 통증'), '2025-03-26~2025-03-31에 아랫배 통증');
  assert.equal(conv('+99~102일 상을 치르며'), '2025-06-09~2025-06-12 상을 치르며');
  assert.equal(conv('첫 기록일 +99~102일'), '2025-06-09~2025-06-12');
  // 한국어 형식, 같은 해는 뒤쪽 연도 생략
  assert.equal(conv('첫 기록일 +18일~+29일', ko), '2025년 3월 20일~3월 31일');
  assert.equal(conv('+300~+310일', ko), '2025년 12월 27일~2026년 1월 6일');
  assert.equal(conv('+32일', ko), '2025년 4월 3일');
  // 바꾸지 않는 것
  assert.equal(conv('96~98일 후 매우 좋았다'), '96~98일 후 매우 좋았다');
  assert.equal(conv('16일째 방문'), '16일째 방문');
  assert.equal(conv('+10일분 추가 처방'), '+10일분 추가 처방');
  assert.equal(conv('+3일간 복용'), '+3일간 복용');
  assert.equal(conv('A+3일'), 'A+3일');
  assert.equal(conv('2-3일에 한 번 두근거림'), '2-3일에 한 번 두근거림');
  assert.equal(conv('두통 20% 경감'), '두통 20% 경감');
  // 기준일이 없거나 잘못되면 그대로
  assert.equal(conv('첫 기록일 +18일', null), '첫 기록일 +18일');
  assert.equal(conv('첫 기록일 +18일', { date: '2025-02-30', format: 'iso' }), '첫 기록일 +18일');
  assert.equal(parseAnchorDate('2025-13-01'), null);
  // 윤년·월 넘김
  assert.equal(conv('+1일', { date: '2024-02-28', format: 'iso' }), '2024-02-29');
  assert.equal(conv('+1일', { date: '2025-02-28', format: 'iso' }), '2025-03-01');

  // 위치 되돌리기: 바꾼 글의 선택 범위 → 원문 범위
  const raw = '초진 후 +18일에 두통 20% 경감. +24~+29일에는 아랫배 통증.';
  const c = convertRelativeDates(raw, iso);
  const selected = '2025-03-20에 두통';
  const outStart = c.text.indexOf(selected);
  const rs = toRawOffset(c, outStart, 'start');
  const re = toRawOffset(c, outStart + selected.length, 'end');
  assert.equal(raw.slice(rs, re), '+18일에 두통');
  const tail = '아랫배 통증.';
  const ts = c.text.indexOf(tail);
  assert.equal(raw.slice(toRawOffset(c, ts, 'start'), toRawOffset(c, ts + tail.length, 'end')), tail);
  // 선택이 날짜 중간에서 시작하면 그 날짜 전체로 넓힌다
  const mid = c.text.indexOf('03-20');
  assert.equal(raw.slice(toRawOffset(c, mid, 'start'), toRawOffset(c, mid + 5, 'end')), '+18일');

  console.log('relativeDates tests passed');
}

run();
