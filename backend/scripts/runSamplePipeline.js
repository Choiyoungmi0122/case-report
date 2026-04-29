const fs = require('fs');
const path = require('path');
const {
  runEvidenceSplit,
  runSectionAssessment,
  runInitialSectionDrafts,
  runSectionMissingDetection,
  runQuestionGeneration
} = require('../dist/llm/chains');

const defaultVisits = [
  {
    index: 1,
    date: '2026-04-08T09:00:00+09:00',
    text: [
      'S: 52세 여성 환자가 3개월 전부터 지속된 불면과 두근거림, 불안을 주소로 내원하였다. 잠들기 어렵고 자주 깨며 최근 2주간 증상이 악화되었다고 하였다. 과거력상 고혈압으로 약물 복용 중이며, 가족력상 모친의 불안장애 병력이 있었다. 직업은 중학교 교사이며 최근 업무 스트레스가 심했다고 진술하였다.',
      'O: 혈압은 138/86 mmHg, 맥박수는 96회/분이었다. 안색은 창백하지 않았고 흉부 청진상 특이 소견은 없었다. 설질은 담홍, 설태는 박백, 맥은 세삭하였다. 갑상선기능검사와 일반혈액검사는 정상 범위였다.',
      'A: 기질적 이상 가능성은 낮다고 판단하였으며, 불안과 불면이 주 증상인 상태로 보았다. 한의학적으로는 간기울결로 변증하였다.',
      'P: 가미소요산을 1일 3회 2주간 처방하고, 주 2회 침 치료를 시행하기로 하였다. 수면 위생 교육을 함께 시행하였다. 2주 후 추적 관찰하기로 하였다.'
    ].join('\n')
  },
  {
    index: 2,
    date: '2026-04-22T09:00:00+09:00',
    text: [
      'S: 환자는 불면의 강도가 다소 감소했고, 두근거림은 절반 정도 줄었다고 말했다. 여전히 새벽 각성이 남아 있으나 불안감은 처음보다 호전되었다고 하였다.',
      'O: 맥박수는 84회/분이었다. 설질은 담홍, 맥은 여전히 세삭하였다. 약 복용 순응도는 양호하다고 답하였다.',
      'A: 초진 대비 증상 호전이 관찰되었다고 판단하였다.',
      'P: 기존 한약 처방을 2주 더 유지하고 침 치료를 지속하였다. 특별한 이상반응은 없다고 확인하였다.'
    ].join('\n')
  }
];

function loadVisitsFromArg() {
  const inputArg = process.argv[2];
  if (!inputArg) return defaultVisits;

  const filePath = path.isAbsolute(inputArg)
    ? inputArg
    : path.resolve(process.cwd(), inputArg);

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.visits)) {
    throw new Error('Input JSON must contain a "visits" array.');
  }

  return parsed.visits;
}

async function main() {
  const visits = loadVisitsFromArg();
  const evidenceCards = await runEvidenceSplit(visits);
  const sectionStates = await runSectionAssessment(evidenceCards);
  const sectionDrafts = await runInitialSectionDrafts(evidenceCards, sectionStates);
  const missing = await runSectionMissingDetection({ sectionDrafts, evidenceCards });
  const questions = await runQuestionGeneration({
    sectionDrafts,
    sectionMissing: missing.sectionMissing,
    commonMissing: missing.commonMissing
  });

  console.log(
    JSON.stringify(
      {
        sampleVisits: visits,
        evidenceCards,
        sectionStates,
        sectionDrafts,
        missing,
        questions
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
