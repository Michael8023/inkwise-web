import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, History, MonitorPlay, Presentation, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { functionRequest } from "./api";
import type { LibraryPaper } from "./library";

type Mode = "direct" | "stream" | "markdown";
type Result = { fileUrl?: string; pptId?: string; progress?: number; status?: string; total?: number; current?: number; pptxProperty?: string; data?: unknown };
type State = "idle" | "reading" | "generating" | "editing" | "polling" | "done" | "error";
type ActiveJob = { pptId: string; paperId: string; markdown: string; result: Result; slides: Slide[]; mode: Mode };
type JobStatus = "generating" | "completed" | "failed" | "expired" | "editing";
type HistoryEntry = ActiveJob & { id: string; paperTitle: string; createdAt: string; fileUrl?: string; status: JobStatus; error?: string };
type SlideElement = { text: string; x?: number; y?: number; width?: number; height?: number; fontSize?: number; color?: string; background?: string; bold?: boolean; align?: "left" | "center" | "right" };
type Slide = { title: string; lines: string[]; elements: SlideElement[]; background?: string };
const historyStorageKey = "shidea-ai-ppt-history";

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
function numeric(value: unknown, axis: "x" | "y") {
  if (typeof value === "string" && value.endsWith("%")) return Number(value.slice(0, -1));
  const parsed = Number(value); if (!Number.isFinite(parsed)) return undefined;
  if (Math.abs(parsed) <= 1) return parsed * 100;
  if (Math.abs(parsed) <= 100) return parsed;
  return parsed / (axis === "x" ? 12.8 : 7.2);
}
function textFromNode(node: Record<string, any>) { for (const key of ["text", "content", "value", "title"]) { if (typeof node[key] === "string" && node[key].trim()) return node[key].trim(); } return ""; }
function elementsFrom(value: unknown, elements: SlideElement[] = [], depth = 0): SlideElement[] {
  if (!value || typeof value !== "object" || depth > 7) return elements;
  if (Array.isArray(value)) { value.forEach(item => elementsFrom(item, elements, depth + 1)); return elements; }
  const node = value as Record<string, any>, text = textFromNode(node), style = node.style || node.textStyle || node.options || {};
  if (text && text.length < 1000) {
    const item: SlideElement = { text, x: numeric(node.x ?? node.left ?? node.xPos, "x"), y: numeric(node.y ?? node.top ?? node.yPos, "y"), width: numeric(node.width ?? node.w, "x"), height: numeric(node.height ?? node.h, "y"), fontSize: Number(style.fontSize ?? style.font_size ?? node.fontSize) || undefined, color: style.color ?? style.fontColor ?? node.color, background: style.background ?? style.fill ?? node.fill, bold: Boolean(style.bold ?? node.bold), align: style.align ?? style.textAlign };
    if (!elements.some(existing => existing.text === item.text && existing.x === item.x && existing.y === item.y)) elements.push(item);
  }
  Object.values(node).forEach(child => { if (child && typeof child === "object") elementsFrom(child, elements, depth + 1); });
  return elements.slice(0, 40);
}
function slidesFrom(value: unknown): Slide[] {
  const root = value as Record<string, any>; const candidates = [root?.slides, root?.pages, root?.ppt?.slides, root?.data?.slides].find(Array.isArray) as unknown[] | undefined;
  if (!candidates) return [];
  return candidates.map((slide, index) => { const lines = stringsFrom(slide); const elements = elementsFrom(slide); const slideData = slide as Record<string, any>; return { title: lines[0] || `第 ${index + 1} 页`, lines: lines.slice(lines[0] ? 1 : 0), elements, background: slideData.background ?? slideData.backgroundColor ?? slideData.fill }; });
}
function persistHistory(entries: HistoryEntry[]) { try { localStorage.setItem(historyStorageKey, JSON.stringify(entries.slice(0, 30))); } catch { /* Storage is optional. */ } }

export function PptStudio({ papers, extractText }: { papers: LibraryPaper[]; extractText: (paper: LibraryPaper) => Promise<string> }) {
  const usablePapers = useMemo(() => papers.filter(paper => !paper.archived_at), [papers]);
  const [paperId, setPaperId] = useState(""), [prompt, setPrompt] = useState(""), [mode, setMode] = useState<Mode>("stream"), [markdown, setMarkdown] = useState("");
  const [result, setResult] = useState<Result>({}), [slides, setSlides] = useState<Slide[]>([]), [state, setState] = useState<State>("idle"), [error, setError] = useState(""), [completeNotice, setCompleteNotice] = useState(""), [history, setHistory] = useState<HistoryEntry[]>([]), [detailId, setDetailId] = useState<string | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]), watchingRef = useRef(new Set<string>());
  const paper = usablePapers.find(item => item.id === paperId);
  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);
  useEffect(() => { try { const savedHistory = JSON.parse(localStorage.getItem(historyStorageKey) || "[]"); if (Array.isArray(savedHistory)) setHistory(savedHistory.map(item => ({ ...item, status: item.status || (item.fileUrl ? "completed" : item.mode === "markdown" ? "editing" : "generating") }))); } catch { persistHistory([]); } }, []);
  useEffect(() => { historyRef.current = history; }, [history]);
  const updateEntry = (id: string, patch: Partial<HistoryEntry>) => setHistory(current => { const next = current.map(item => item.id === id ? { ...item, ...patch } : item); historyRef.current = next; persistHistory(next); return next; });
  const createEntry = (status: JobStatus) => { const id = crypto.randomUUID(); const entry: HistoryEntry = { id, pptId: "", paperId, paperTitle: paper?.title || "未命名文献", markdown: "", result: {}, slides: [], mode, createdAt: new Date().toISOString(), status }; setHistory(current => { const next = [entry, ...current].slice(0, 30); historyRef.current = next; persistHistory(next); return next; }); return id; };
  const watchEntry = async (entryId: string, pptId: string) => { if (watchingRef.current.has(entryId)) return; watchingRef.current.add(entryId); let failures = 0; try { while (true) { await new Promise(resolve => window.setTimeout(resolve, 2200)); const entry = historyRef.current.find(item => item.id === entryId); if (!entry || entry.status !== "generating") break; try { let next = mergeResult(entry.result, await pptRequest("status", { pptId })); if (!next.fileUrl && next.total && next.current && next.current >= next.total) next = mergeResult(next, await pptRequest("download", { id: pptId })); let nextSlides = entry.slides; if (next.pptxProperty) { try { nextSlides = slidesFrom(await decodePptxProperty(next.pptxProperty)); } catch { /* Wait for the next complete page payload. */ } } const complete = Boolean(next.fileUrl); updateEntry(entryId, { pptId, result: next, slides: nextSlides, fileUrl: next.fileUrl, status: complete ? "completed" : "generating" }); if (complete) { setCompleteNotice("PPT 已生成完成，可以在任务详情中预览和下载。 "); break; } failures = 0; } catch (caught) { failures += 1; if (failures >= 3) updateEntry(entryId, { status: "failed", error: caught instanceof Error ? caught.message : "任务状态查询失败" }); } } } finally { watchingRef.current.delete(entryId); } };
  useEffect(() => { history.filter(item => item.status === "generating" && item.pptId).forEach(item => void watchEntry(item.id, item.pptId)); }, [history]);
  const instruction = async () => { if (!paper) throw new Error("请先在文献工作台添加并选择一份 PDF。"); const source = await extractText(paper); return `${prompt.trim() || "请将这篇文献制作成逻辑清晰、适合汇报的中文演示文稿。"}\n\n参考 PDF：《${paper.title}》\n\n${source}`.slice(0, 60000); };
  async function generateMarkdown(alsoGeneratePpt: boolean) { const entryId = createEntry("generating"); setError(""); setMarkdown(""); setResult({}); setSlides([]); setState("reading"); try { const subject = await instruction(); setState("generating"); const setText = (text: string) => { setMarkdown(text); updateEntry(entryId, { markdown: text }); }; const outline = await pptStream("outline", { subject }, setText, () => undefined); let taskId = ""; const setTask = (id: string) => { taskId = id; const taskResult = { pptId: id }; updateEntry(entryId, { pptId: id, result: taskResult, status: "generating" }); void watchEntry(entryId, id); }; const content = await pptStream("content", { outlineMarkdown: outline, asyncGenPptx: alsoGeneratePpt }, setText, setTask); const finalMarkdown = content || outline; setMarkdown(finalMarkdown); if (alsoGeneratePpt && !taskId) throw new Error("PPT 任务未返回任务编号，请重试。"); updateEntry(entryId, { markdown: finalMarkdown, status: alsoGeneratePpt ? "generating" : "editing" }); setState(alsoGeneratePpt ? "polling" : "editing"); } catch (caught) { const message = caught instanceof Error ? caught.message : "Markdown 生成失败，请稍后重试。"; setState("error"); setError(message); updateEntry(entryId, { status: "failed", error: message }); } }
  async function directGenerate() { await generateMarkdown(true); }
  async function generatePptForEntry(entry: HistoryEntry) { setError(""); updateEntry(entry.id, { status: "generating", error: undefined }); try { let taskId = ""; await pptStream("content", { outlineMarkdown: entry.markdown, asyncGenPptx: true }, () => undefined, id => { taskId = id; const taskResult = { ...entry.result, pptId: id }; updateEntry(entry.id, { pptId: id, result: taskResult, status: "generating" }); void watchEntry(entry.id, id); }); if (!taskId) throw new Error("PPT 任务未返回任务编号，请重试。"); setState("polling"); } catch (caught) { const message = caught instanceof Error ? caught.message : "PPT 生成失败，请稍后重试。"; updateEntry(entry.id, { status: "failed", error: message }); } }
  const run = mode === "direct" ? directGenerate : mode === "stream" ? () => generateMarkdown(true) : () => generateMarkdown(false);
  const statusLabel = (entry: HistoryEntry) => entry.status === "completed" && +new Date() - +new Date(entry.createdAt) > 2 * 60 * 60 * 1000 ? "已过期" : entry.status === "generating" ? "生成中" : entry.status === "completed" ? "已生成" : entry.status === "editing" ? "待编辑" : "已失败";
  const detail = detailId ? history.find(item => item.id === detailId) : null;
  const openDetail = (entry: HistoryEntry) => { setDetailId(entry.id); setPaperId(entry.paperId); setMarkdown(entry.markdown); setResult(entry.result); setSlides(entry.slides || []); setMode(entry.mode); setState(entry.status === "editing" ? "editing" : entry.status === "failed" ? "error" : "done"); };
  if (detail) return <section className="ppt-studio ppt-studio-v2 ppt-detail-page"><header><div><span><Presentation size={15}/> PPT TASK DETAIL</span><h1>{detail.paperTitle}</h1><p>创建于 {new Date(detail.createdAt).toLocaleString("zh-CN")} · {statusLabel(detail)}</p></div><button className="ppt-back" onClick={() => setDetailId(null)}><ArrowLeft size={16}/>返回任务列表</button></header>{detail.fileUrl && statusLabel(detail) !== "已过期" && <a className="ppt-download" href={detail.fileUrl} target="_blank" rel="noreferrer"><Download size={16}/>下载 PPT</a>}{statusLabel(detail) === "已过期" && <div className="ppt-error">该条目的 File URL 已过期，请重新生成以获得新的下载链接。</div>}{detail.error && <div className="ppt-error">{detail.error}</div>}<section className="ppt-markdown-panel"><div className="ppt-panel-heading"><span><MonitorPlay size={16}/> Markdown 内容</span><small>{detail.status === "editing" ? "待编辑" : "生成内容"}</small></div>{detail.status === "editing" ? <><textarea value={detail.markdown} onChange={event => updateEntry(detail.id, { markdown: event.target.value })}/><button className="ppt-generate ppt-detail-generate" onClick={() => void generatePptForEntry(detail)}><Sparkles size={16}/>使用此 Markdown 生成 PPT</button></> : <div className="ppt-markdown-scroll">{detail.markdown ? <ReactMarkdown>{detail.markdown}</ReactMarkdown> : <div className="ppt-preview-empty"><FileText size={28}/><p>内容正在生成，稍后刷新此条目查看。</p></div>}</div>}</section><section className="ppt-slide-panel"><div className="ppt-panel-heading"><span><Presentation size={16}/> PPT 预览</span><small>{detail.result.total ? `${detail.result.current || 0} / ${detail.result.total} 页` : statusLabel(detail)}</small></div>{detail.slides.length ? <div className="ppt-slide-strip">{detail.slides.map((slide, index) => <article className="ppt-slide" style={{ background: slide.background }} key={`${index}-${slide.title}`}><em>{index + 1}</em><div className="ppt-slide-canvas">{slide.elements.length ? slide.elements.map((element, elementIndex) => <p key={elementIndex} style={{ left: element.x !== undefined ? `${element.x}%` : undefined, top: element.y !== undefined ? `${element.y}%` : undefined, width: element.width ? `${element.width}%` : undefined, minHeight: element.height ? `${element.height}%` : undefined, fontSize: element.fontSize ? `${Math.max(9, Math.min(element.fontSize, 36))}px` : undefined, color: element.color, background: element.background, fontWeight: element.bold ? 700 : undefined, textAlign: element.align }}>{element.text}</p>) : <><h3>{slide.title}</h3><ul>{slide.lines.slice(0, 6).map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul></>}</div></article>)}</div> : <div className="ppt-preview-empty"><Presentation size={30}/><p>生成过程中会逐页显示 PPT 预览。</p></div>}</section></section>;
  return <section className="ppt-studio ppt-studio-v2">
    <header><div><span><Presentation size={15}/> AI PRESENTATION</span><h1>AI PPT 制作</h1><p>选择文献并创建任务；Markdown、PPT 预览和下载都在任务详情中查看。</p></div></header>
    {completeNotice && <div className="ppt-complete-notice"><span>{completeNotice}</span><button onClick={() => setCompleteNotice("")}>知道了</button></div>}
    <form className="ppt-form ppt-config" onSubmit={event => { event.preventDefault(); void run(); }}><label>选择 PDF<select value={paperId} onChange={event => setPaperId(event.target.value)}>{usablePapers.length ? usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>) : <option value="">文献库暂无 PDF</option>}</select></label><label className="ppt-prompt">制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} placeholder="例如：面向组会汇报，突出研究问题、方法、实验结果和局限性，控制在 10 页以内。"/></label><fieldset><legend>生成方式</legend><label className={mode === "direct" ? "selected" : ""}><input type="radio" checked={mode === "direct"} onChange={() => setMode("direct")}/><b>后台生成</b><small>后台持续生成，实时显示进度。</small></label><label className={mode === "stream" ? "selected" : ""}><input type="radio" checked={mode === "stream"} onChange={() => setMode("stream")}/><b>流式生成 PPT</b><small>流式 Markdown + 逐页 PPT 预览。</small></label><label className={mode === "markdown" ? "selected" : ""}><input type="radio" checked={mode === "markdown"} onChange={() => setMode("markdown")}/><b>Markdown 转 PPT</b><small>先生成、编辑 Markdown，再单独生成 PPT。</small></label></fieldset><button className="ppt-generate" disabled={!paper}><Sparkles size={17}/>{mode === "markdown" ? "创建 Markdown 任务" : "创建 PPT 任务"}</button>{error && <p className="ppt-error">{error}</p>}</form>
    <section className="ppt-history ppt-task-list"><div className="ppt-history-head"><span><History size={16}/>PPT 任务 <b>{history.length}</b></span><small>每次点击都会创建独立任务；点击任一条目查看详情</small></div><div className="ppt-history-list">{history.length ? history.map(item => { const label = statusLabel(item); return <article key={item.id}><button onClick={() => openDetail(item)}><Presentation size={17}/><span><b>{item.paperTitle}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></span></button><em className={`ppt-status ${label === "已过期" ? "expired" : item.status}`}>{label}</em></article>; }) : <p>还没有 PPT 任务。选择 PDF 并点击创建任务后会自动创建条目。</p>}</div></section>
  </section>;
}
