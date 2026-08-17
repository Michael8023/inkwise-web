import { useEffect, useMemo, useState } from "react";
import { Download, FileText, LoaderCircle, MonitorPlay, Presentation, Sparkles, StopCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { functionRequest } from "./api";
import type { LibraryPaper } from "./library";

type Mode = "direct" | "stream" | "markdown";
type Result = { fileUrl?: string; pptId?: string; progress?: number; status?: string; total?: number; current?: number; pptxProperty?: string; data?: unknown };
type State = "idle" | "reading" | "generating" | "editing" | "polling" | "done" | "error";
type ActiveJob = { pptId: string; paperId: string; markdown: string; result: Result; slides: Slide[]; mode: Mode };
type Slide = { title: string; lines: string[] };
const jobStorageKey = "shidea-ai-ppt-active-job";

function readStreamValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  for (const key of ["delta", "content", "text", "markdown"]) { const found = item[key]; if (typeof found === "string") return found; if (found && typeof found === "object") { const nested = readStreamValue(found); if (nested) return nested; } }
  return "";
}
function nestedData(result: Result) { const root = result.data as Record<string, unknown> | undefined; return root?.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root || {}; }
function mergeResult(previous: Result, next: Result): Result { const data = nestedData(next); return { ...previous, ...next, pptxProperty: next.pptxProperty || String(data.pptxProperty || "") || previous.pptxProperty, total: next.total || Number(data.total || 0) || previous.total, current: next.current || Number(data.current || 0) || previous.current }; }
async function pptRequest(action: string, request: Record<string, unknown>) { const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, request }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "AI_PPT_FAILED"); return payload as Result; }
async function pptStream(action: "outline" | "content", request: Record<string, unknown>, onText: (value: string) => void, onPptId: (value: string) => void) {
  const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, request: { ...request, stream: true } }) });
  if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "AI_PPT_STREAM_FAILED"); }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", fullText = "";
  const consume = (raw: string) => { let payload = raw.trim().replace(/^(?:data:\s*)+/, "").trim(); if (!payload || payload === "[DONE]") return; if (!payload.startsWith("{")) { const start = payload.indexOf("{"); if (start < 0) return; payload = payload.slice(start); } let item: any; try { item = JSON.parse(payload); } catch { return; } const text = readStreamValue(item); if (text) { fullText += text; onText(fullText); } const pptId = item?.pptId || item?.data?.pptId || item?.ppt_id; if (pptId) onPptId(String(pptId)); };
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ""; events.forEach(consume); }
  if (buffer.trim()) consume(buffer); return fullText;
}
async function decodePptxProperty(encoded: string): Promise<unknown> {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/"); const binary = atob(base64); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  let text = "";
  if ("DecompressionStream" in window) { try { text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); } catch { /* Some providers return plain JSON base64. */ } }
  if (!text) text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}
function stringsFrom(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string" && value.trim() && value.trim().length < 800) found.push(value.trim());
  else if (Array.isArray(value)) value.forEach(item => stringsFrom(item, found));
  else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, item]) => { if (/^(text|content|value|title|name|runs|paragraphs|children)$/i.test(key)) stringsFrom(item, found); });
  return [...new Set(found)].slice(0, 14);
}
function slidesFrom(value: unknown): Slide[] {
  const root = value as Record<string, any>; const candidates = [root?.slides, root?.pages, root?.ppt?.slides, root?.data?.slides].find(Array.isArray) as unknown[] | undefined;
  if (!candidates) return [];
  return candidates.map((slide, index) => { const lines = stringsFrom(slide); return { title: lines[0] || `第 ${index + 1} 页`, lines: lines.slice(lines[0] ? 1 : 0) }; });
}
function persist(job: ActiveJob | null) { try { if (job) localStorage.setItem(jobStorageKey, JSON.stringify(job)); else localStorage.removeItem(jobStorageKey); } catch { /* Storage is optional. */ } }

export function PptStudio({ papers, extractText }: { papers: LibraryPaper[]; extractText: (paper: LibraryPaper) => Promise<string> }) {
  const usablePapers = useMemo(() => papers.filter(paper => !paper.archived_at), [papers]);
  const [paperId, setPaperId] = useState(""), [prompt, setPrompt] = useState(""), [mode, setMode] = useState<Mode>("stream"), [markdown, setMarkdown] = useState("");
  const [result, setResult] = useState<Result>({}), [slides, setSlides] = useState<Slide[]>([]), [state, setState] = useState<State>("idle"), [error, setError] = useState("");
  const paper = usablePapers.find(item => item.id === paperId);
  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(jobStorageKey) || "null") as ActiveJob | null; if (saved?.pptId) { setPaperId(saved.paperId); setMarkdown(saved.markdown); setResult(saved.result); setSlides(saved.slides || []); setMode(saved.mode); setState(saved.result.fileUrl ? "done" : "polling"); } } catch { persist(null); } }, []);
  const updateSlides = async (next: Result) => { if (!next.pptxProperty) return; try { setSlides(slidesFrom(await decodePptxProperty(next.pptxProperty))); } catch { /* Keep the previous preview while an incomplete property is returned. */ } };
  const saveJob = (next: Result, nextSlides = slides) => { if (next.pptId && !next.fileUrl) persist({ pptId: next.pptId, paperId, markdown, result: next, slides: nextSlides, mode }); else if (next.fileUrl) persist(null); };
  useEffect(() => { if (!result.pptId || result.fileUrl || state !== "polling") return; const check = () => { void pptRequest("status", { pptId: result.pptId }).then(async incoming => { let next = mergeResult(result, incoming); if (!next.fileUrl && next.total && next.current && next.current >= next.total) next = mergeResult(next, await pptRequest("download", { id: next.pptId })); setResult(next); await updateSlides(next); saveJob(next); if (next.fileUrl) setState("done"); }).catch(() => undefined); }; check(); const timer = window.setInterval(check, 2200); return () => window.clearInterval(timer); }, [result, state]);
  const instruction = async () => { if (!paper) throw new Error("请先在文献工作台添加并选择一份 PDF。"); const source = await extractText(paper); return `${prompt.trim() || "请将这篇文献制作成逻辑清晰、适合汇报的中文演示文稿。"}\n\n参考 PDF：《${paper.title}》\n\n${source}`.slice(0, 60000); };
  const capturePptId = (id: string) => { const next = { ...result, pptId: id }; setResult(next); saveJob(next); };
  async function generateMarkdown(alsoGeneratePpt: boolean) { setError(""); setState("reading"); try { const subject = await instruction(); setState("generating"); let taskId = ""; const setText = (text: string) => setMarkdown(text); const setTask = (id: string) => { taskId = id; capturePptId(id); }; const outline = await pptStream("outline", { subject }, setText, setTask); const content = await pptStream("content", { outlineMarkdown: outline || markdown, asyncGenPptx: alsoGeneratePpt }, setText, setTask); setMarkdown(content || outline); if (alsoGeneratePpt && taskId) setState("polling"); else setState("editing"); } catch (caught) { setState("error"); setError(caught instanceof Error ? caught.message : "Markdown 生成失败，请稍后重试。"); } }
  async function generatePptFromMarkdown() {
    if (!markdown.trim()) { await generateMarkdown(false); return; }
    setError(""); setState("generating");
    try {
      let taskId = "";
      await pptStream("content", { outlineMarkdown: markdown, asyncGenPptx: true }, () => undefined, id => { taskId = id; capturePptId(id); });
      setState(taskId ? "polling" : "done");
    } catch (caught) { setState("error"); setError(caught instanceof Error ? caught.message : "PPT 生成失败，请稍后重试。"); }
  }
  async function directGenerate() { await generateMarkdown(true); }
  const busy = ["reading", "generating", "polling"].includes(state); const markdownLocked = mode !== "markdown" && busy;
  const run = mode === "direct" ? directGenerate : mode === "stream" ? () => generateMarkdown(true) : generatePptFromMarkdown;
  return <section className="ppt-studio ppt-studio-v2">
    <header><div><span><Presentation size={15}/> AI PRESENTATION</span><h1>AI PPT 制作</h1><p>任务会在云端持续生成；关闭或刷新页面后，重新进入此页会自动恢复 PPT 进度和预览。</p></div>{result.fileUrl && <a className="ppt-download" href={result.fileUrl} target="_blank" rel="noreferrer"><Download size={16}/>下载 PPT</a>}</header>
    <form className="ppt-form ppt-config" onSubmit={event => { event.preventDefault(); void run(); }}><label>选择 PDF<select value={paperId} onChange={event => setPaperId(event.target.value)}>{usablePapers.length ? usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>) : <option value="">文献库暂无 PDF</option>}</select></label><label className="ppt-prompt">制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} placeholder="例如：面向组会汇报，突出研究问题、方法、实验结果和局限性，控制在 10 页以内。"/></label><fieldset><legend>生成方式</legend><label className={mode === "direct" ? "selected" : ""}><input type="radio" checked={mode === "direct"} onChange={() => setMode("direct")}/><b>后台生成</b><small>后台持续生成，实时显示进度。</small></label><label className={mode === "stream" ? "selected" : ""}><input type="radio" checked={mode === "stream"} onChange={() => setMode("stream")}/><b>流式生成 PPT</b><small>流式 Markdown + 逐页 PPT 预览。</small></label><label className={mode === "markdown" ? "selected" : ""}><input type="radio" checked={mode === "markdown"} onChange={() => setMode("markdown")}/><b>Markdown 转 PPT</b><small>先生成、编辑 Markdown，再单独生成 PPT。</small></label></fieldset><button className="ppt-generate" disabled={busy || !paper}><Sparkles size={17}/>{state === "reading" ? "正在读取 PDF…" : state === "generating" ? "正在生成…" : state === "polling" ? `正在生成 PPT${result.current && result.total ? ` · ${result.current}/${result.total} 页` : ""}…` : mode === "markdown" && !markdown ? "先生成 Markdown" : mode === "markdown" ? "将 Markdown 生成 PPT" : "开始生成"}</button>{result.pptId && !result.fileUrl && <button type="button" className="ppt-stop-tracking" onClick={() => { persist(null); setState("idle"); setResult({}); }}><StopCircle size={15}/>停止本地追踪</button>}{error && <p className="ppt-error">{error}</p>}</form>
    <section className="ppt-markdown-panel"><div className="ppt-panel-heading"><span><MonitorPlay size={16}/> Markdown 内容</span>{busy && <LoaderCircle className="ppt-spin" size={16}/>}<small>{mode === "markdown" ? "可编辑" : "实时生成"}</small></div>{mode === "markdown" ? <textarea value={markdown} onChange={event => setMarkdown(event.target.value)} disabled={markdownLocked} placeholder="生成的大纲与页面内容会显示在这里；可编辑后再点击“将 Markdown 生成 PPT”。"/> : markdown ? <ReactMarkdown>{markdown}</ReactMarkdown> : <div className="ppt-preview-empty"><FileText size={28}/><p>Markdown 大纲和页面内容将在这里流式显示。</p></div>}</section>
    <section className="ppt-slide-panel"><div className="ppt-panel-heading"><span><Presentation size={16}/> 实时 PPT 预览</span><small>{result.total ? `${result.current || 0} / ${result.total} 页已生成` : result.pptId ? "正在等待页面数据…" : "等待生成"}</small></div>{slides.length ? <div className="ppt-slide-strip">{slides.map((slide, index) => <article className="ppt-slide" key={`${index}-${slide.title}`}><em>{index + 1}</em><h3>{slide.title}</h3><ul>{slide.lines.slice(0, 6).map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul></article>)}</div> : <div className="ppt-preview-empty"><Presentation size={30}/><p>生成过程中会解码文多多返回的 PPT 数据，并逐页展示已完成页面。</p></div>}</section>
  </section>;
}
