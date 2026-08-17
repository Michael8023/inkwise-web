import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, History, LoaderCircle, MonitorPlay, Presentation, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { functionRequest } from "./api";
import type { LibraryPaper } from "./library";

type Phase = "reading" | "outlining" | "generating" | "completed" | "failed";
type Result = { pptId?: string; fileUrl?: string; total?: number; current?: number; progress?: number };
type Task = { id: string; paperId: string; paperTitle: string; prompt: string; markdown: string; createdAt: string; phase: Phase; result: Result; error?: string };
const storageKey = "shidea-ai-ppt-history";

function errorMessage(value: unknown) {
  const error = String(value || "");
  if (error.includes("PPT_CREDITS_INSUFFICIENT")) return "本月免费 PPT 额度已用完，当前积分不足 20 分。";
  if (error.includes("PPT_TRIAL_USED")) return "免费试用已经使用过，开通 Pro 后可继续制作 PPT。";
  return error || "PPT 任务失败";
}
async function request(action: string, request: Record<string, unknown>) {
  const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, request }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(payload.error));
  return payload as Result;
}
async function stream(action: "outline" | "content", requestBody: Record<string, unknown>, onText: (text: string) => void, onPptId: (id: string) => void) {
  const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, request: { ...requestBody, stream: true } }) });
  if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})); throw new Error(errorMessage(payload.error)); }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", full = "";
  const consume = (raw: string) => {
    const value = raw.trim().replace(/^data:\s*/, ""); if (!value || value === "[DONE]") return;
    try {
      const item = JSON.parse(value) as Record<string, any>;
      const text = typeof item.delta === "string" ? item.delta : typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : typeof item.data?.content === "string" ? item.data.content : "";
      if (text) { full += text; onText(full); }
      const pptId = item.pptId || item.ppt_id || item.data?.pptId || item.data?.ppt_id;
      if (pptId) onPptId(String(pptId));
    } catch { /* Ignore provider keep-alive events. */ }
  };
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ""; events.forEach(consume); }
  if (buffer.trim()) consume(buffer); return full;
}
function persist(tasks: Task[]) { try { localStorage.setItem(storageKey, JSON.stringify(tasks.slice(0, 30))); } catch { /* Local history is optional. */ } }

export function PptStudio({ papers, extractText, loadLayoutMarkdown }: { papers: LibraryPaper[]; extractText: (paper: LibraryPaper) => Promise<string>; loadLayoutMarkdown: (paperId: string) => Promise<string> }) {
  const usablePapers = useMemo(() => papers.filter(item => !item.archived_at), [papers]);
  const [paperId, setPaperId] = useState(""), [prompt, setPrompt] = useState(""), [tasks, setTasks] = useState<Task[]>([]), [activeId, setActiveId] = useState<string | null>(null), [error, setError] = useState("");
  const taskRef = useRef<Task[]>([]), watching = useRef(new Set<string>());
  const paper = usablePapers.find(item => item.id === paperId);
  const active = activeId ? tasks.find(item => item.id === activeId) : null;
  const update = (id: string, patch: Partial<Task>) => setTasks(current => { const next = current.map(task => task.id === id ? { ...task, ...patch } : task); taskRef.current = next; persist(next); return next; });
  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(storageKey) || "[]"); if (Array.isArray(saved)) { const next = saved as Task[]; taskRef.current = next; setTasks(next); } } catch { persist([]); } }, []);
  useEffect(() => { taskRef.current = tasks; }, [tasks]);

  const watchTask = async (id: string, pptId: string) => {
    if (watching.current.has(id)) return; watching.current.add(id);
    try { while (true) { await new Promise(resolve => window.setTimeout(resolve, 2_200)); const task = taskRef.current.find(item => item.id === id); if (!task || task.phase !== "generating") break;
      try { let result = await request("status", { pptId }); if (!result.fileUrl && result.total && result.current && result.current >= result.total) result = await request("download", { id: pptId });
        update(id, { result: { ...task.result, ...result, pptId }, phase: result.fileUrl ? "completed" : "generating" }); if (result.fileUrl) break;
      } catch (caught) { update(id, { phase: "failed", error: errorMessage(caught instanceof Error ? caught.message : caught) }); break; }
    } } finally { watching.current.delete(id); }
  };
  useEffect(() => { tasks.filter(task => task.phase === "generating" && task.result.pptId).forEach(task => void watchTask(task.id, task.result.pptId!)); }, [tasks]);

  async function createTask() {
    if (!paper) return;
    const id = crypto.randomUUID(); const task: Task = { id, paperId: paper.id, paperTitle: paper.title, prompt, markdown: "", createdAt: new Date().toISOString(), phase: "reading", result: {} };
    setTasks(current => { const next = [task, ...current].slice(0, 30); taskRef.current = next; persist(next); return next; }); setActiveId(id); setError("");
    try {
      const layoutMarkdown = await loadLayoutMarkdown(paper.id);
      const source = layoutMarkdown.trim() || await extractText(paper);
      if (!source.trim()) throw new Error("未能读取论文资料，请先完成 PDF 解析。");
      update(id, { phase: "outlining" });
      const subject = [prompt.trim() || "制作学术汇报 PPT，突出研究问题、方法、实验结果、局限性和结论。", `# ${paper.title}`, "## 资料来源", source].join("\n\n").slice(0, 60_000);
      const outline = await stream("outline", { subject }, markdown => update(id, { markdown }), () => undefined);
      const markdown = outline || taskRef.current.find(item => item.id === id)?.markdown || subject;
      update(id, { markdown, phase: "generating" });
      let pptId = "";
      await stream("content", { outlineMarkdown: markdown, asyncGenPptx: true, billingRequestId: crypto.randomUUID() }, () => undefined, value => { pptId = value; update(id, { result: { pptId: value } }); });
      if (!pptId) throw new Error("PPT 任务未返回任务编号，请重试。");
      void watchTask(id, pptId);
    } catch (caught) { const message = errorMessage(caught instanceof Error ? caught.message : caught); update(id, { phase: "failed", error: message }); setError(message); }
  }
  const label = (task: Task) => ({ reading: "读取资料", outlining: "生成大纲", generating: "排版生成中", completed: "已完成", failed: "已失败" })[task.phase];
  if (active) return <section className="ppt-studio ppt-studio-v2 ppt-detail-page"><header><div><span><Presentation size={15}/> PPT TASK DETAIL</span><h1>{active.paperTitle}</h1><p>创建于 {new Date(active.createdAt).toLocaleString("zh-CN")} · {label(active)}</p></div><button className="ppt-back" onClick={() => setActiveId(null)}><ArrowLeft size={16}/>返回任务列表</button></header>{active.result.fileUrl && <a className="ppt-download" href={active.result.fileUrl} target="_blank" rel="noreferrer"><Download size={16}/>下载 PPT</a>}{active.error && <p className="ppt-error">{active.error}</p>}<section className="ppt-markdown-panel"><div className="ppt-panel-heading"><span><MonitorPlay size={16}/>生成大纲</span><small>{label(active)}</small></div><div className="ppt-markdown-scroll">{active.markdown ? <ReactMarkdown>{active.markdown}</ReactMarkdown> : <div className="ppt-preview-empty"><LoaderCircle className="ppt-spin" size={28}/><p>正在读取 MinerU 版面分析资料并生成大纲。</p></div>}</div></section><section className="ppt-slide-panel"><div className="ppt-panel-heading"><span><Presentation size={16}/>PPT 生成状态</span><small>{active.result.total ? `${active.result.current || 0} / ${active.result.total} 页` : label(active)}</small></div><div className="ppt-preview-empty">{active.phase === "completed" ? <Download size={30}/> : <LoaderCircle className="ppt-spin" size={30}/>}<p>{active.phase === "completed" ? "PPT 已完成，可下载并在 PowerPoint/WPS 中编辑。" : "版面正在生成，任务会在后台持续更新。"}</p></div></section></section>;
  return <section className="ppt-studio ppt-studio-v2"><header><div><span><Presentation size={15}/> AI PRESENTATION</span><h1>AI PPT 制作</h1><p>从 MinerU 版面分析资料创建任务，在任务中心跟踪大纲、排版和下载。</p></div></header><form className="ppt-form ppt-config" onSubmit={event => { event.preventDefault(); void createTask(); }}><label>选择 PDF<select value={paperId} onChange={event => setPaperId(event.target.value)}>{usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="ppt-prompt">制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2_000} placeholder="例如：面向组会汇报，突出消融实验、数据表格和统计显著性，控制在 10 页以内。"/></label><button className="ppt-generate" disabled={!paper}><Sparkles size={17}/>创建 PPT 任务</button>{error && <p className="ppt-error">{error}</p>}</form><section className="ppt-history ppt-task-list"><div className="ppt-history-head"><span><History size={16}/>PPT 任务 <b>{tasks.length}</b></span><small>点击任务查看大纲、生成进度和下载文件</small></div><div className="ppt-history-list">{tasks.length ? tasks.map(task => <article key={task.id}><button type="button" onClick={() => setActiveId(task.id)}><Presentation size={17}/><span><b>{task.paperTitle}</b><small>{new Date(task.createdAt).toLocaleString("zh-CN")}</small></span></button><em className={`ppt-status ${task.phase}`}>{label(task)}</em></article>) : <p>还没有 PPT 任务。选择 PDF 并创建任务后会显示在这里。</p>}</div></section></section>;
}
