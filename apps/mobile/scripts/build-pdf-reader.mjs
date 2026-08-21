// 生成自包含的 WebView PDF 阅读器 HTML：
// 将 pdfjs-dist 的 pdf.min.mjs 与 worker 内联，供 react-native-webview 加载。
// 用法：node scripts/build-pdf-reader.mjs （输出 src/components/pdf/pdfReaderHtml.generated.ts）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = resolve(root, "../../node_modules/pdfjs-dist/build");
const outDir = resolve(root, "src/components/pdf");
mkdirSync(outDir, { recursive: true });

const pdfMin = readFileSync(resolve(pdfjs, "pdf.min.mjs"), "utf8");
const workerMin = readFileSync(resolve(pdfjs, "pdf.worker.min.mjs"), "utf8");

// worker 以 blob URL 加载（WebView 内 file:// 无法直接加载 module worker）
const workerBase64 = Buffer.from(workerMin, "utf8").toString("base64");

const appJs = `
// 助手统一加 sd_ 前缀，避免与 pdf.min.mjs 内部的 $ 等标识符冲突
const sdEl = (id) => document.getElementById(id);
const sdPagesEl = sdEl('pages');
let sdPdfDoc = null, sdScale = 1.25, sdRendered = new Set();
let sdNumPages = 0, sdLastPage = 0;

function sdPost(type, payload) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...payload }));
  }
}

async function sdLoadPdf(dataUrl) {
  sdPagesEl.innerHTML = '<div class="loading">正在解析 PDF…</div>';
  try {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    sdPdfDoc = await pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
    sdNumPages = sdPdfDoc.numPages;
    sdPagesEl.innerHTML = '';
    sdRendered.clear();
    sdPost('ready', { numPages: sdNumPages });
    sdRenderAll();
  } catch (err) {
    sdPagesEl.innerHTML = '<div class="error">PDF 加载失败：' + String(err && err.message || err) + '</div>';
    sdPost('error', { message: String(err && err.message || err) });
  }
}

async function sdRenderPage(n) {
  if (sdRendered.has(n)) return;
  sdRendered.add(n);
  const page = await sdPdfDoc.getPage(n);
  const viewport = page.getViewport({ scale: sdScale });
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  // 文本层（供搜索与选中）
  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  wrap.appendChild(textLayer);
  try {
    const tl = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayer,
      viewport,
    });
    await tl.render();
  } catch (e) { /* 文本层失败不影响阅读 */ }
  page.cleanup();
  sdPagesEl.appendChild(wrap);
}

async function sdRenderAll() {
  if (!sdPdfDoc) return;
  for (let n = 1; n <= sdNumPages; n++) await sdRenderPage(n);
}

function sdCurrentPage() {
  const wraps = sdPagesEl.querySelectorAll('.page-wrap');
  if (!wraps.length) return 0;
  const mid = window.innerHeight / 2;
  let best = wraps[0], bestDist = Infinity;
  wraps.forEach((w) => {
    const r = w.getBoundingClientRect();
    const dist = Math.abs((r.top + r.height / 2) - mid);
    if (dist < bestDist) { bestDist = dist; best = w; }
  });
  const idx = Array.prototype.indexOf.call(wraps, best);
  return idx + 1;
}

function sdReportPage() {
  if (!sdPdfDoc) return;
  const p = sdCurrentPage();
  if (p !== sdLastPage) { sdLastPage = p; sdPost('page', { page: p, numPages: sdNumPages }); }
}

function sdGoToPage(n) {
  if (!sdPdfDoc || n < 1 || n > sdNumPages) return;
  const wraps = sdPagesEl.querySelectorAll('.page-wrap');
  const target = wraps[n - 1];
  if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
  sdPost('page', { page: n, numPages: sdNumPages });
}

function sdSetZoom(next) {
  sdScale = Math.max(0.7, Math.min(2.2, next));
  sdRendered.clear();
  sdPagesEl.innerHTML = '';
  sdRenderAll();
}

function sdSearch(query) {
  if (!sdPdfDoc || !query) return;
  const spans = sdPagesEl.querySelectorAll('.textLayer span');
  let found = null;
  spans.forEach((s) => { s.style.background = ''; if (!found && s.textContent.toLowerCase().includes(query.toLowerCase())) found = s; });
  if (found) {
    found.style.background = '#F6D890';
    found.scrollIntoView({ behavior: 'instant', block: 'center' });
    sdPost('search-result', { found: true });
  } else {
    sdPost('search-result', { found: false });
  }
}

window.addEventListener('scroll', () => { clearTimeout(window.__sdPageTimer); window.__sdPageTimer = setTimeout(sdReportPage, 180); });

window.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.type === 'load') sdLoadPdf(msg.dataUrl);
  else if (msg.type === 'goto') sdGoToPage(msg.page);
  else if (msg.type === 'zoom') sdSetZoom(msg.scale);
  else if (msg.type === 'search') sdSearch(msg.query);
});
`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin:0; padding:0; background: #F4FBFA; }
  #pages { padding: 12px 10px 28px; display:flex; flex-direction:column; gap:10px; align-items:center; }
  .page-wrap { position:relative; background:#fff; border:0.5px solid #E4EDEC; border-radius:8px; overflow:hidden; box-shadow:0 1px 2px rgba(6,52,119,.06); }
  canvas { display:block; width:100%; height:auto; }
  .textLayer { position:absolute; inset:0; overflow:hidden; line-height:1.0; text-align:initial; transform-origin:0 0; opacity:0.2; }
  .textLayer span { position:absolute; white-space:pre; cursor:text; color:transparent; transform-origin:0 0; }
  .loading, .error { padding:40px 16px; text-align:center; color:#597083; font-size:13px; font-family:-apple-system,"PingFang SC",sans-serif; }
  .error { color:#C0392F; }
</style>
</head>
<body>
<div id="pages"><div class="loading">加载中…</div></div>
<script type="module">
${pdfMin}
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([atob("${workerBase64}")], { type: "text/javascript" }));
${appJs}
</script>
</body>
</html>`;

const ts = `// AUTO-GENERATED by scripts/build-pdf-reader.mjs —— 请勿手动修改。
export const PDF_READER_HTML = ${JSON.stringify(html)};
`;
writeFileSync(resolve(outDir, "pdfReaderHtml.generated.ts"), ts, "utf8");
console.log(`generated ${ts.length} bytes -> src/components/pdf/pdfReaderHtml.generated.ts`);
