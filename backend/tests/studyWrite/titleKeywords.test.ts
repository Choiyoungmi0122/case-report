/**
 * 제목 섹션의 제목·핵심 단어 나누기/합치기 (studyWrite/titleKeywords.ts). 네트워크·DB 를 쓰지 않는다.
 * 프런트(frontend/src/utils/titleKeywords.ts)도 같은 코드인지 함께 본다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { composeTitleDraft, mergeRegeneratedPart, parseTitleDraft, splitKeywords } from '../../src/studyWrite/titleKeywords';

const draft = '황련온담탕을 투여한 발작성 심방세동 환자 1례: 증례보고\n핵심 단어: 증례보고, 발작성 심방세동, 황련온담탕(黃連溫膽湯), 담화요심증';

// 나누기
const parsed = parseTitleDraft(draft);
assert.equal(parsed.title, '황련온담탕을 투여한 발작성 심방세동 환자 1례: 증례보고', '제목 안의 ":" 는 핵심 단어 줄로 보지 않음');
assert.deepEqual(parsed.keywords, ['증례보고', '발작성 심방세동', '황련온담탕(黃連溫膽湯)', '담화요심증']);
assert.equal(parseTitleDraft('제목: 어떤 제목\n키워드: a, b').title, '어떤 제목', '"제목:" 머리말은 뗀다');
assert.deepEqual(parseTitleDraft('어떤 제목\nKeywords: a; b.').keywords, ['a', 'b']);
assert.deepEqual(splitKeywords(' 증례보고 ，  침치료 ,, '), ['증례보고', '침치료']);

// 합치기: 바꾼 줄만 바뀐다
assert.equal(
  composeTitleDraft(parsed, { title: '새 제목\n두 줄' }),
  '새 제목 두 줄\n핵심 단어: 증례보고, 발작성 심방세동, 황련온담탕(黃連溫膽湯), 담화요심증'
);
assert.equal(
  composeTitleDraft(parsed, { keywords: ['증례보고', '두근거림'] }),
  '황련온담탕을 투여한 발작성 심방세동 환자 1례: 증례보고\n핵심 단어: 증례보고, 두근거림'
);
assert.equal(composeTitleDraft(parseTitleDraft('제목만 있음'), { keywords: ['증례보고'] }), '제목만 있음\n핵심 단어: 증례보고', '핵심 단어 줄이 없으면 붙인다');
assert.equal(composeTitleDraft(parseTitleDraft('핵심 단어: a, b'), { title: '새 제목', keywords: ['c'] }), '새 제목\n핵심 단어: c', '제목 줄이 없으면 앞에 넣는다');

// 다시 만들기: 모델이 다른 줄까지 바꿔도 원래 것을 지킨다
const regenerated = '분심기음을 쓴 두근거림 환자 치험 1례\n핵심 단어: 증례보고, 바뀌면 안 됨';
assert.equal(mergeRegeneratedPart(draft, regenerated, 'title'), '분심기음을 쓴 두근거림 환자 치험 1례\n핵심 단어: 증례보고, 발작성 심방세동, 황련온담탕(黃連溫膽湯), 담화요심증');
assert.equal(
  mergeRegeneratedPart(draft, '바뀌면 안 되는 제목\n핵심 단어: 증례보고, 수면 장애, 두통', 'keywords'),
  '황련온담탕을 투여한 발작성 심방세동 환자 1례: 증례보고\n핵심 단어: 증례보고, 수면 장애, 두통'
);
assert.equal(mergeRegeneratedPart(draft, '', 'title'), draft, '빈 결과면 그대로');

// 프런트 사본과 같은 코드
const read = (relative: string) =>
  fs
    .readFileSync(path.resolve(__dirname, relative), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.includes('titleKeywords.ts 와 같은 코드다'))
    .join('\n');
assert.equal(read('../../src/studyWrite/titleKeywords.ts'), read('../../../frontend/src/utils/titleKeywords.ts'), '백엔드·프런트 사본이 같아야 함');

console.log('titleKeywords tests passed');
