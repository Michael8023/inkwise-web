import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, History, Presentation, Sparkles, Trash2 } from "lucide-react";
import { CreatorType, DocmeeUI } from "@docmee/sdk-ui";
import { functionRequest, supabase } from "./api";
import type { LibraryPaper } from "./library";

type Project = {
  id: string; paper_id: string; title: string; prompt: string; status: string;
  docmee_ppt_id?: string | null; last_event?: Record<string, unknown> | null;
  created_at: string; updated_at: string;
};

type Session = { project: Project; token: string; sourceContent?: string; docmeeUid: string; paper?: LibraryPaper };

async function embedRequest(input: Record<string, unknown>) {
  const response = await functionRequest("docmee-embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "DOCMEE_EMBED_FAILED"));
  return payload as Record<string, any>;
}

function eventStatus(type: string): Project["status"] | undefined {
  if (["afterGenerate", "manuallySavePPT", "automaticSavePPT"].includes(type)) return "completed";
  if (["beforeGenerate", "beforeCreatePpt"].includes(type)) return "generating";
  if (type === "error") return "failed";
  // Navigation, mount and template-dialog events must not overwrite a saved
  // completed state with "editing".
  return undefined;
}

export function PptStudio({ papers, extractText, userId: _userId }: { papers: LibraryPaper[]; extractText: (paper: LibraryPaper) => Promise<string>; userId?: string }) {
  const [paperId, setPaperId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const docmeeRef = useRef<DocmeeUI | null>(null);
  const activeRef = useRef<Session | null>(null);

  const usablePapers = papers.filter(paper => !paper.archived_at);
  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);
  useEffect(() => { void embedRequest({ action: "list" }).then(payload => setProjects((payload.projects || []) as Project[])).catch(() => undefined); }, []);

  async function openProject(project: Project, sourceContent = "") {
    setError("");
    const tokenPayload = await embedRequest({ action: "refresh-token" });
    const paper = usablePapers.find(item => item.id === project.paper_id);
    if (!project.docmee_ppt_id && !sourceContent && paper) {
      try { sourceContent = await extractText(paper); } catch { /* The creator still permits a manual upload. */ }
    }
    const session = { project, token: tokenPayload.token as string, sourceContent, docmeeUid: tokenPayload.docmeeUid as string, paper };
    activeRef.current = session; setActive(session);
  }

  async function createProject() {
    const paper = usablePapers.find(item => item.id === paperId);
    if (!paper || loading) return;
    setLoading(true); setError("");
    try {
      let sourceContent = "";
      try { sourceContent = await extractText(paper); } catch { /* Docmee's iframe uploader remains available. */ }
      const payload = await embedRequest({ action: "session", paperId: paper.id, prompt, sourceContent });
      setProjects(current => [payload.project as Project, ...current.filter(item => item.id !== payload.project.id)]);
      const session = { project: payload.project as Project, token: payload.token as string, sourceContent: String(payload.sourceContent || sourceContent || ""), docmeeUid: String(payload.docmeeUid || ""), paper };
      activeRef.current = session; setActive(session);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建 PPT 任务失败"); }
    finally { setLoading(false); }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`删除“${project.title}”这条 PPT 任务记录？这不会删除 Docmee 中已经生成的 PPT。`)) return;
    setError("");
    try {
      await embedRequest({ action: "delete", projectId: project.id });
      setProjects(current => current.filter(item => item.id !== project.id));
      if (active?.project.id === project.id) setActive(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除 PPT 任务失败"); }
  }

  useEffect(() => {
    if (!active) return;
    const container = document.getElementById("docmee-ppt-v2-container") as HTMLDivElement | null;
    if (!container) return;
    docmeeRef.current?.destroy();
    const content = [active.project.prompt, active.sourceContent].filter(Boolean).join("\n\n").slice(0, 60_000);
    let cancelled = false;
    const mount = async () => {
      let sourceFile: File | undefined;
      if (active.paper?.storage_path) {
        try {
          const signed = await supabase.storage.from("library-pdfs").createSignedUrl(active.paper.storage_path, 300);
          if (signed.data?.signedUrl) {
            const response = await fetch(signed.data.signedUrl);
            if (response.ok) sourceFile = new File([await response.blob()], active.paper.original_name || "document.pdf", { type: "application/pdf" });
          }
        } catch { /* Fall back to extracted text if the private PDF cannot be fetched. */ }
      }
      if (cancelled) return;
    const ui = new DocmeeUI({
      container,
      page: active.project.docmee_ppt_id ? "editor" : "creator",
      pptId: active.project.docmee_ppt_id || undefined,
      creatorVersion: "v2",
      token: active.token,
      lang: "zh",
      mode: "light",
      downloadButton: ["pptx"],
      creatorData: active.project.docmee_ppt_id ? undefined : {
        type: sourceFile ? CreatorType.UPLOAD_FILES : (content ? CreatorType.CONTENT : CreatorType.AI_GEN),
        files: sourceFile ? [sourceFile] : undefined,
        content: content || undefined,
        subject: active.project.title,
        options: { prompt: active.project.prompt || "制作适合汇报的中文演示文稿", scene: "研究报告", audience: "同事", length: "medium" },
      },
      // The current SDK runtime supports this V2 option although older type
      // declarations do not expose it yet.
      createCustomTemplateWhenSelect: true,
      onMessage: (message: { type: string; data?: unknown }) => {
        const data = message.data && typeof message.data === "object" ? message.data as Record<string, any> : {};
        const docmeePptId = String(data.id || data.pptId || data.ppt_id || "");
        const status = eventStatus(message.type);
        void embedRequest({ action: "update", projectId: active.project.id, docmeePptId: docmeePptId || undefined, status, event: { type: message.type, data } }).then(payload => {
          if (payload.project) setProjects(current => current.map(item => item.id === active.project.id ? payload.project as Project : item));
        }).catch(() => undefined);
        if (message.type === "invalid-token") void embedRequest({ action: "refresh-token" }).then(payload => ui.updateToken(String(payload.token))).catch(() => undefined);
      },
    } as any);
    docmeeRef.current = ui;
    };
    void mount();
    return () => { cancelled = true; docmeeRef.current?.destroy(); docmeeRef.current = null; };
  }, [active]);

  if (active) return <section className="ppt-studio ppt-studio-v2 ppt-docmee-task"><header><div><span><Presentation size={15}/> DOCMEE PPT TASK CENTER</span><h1>{active.project.title}</h1><p>在任务中心继续修改大纲、选择模板、上传自定义模板并生成 PPT。</p></div><button className="ppt-back" onClick={() => { docmeeRef.current?.destroy(); setActive(null); }}><ArrowLeft size={16}/>返回任务列表</button></header><div id="docmee-ppt-v2-container" className="docmee-ppt-v2-container" /></section>;

  return <section className="ppt-studio ppt-studio-v2"><header><div><span><Presentation size={15}/> DOCMEE PPT V2</span><h1>AI PPT 任务中心</h1><p>选择 PDF 后创建任务，随后在 Docmee V2 中完成大纲、模板和 PPT 生成。</p></div></header><form className="ppt-form ppt-config" onSubmit={event => { event.preventDefault(); void createProject(); }}><label>选择 PDF<select value={paperId} onChange={event => setPaperId(event.target.value)}>{usablePapers.length ? usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>) : <option value="">文献库暂无 PDF</option>}</select></label><label className="ppt-prompt">制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} placeholder="例如：面向组会汇报，突出研究问题、方法、实验结果和局限性。"/></label><button className="ppt-generate" disabled={!paperId || loading}><Sparkles size={17}/>{loading ? "正在创建任务…" : "创建 PPT 任务"}</button>{error && <p className="ppt-error">{error}</p>}</form><section className="ppt-history ppt-task-list"><div className="ppt-history-head"><span><History size={16}/>PPT 任务 <b>{projects.length}</b></span><small>点击任务继续编辑</small></div><div className="ppt-history-list">{projects.length ? projects.map(project => <article key={project.id}><button onClick={() => void openProject(project)}><FileText size={17}/><span><b>{project.title}</b><small>{new Date(project.updated_at).toLocaleString("zh-CN")}</small></span></button><em className={`ppt-status ${project.status}`}>{project.status === "completed" ? "已完成" : project.status === "generating" ? "生成中" : project.status === "failed" ? "失败" : "编辑中"}</em>{project.docmee_ppt_id && <span className="ppt-docmee-bound" title="已绑定 Docmee PPT"><Download size={13}/></span>}<button className="ppt-task-delete" type="button" aria-label={`删除 ${project.title}`} title="删除任务记录" onClick={() => void deleteProject(project)}><Trash2 size={15}/></button></article>) : <p>还没有 PPT 任务。选择 PDF 并点击创建任务。</p>}</div></section></section>;
}
