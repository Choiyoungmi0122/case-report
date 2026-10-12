/**
 * 고정 연구 사례(MAIN_CASE_01)의 치료 개입(THERAPEUTIC_INTERVENTIONS) 초안 채점표.
 *
 * 기준: 연구자가 만든 CARE 정리표 `DEFAULT_STUDY_CARE_ELEMENT_MAP.THERAPEUTIC_INTERVENTIONS`
 * (backend/src/study/cases/defaultStudyCase.ts, 근거 docs/care_missing_info_basis_v1.md)의 "기록에 있는 정보".
 * 항목마다 초안에 들어 있는지 정규식으로 본다. 표현이 달라도 잡히도록 대안을 둔다. 자동 채점은 1차 거름이며,
 * 결과 문서에는 사람이 초안을 직접 읽은 판정을 함께 적는다.
 *
 * errors: 기록과 다르거나 기록에 없는 내용을 쓴 경우(고정 초안에서 실제로 나온 오류 포함). 하나라도 걸리면 감점.
 * scope: 섹션 범위 밖 내용(이상반응은 10d, FOLLOW_UP_OUTCOMES). 정보로만 표시한다.
 */
export type ChecklistItem = { id: string; code: '9a' | '9b' | '9c'; label: string; all: RegExp[] };

const any = (...patterns: RegExp[]) => new RegExp(patterns.map((p) => p.source).join('|'));

export const TI_CHECKLIST: ChecklistItem[] = [
  // 9a 치료의 종류
  { id: '9a-herbal', code: '9a', label: '한약 황련해독탕', all: [/황련해독탕/] },
  { id: '9a-acu', code: '9a', label: '침·기기구술·적외선', all: [/침/, any(/기기구술/, /뜸/), /적외선/] },
  { id: '9a-pharmaco', code: '9a', label: '자하거 약침', all: [/자하거/] },
  { id: '9a-counsel', code: '9a', label: '지언고론요법(상담)', all: [any(/지언고론/, /지지적\s*상담/)] },
  { id: '9a-autogenic', code: '9a', label: '자율훈련법 교육', all: [/자율훈련/] },
  { id: '9a-neuro', code: '9a', label: '신경과 약 이름(도네페질, 글리아티린)', all: [/도네페질/, /글리아티린/] },
  { id: '9a-psy', code: '9a', label: '정신과 약 이름(에스시탈로프람, 알프라졸람, 모사프리드)', all: [/에스시탈로프람/, /알프라졸람/, /모사프리드/] },
  { id: '9a-htn', code: '9a', label: '고혈압 약 이름(암로디핀)', all: [/암로디핀/] },
  { id: '9a-quetiapine', code: '9a', label: '신규 정신과 쿠에티아핀', all: [/쿠에티아핀/] },
  // 9b 시행 방법
  { id: '9b-herbal-dose', code: '9b', label: '황련해독탕 5.61g/3포, 1일 3회 식후 30분', all: [/5\.61\s*g/, any(/1일\s*3회/, /하루\s*(3|세)\s*(회|번)/)] },
  { id: '9b-herbal-period', code: '9b', label: '황련해독탕 2주씩 두 번(3/11~, 4/15~4/29)', all: [any(/3\s*\/\s*11/, /3월\s*11일/), any(/4\s*\/\s*15/, /4월\s*15일/), any(/4\s*\/\s*29/, /4월\s*29일/)] },
  { id: '9b-pharmaco-dose', code: '9b', label: '약침 부위별 용량', all: [/0\.5\s*cc/, any(/0\.25\s*cc/, /0\.2\s*cc/)] },
  { id: '9b-needle', code: '9b', label: '침 규격 0.20x30mm', all: [/0\.20?\s*[x×*]\s*30/] },
  { id: '9b-retention', code: '9b', label: '유침 20분', all: [any(/유침\s*20\s*분/, /20\s*분\s*(간\s*)?유침/)] },
  { id: '9b-points', code: '9b', label: '혈위 대부분(12개 중 10개 이상)', all: [] },
  { id: '9b-autogenic', code: '9b', label: '자율훈련법 1일 2회, 회당 10분', all: [any(/1일\s*2회/, /하루\s*(2|두)\s*(회|번)/), /10\s*분/] },
  { id: '9b-counsel-time', code: '9b', label: '지언고론요법 시행 시간(회당 10~20분)', all: [any(/지언고론[^.]*\d+\s*분/, /상담[^.]*\d+\s*분/)] },
  // 9c 변경과 이유
  { id: '9c-donepezil', code: '9c', label: '도네페질 복용 시간 저녁→아침', all: [/도네페질[^.]*아침|아침[^.]*도네페질/] },
  { id: '9c-orbital', code: '9c', label: '약침 부위 추가(다크서클 호소)', all: [/다크서클/] },
  { id: '9c-stop-taiyang', code: '9c', label: '약침 중단과 태양 추가(6회차)', all: [any(/약침[^.]*(중단|시행하지\s*않|하지\s*않)/), /태양/] },
  { id: '9c-quetiapine-daughter', code: '9c', label: '4/8부터 쿠에티아핀 추가, 딸이 복약 관리', all: [/쿠에티아핀/, /딸/] },
  { id: '9c-interval', code: '9c', label: '내원 간격 연장(4주 후, 이후 월 1회)', all: [any(/간격/, /월\s*1회/, /4주\s*후/)] }
];

const ACU_POINTS = ['백회', '사신총', '상성', '곡차', '인당', '중완', '천추', '합곡', '후계', '태충', '신맥', '조해', '풍지'];

const sentencesOf = (text: string) => text.split(/(?<=[.다])\s+/).filter((sentence) => sentence.trim());

/** 기록과 다르거나 기록에 없는 주장. pattern 또는 test(문장·괄호 단위 판정) 중 하나. */
export const TI_ERRORS: Array<{ id: string; label: string; pattern?: RegExp; test?: (text: string) => boolean }> = [
  { id: 'err-no-acu-observe', label: '"침 치료 없이 경과 관찰" (기록: 4/15 이후 6주간 침치료 없이 지냄, 6회차에 침 재개)', pattern: /침\s*치료\s*없이[^.,]*관찰|관찰[^.,]*침\s*치료\s*없이/ },
  { id: 'err-late-april', label: '"4월 말" (기록에 없는 날짜 표현)', pattern: /4월\s*말/ },
  { id: 'err-causal', label: '효과·인과 표현 (P5)', pattern: /효과(가|를|적)|개선시키|호전시키|덕분/ },
  { id: 'err-reason-herbal', label: '황련해독탕 재처방·종료 이유 (기록에 없음)', pattern: /황련해독탕[^.]*(위해|때문|목적)/ },
  // v3 평가에서 사람이 찾은 오류 (2026-10-12)
  {
    id: 'err-gap-start',
    label: '침 치료 공백의 시작점을 4/15 가 아닌 날짜로 씀 (기록: 4/15 이후 6주간)',
    // "6주"를 말하는 문장에 "4/15(4월 15일) 이후 6주"가 없으면 시작점을 옮긴 것으로 본다
    test: (text) =>
      sentencesOf(text).some(
        (sentence) => /6\s*주/.test(sentence) && /침/.test(sentence) && !/(4월\s*15일|4\s*\/\s*15)\s*(이후|부터)\s*6\s*주/.test(sentence)
      )
  },
  { id: 'err-donepezil-from', label: '도네페질 변경을 "4월 1일부터/이후"로 씀 (기록: 4/1 방문에서 이미 바꿨다고 보고)', pattern: /(4월\s*1일|4\s*\/\s*1)\s*(부터|이후)[^.]*도네페질|도네페질[^.]*(4월\s*1일|4\s*\/\s*1)\s*(부터|이후)/ },
  // 약침 바로 뒤 괄호(부위·용량) 안에 태양이 있을 때만 (침 혈위 목록의 태양은 맞다)
  { id: 'err-taiyang-pharmaco', label: '태양(침 혈위 추가)을 약침 부위로 씀', pattern: /약침[^().]*\([^)]*태양[^)]*\)/ },
  { id: 'err-meta', label: '본문에 "기록" 같은 자료 설명', pattern: /용량\s*기록|기록에\s*따르|기록되어|기재/ },
  // v3.1 평가에서 사람이 찾은 오류 (2026-10-12)
  { id: 'err-actor-exercise', label: '환자가 스스로 한 운동(헬스·산책)을 의료진이 지도한 것으로 씀', pattern: /헬스[^.]*(지도|권유|권고|교육|하도록)/ },
  { id: 'err-donepezil-instruct', label: '"신경과에 문의하라고 안내"를 "변경하도록 안내/지시"로 씀', pattern: /도네페질[^.]*변경하도록|도네페질[^.]*변경을\s*(지시|권유)/ },
  // 시험 사례 V2-LIVE-01 실시간 생성에서 사람이 찾은 오류 (2026-10-12)
  {
    id: 'err-pharmaco-visit6',
    label: '약침을 6회차까지 시행했다고 씀 (기록: 6회차는 안와부 멍 뒤 환자가 원치 않아 약침 안 함)',
    test: (text) =>
      sentencesOf(text).some(
        (sentence) => /약침/.test(sentence) && /(6\s*(차|회차)?\s*(방문)?\s*까지|모든\s*방문|매\s*방문)/.test(sentence) && !/(중단|하지\s*않|안\s*함|원치)/.test(sentence)
      )
  },
  {
    id: 'err-taiyang-visit5',
    label: '태양 추가를 5회차(4/15)로 씀 (기록: 태양은 6회차에 침 혈위로 추가)',
    test: (text) =>
      sentencesOf(text).some((sentence) => /태양/.test(sentence) && /(5\s*(차|회차)|4월\s*15일|4\s*\/\s*15)/.test(sentence) && !/6\s*(차|회차)/.test(sentence))
  }
];

export const TI_SCOPE: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'scope-ae', label: '이상반응을 치료 개입에 씀 (10d 는 FOLLOW_UP_OUTCOMES)', pattern: /멍|이상반응/ }
];

export function scoreTiDraft(text: string) {
  const items = TI_CHECKLIST.map((item) => {
    const hit =
      item.id === '9b-points'
        ? ACU_POINTS.filter((point) => text.includes(point)).length >= 10
        : item.all.every((pattern) => pattern.test(text));
    return { id: item.id, code: item.code, label: item.label, hit };
  });
  const byCode = (code: string) => {
    const list = items.filter((item) => item.code === code);
    return { hit: list.filter((item) => item.hit).length, total: list.length };
  };
  const errors = TI_ERRORS.filter((error) => (error.test ? error.test(text) : error.pattern!.test(text))).map((error) => error.label);
  const scope = TI_SCOPE.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
  const sentences = text.split(/(?<=[.다])\s+/).filter((sentence) => sentence.trim().length > 0);
  return {
    coverage: { '9a': byCode('9a'), '9b': byCode('9b'), '9c': byCode('9c'), all: { hit: items.filter((i) => i.hit).length, total: items.length } },
    items,
    errors,
    scope,
    chars: text.length,
    sentences: sentences.length,
    acuPoints: ACU_POINTS.filter((point) => text.includes(point)).length
  };
}
