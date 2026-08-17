import { useEffect, useMemo, useState } from "react";
import { Download, FileText, LoaderCircle, MonitorPlay, Presentation, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { functionRequest } from "./api";
import type { LibraryPaper } from "./library";

type Mode = "direct" | "stream" | "markdown";
type Result = { fileUrl?: string; pptId?: string; progress?: number; status?: string; data?: unknown };

function readStreamValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  for (const key of ["delta", "content", "text", "markdown", "data"]) {
    const found = item[key]; if (typeof found === "string") return found;
    if (found && typeof found === "object") { const nested = readStreamValue(found); if (nested) return nested; }
  }
  return "";
}

async function pptRequest(action: string, request: Record<string, unknown>) {
  const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, request }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "AI_PPT_FAILED");
  return payload as Result;
}

async function pptStream(action: "outline" | "content", request: Record<string, unknown>, onText: (value: string) => void, onPptId: (value: string) => void) {
  const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, request: { ...request, stream: true } }) });
  if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "AI_PPT_STREAM_FAILED"); }
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    const item = await response.json(); const text = readStreamValue(item); const candidate = item?.pptId || item?.data?.pptId || item?.ppt_id;
    if (text) onText(text); if (candidate) onPptId(String(candidate)); return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", fullText = "";
  const consume = (raw: string) => { if (!raw || raw === "[DONE]") return; const item = JSON.parse(raw); const text = readStreamValue(item); if (text) { fullText += text; onText(fullText); } const candidate = item?.pptId || item?.data?.pptId || item?.ppt_id; if (candidate) onPptId(String(candidate)); };
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n"); buffer = events.pop() || "";
    for (const event of events) {
      const raw = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      consume(raw);
    }
  }
  if (buffer.trim()) consume(buffer.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n") || buffer.trim());
  return fullText;
}

export function PptStudio({ papers, extractText }: { papers: LibraryPaper[]; extractText: (paper: LibraryPaper) => Promise<string> }) {
  const usablePapers = useMemo(() => papers.filter(paper => !paper.archived_at), [papers]);
  const [paperId, setPaperId] = useState(""), [prompt, setPrompt] = useState(""), [mode, setMode] = useState<Mode>("direct");
  const [markdown, setMarkdown] = useState(""), [preview, setPreview] = useState(""), [result, setResult] = useState<Result>({});
  const [state, setState] = useState<"idle" | "reading" | "generating" | "polling" | "done" | "error">("idle"), [error, setError] = useState("");
  const paper = usablePapers.find(item => item.id === paperId);

  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);
  useEffect(() => { if (!result.pptId || result.fileUrl || state !== "polling") return; const timer = window.setInterval(() => { void pptRequest("status", { pptId: result.pptId }).then(next => { setResult(value => ({ ...value, ...next })); if (next.fileUrl) setState("done"); }).catch(() => undefined); }, 2400); return () => window.clearInterval(timer); }, [result.pptId, result.fileUrl, state]);

  async function generate() {
    if (!paper) { setError("请先在文献工作台添加并选择一份 PDF。"); return; }
    setError(""); setResult({}); setPreview(""); setState("reading");
    try {
      const source = await extractText(paper);
      const instruction = `${prompt.trim() || "请将这篇文献制作成逻辑清晰、适合汇报的中文演示文稿。"}\n\n参考 PDF：《${paper.title}》\n\n${source}`.slice(0, 60000);
      setState("generating");
      if (mode === "direct") {
        const next = await pptRequest("direct", { subject: instruction });
        setResult(next); setState(next.fileUrl ? "done" : "polling"); return;
      }
      if (mode === "markdown") {
        const content = markdown.trim() || `# ${paper.title}\n## 核心观点\n${instruction}`;
        const next = await pptRequest("markdown", { markdown: content, prompt: prompt.trim() });
        setResult(next); setState(next.fileUrl ? "done" : "polling"); return;
      }
      let pptId = "";
      const outline = await pptStream("outline", { subject: instruction }, setPreview, value => { pptId = value; setResult(current => ({ ...current, pptId: value })); });
      const full = await pptStream("content", { outlineMarkdown: outline || preview, asyncGenPptx: true }, setPreview, value => { pptId = value; setResult(current => ({ ...current, pptId: value })); });
      setMarkdown(full || outline || preview);
      setState(pptId ? "polling" : "done");
    } catch (caught) { setState("error"); setError(caught instanceof Error ? caught.message.replace(/^DOCMEE_UPSTREAM_\d+:/, "") : "PPT 生成失败，请稍后重试。"); }
  }

  return <section className="ppt-studio">
    <header><div><span><Presentation size={15}/> AI PRESENTATION</span><h1>AI PPT 制作</h1><p>选择文献 PDF，补充汇报要求，生成可下载的演示文稿。</p></div>{result.fileUrl && <a className="ppt-download" href={result.fileUrl} target="_blank" rel="noreferrer"><Download size={16}/>下载 PPT</a>}</header>
    <div className="ppt-studio-grid"><form className="ppt-form" onSubmit={event => { event.preventDefault(); void generate(); }}>
      <label>选择 PDF<select value={paperId} onChange={event => setPaperId(event.target.value)}>{usablePapers.length ? usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>) : <option value="">文献库暂无 PDF</option>}</select></label>
      <label>制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} placeholder="例如：面向组会汇报，突出研究问题、方法、实验结果和局限性，控制在 10 页以内。"/></label>
      <fieldset><legend>生成方式</legend><label className={mode === "direct" ? "selected" : ""}><input type="radio" checked={mode === "direct"} onChange={() => setMode("direct")}/><b>后台直接生成</b><small>最省事，完成后下载。</small></label><label className={mode === "stream" ? "selected" : ""}><input type="radio" checked={mode === "stream"} onChange={() => setMode("stream")}/><b>流式生成并预览</b><small>实时展示大纲和内容，再异步生成 PPT。</small></label><label className={mode === "markdown" ? "selected" : ""}><input type="radio" checked={mode === "markdown"} onChange={() => setMode("markdown")}/><b>Markdown 转 PPT</b><small>先编辑内容，再排版为 PPT。</small></label></fieldset>
      {mode === "markdown" && <label>Markdown 内容<textarea className="ppt-markdown-input" value={markdown} onChange={event => setMarkdown(event.target.value)} placeholder={'# 演示主题\n## 第一章\n### 页面标题\n- 要点内容'}/></label>}
      <button className="ppt-generate" disabled={state === "reading" || state === "generating" || state === "polling" || !paper}><Sparkles size={17}/>{state === "reading" ? "正在读取 PDF…" : state === "generating" ? "正在生成内容…" : state === "polling" ? `正在生成 PPT${result.progress ? ` · ${result.progress}%` : ""}…` : "开始生成 PPT"}</button>
      {error && <p className="ppt-error">{error}</p>}
    </form><aside className="ppt-preview"><div><span><MonitorPlay size={16}/> 前台预览</span>{state !== "idle" && state !== "done" && <LoaderCircle className="ppt-spin" size={16}/>}</div>{preview || markdown ? <ReactMarkdown>{preview || markdown}</ReactMarkdown> : <div className="ppt-preview-empty"><FileText size={29}/><p>选择“流式生成并预览”后，这里会逐步显示 PPT 大纲与页面内容。</p></div>}{result.pptId && !result.fileUrl && <p className="ppt-progress">已创建生成任务，正在获取可下载文件…</p>}{result.fileUrl && <a className="ppt-result-download" href={result.fileUrl} target="_blank" rel="noreferrer"><Download size={16}/>PPT 已生成，点击下载</a>}</aside></div>
  </section>;
}
