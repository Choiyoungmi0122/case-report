# 실험용 Write 사례 프리셋

전문가가 제공한 익명 진료 기록을 "실험 사례 불러오기" 목록에 넣는 폴더다.

- 이 폴더의 `*.json` 은 **git 에 올리지 않는다** (`backend/.gitignore` 의 `data/`). 실제 환자의 익명 기록이므로 실험 컴퓨터에만 둔다.
- 다른 컴퓨터에서 쓰려면 JSON 파일을 직접 복사한다.
- 만드는 법 (backend 폴더에서):

```bash
npx tsx scripts/buildStudyWritePreset.ts "<docx 경로>" <id> "<표시 이름>" "<전문 분야>"
```

예: `npx tsx scripts/buildStudyWritePreset.ts "C:\...\anonymized_records_chronological_editable.docx" lim-internal "한방내과 - 임교수님" "한방내과"`

- 입력 docx 는 방문마다 `익명 진료기록 | 첫 기록일` 또는 `익명 진료기록 | 16일 후` 줄로 시작해야 한다.
- 날짜가 상대 일수뿐이면 `relativeDates: true` 로 저장되고, 화면과 체인에는 "첫 기록일 +16일"로 보인다. 입력 칸의 날짜는 `anchorDate`(기본 2025-01-01) 기준으로 만든 임의 날짜다.
- 서버를 다시 시작하지 않아도 파일을 넣으면 바로 목록에 뜬다.
