/**
 * "내 학습 기록" 화면을 HTML 파일 하나로 내보낸다 (2026-10-12).
 * 화면에 그려진 본문을 복사하고, 쓰이는 CSS 를 함께 넣어 인터넷 없이 브라우저로 열어도 같게 보이게 한다.
 * Word 내보내기와 함께 제출 방법으로 쓴다.
 */

type SummaryHtmlMeta = {
  title: string;
  experimentCode: string;
  caseTitle?: string;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function collectPageCss(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      chunks.push(Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n'));
    } catch {
      // 다른 출처 글꼴 시트 등은 읽을 수 없어 건너뛴다
    }
  }
  return chunks.join('\n');
}

export function buildSummaryHtml(root: HTMLElement, meta: SummaryHtmlMeta): string {
  const clone = root.cloneNode(true) as HTMLElement;
  // 접힌 상자는 모두 펼친 채로 저장한다(파일을 연 사람이 놓치지 않게)
  clone.querySelectorAll('details').forEach((item) => item.setAttribute('open', ''));
  // 입력란은 지금 값을 글로 남긴다
  const liveFields = root.querySelectorAll('textarea, input');
  clone.querySelectorAll('textarea, input').forEach((field, index) => {
    const value = (liveFields[index] as HTMLInputElement | HTMLTextAreaElement | undefined)?.value || '';
    const text = document.createElement('div');
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = value;
    field.replaceWith(text);
  });
  clone.querySelectorAll('button').forEach((button) => button.setAttribute('tabindex', '-1'));

  const exportedAt = new Date().toLocaleString('ko-KR');
  const heading = [
    `<p class="summary-export__eyebrow">${escapeHtml(meta.title)}</p>`,
    `<h1 class="summary-export__title">${escapeHtml(meta.caseTitle || meta.title)}</h1>`,
    `<p class="summary-export__meta">실험번호 ${escapeHtml(meta.experimentCode || '-')} · 내보낸 시각 ${escapeHtml(exportedAt)}</p>`
  ].join('\n');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${meta.title} - ${meta.experimentCode || ''}`)}</title>
<style>
${collectPageCss()}
</style>
<style>
html, body { margin: 0; background: #f3f4f6; }
.summary-export { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 20px; }
.summary-export__head { background: #fff; border: 1px solid #d3d8df; border-radius: 8px; padding: 20px 24px; }
.summary-export__eyebrow { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #1f6f43; }
.summary-export__title { margin: 0; font-size: 24px; line-height: 1.35; color: #1f2733; }
.summary-export__meta { margin: 8px 0 0; color: #4b5563; font-size: 14px; }
@media print { html, body { background: #fff; } .summary-export { padding: 0; } }
</style>
</head>
<body>
<main class="summary-export">
<header class="summary-export__head">
${heading}
</header>
${clone.innerHTML}
</main>
</body>
</html>
`;
}
