import assert from 'assert';
import * as XLSX from 'xlsx';
import {
  buildVisitsFromRows,
  formatDateValue,
  inspectWorkbook,
  splitTextIntoVisits,
  toVisitDateTime
} from '../../src/studyWrite/recordImport';

function makeWorkbook(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '진료기록');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// 날짜 셀 읽기
assert.strictEqual(formatDateValue('2026-03-11'), '2026-03-11');
assert.strictEqual(formatDateValue('2026.3.11'), '2026-03-11');
assert.strictEqual(formatDateValue('2026년 3월 11일'), '2026-03-11');
assert.strictEqual(formatDateValue('2026-03-11 14:00'), '2026-03-11T14:00');
assert.strictEqual(formatDateValue('초진'), undefined);
assert.strictEqual(toVisitDateTime('2026-03-11'), '2026-03-11T09:00');
assert.strictEqual(toVisitDateTime(''), '');

// 엑셀: 머리글, 날짜 열 추정, 행 문자열화
const workbook = inspectWorkbook(
  makeWorkbook([
    ['내원일', '주소증', '처치'],
    ['2026-03-11', '불면', '황련해독탕'],
    ['2026-03-11', '', '침'],
    ['2026-03-13', '화', '약침'],
    ['', '', '']
  ]),
  'test.xlsx'
);
assert.strictEqual(workbook.kind, 'xlsx');
if (workbook.kind === 'xlsx') {
  const sheet = workbook.sheets[0];
  assert.deepStrictEqual(sheet.headers, ['내원일', '주소증', '처치']);
  assert.strictEqual(sheet.guessedDateColumn, 0);
  assert.strictEqual(sheet.rowCount, 3, '빈 행은 세지 않는다');

  const visits = buildVisitsFromRows({
    headers: sheet.headers,
    rows: sheet.rows,
    dateColumn: 0,
    textColumns: [1, 2],
    mergeSameDate: true
  });
  assert.strictEqual(visits.length, 2, '같은 날짜 행은 합쳐진다');
  assert.strictEqual(visits[0].date, '2026-03-11T09:00');
  assert.ok(visits[0].soapText.includes('주소증: 불면'));
  assert.ok(visits[0].soapText.includes('처치: 침'), '두 번째 행의 처치가 첫 방문에 합쳐진다');
  assert.strictEqual(visits[1].date, '2026-03-13T09:00');

  const separate = buildVisitsFromRows({
    headers: sheet.headers,
    rows: sheet.rows,
    dateColumn: 0,
    textColumns: [2],
    mergeSameDate: false
  });
  assert.strictEqual(separate.length, 3);
  assert.strictEqual(separate[0].soapText, '황련해독탕', '열이 하나면 열 이름을 붙이지 않는다');
}

// 글: 연도가 있는 날짜 줄로 나누기
const full = splitTextIntoVisits(
  ['초진 2026-03-11', '불면, 화병', '황련해독탕 2주', '', '재진 2026.03.13', '약침, 침', '2026년 3월 18일', '맥긴'].join('\n')
);
assert.strictEqual(full.splitBy, 'full_date');
assert.strictEqual(full.visits.length, 3);
assert.strictEqual(full.visits[0].date, '2026-03-11T09:00');
assert.ok(full.visits[0].soapText.includes('황련해독탕 2주'));
assert.strictEqual(full.visits[2].date, '2026-03-18T09:00');

// 글: 월/일만 있는 줄
const monthDay = splitTextIntoVisits(['3/11 초진', '불면', '3/13 재진', '약침'].join('\n'));
assert.strictEqual(monthDay.splitBy, 'month_day');
assert.strictEqual(monthDay.visits.length, 2);
assert.ok(monthDay.visits[0].date.endsWith('-03-11T09:00'));

// 글: 날짜 줄이 없으면 한 덩어리. 본문 속 날짜("3/11분 다 복용함")는 경계가 아니다.
const none = splitTextIntoVisits(['진단명', '불면증', '황련해독탕 3/11분 다 복용함.'].join('\n'));
assert.strictEqual(none.splitBy, 'none');
assert.strictEqual(none.visits.length, 1);

// 날짜 줄이 하나뿐이고 그 앞에 글이 있으면 앞부분은 날짜 없는 방문이 된다
const leading = splitTextIntoVisits(['환자 정보', '68세 여자', '2026-03-11', '초진 기록'].join('\n'));
assert.strictEqual(leading.visits.length, 2);
assert.strictEqual(leading.visits[0].date, '');

console.log('study write record import tests passed');
