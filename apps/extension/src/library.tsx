import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronRight, FileText, Folder, FolderPlus, MoreHorizontal, Search, Trash2, X } from "lucide-react";
import { supabase } from "./api";

export type LibraryFolder = { id: string; parent_id: string | null; name: string };
export type LibraryPaper = {
  id: string; folder_id: string | null; title: string; original_name: string; source_url: string | null;
  storage_path: string; file_size: number; page_count: number | null; archived_at: string | null; last_opened_at: string; created_at: string;
};

export async function listLibraryPapers(includeArchived = false) {
  let query = supabase.from("library_papers").select("id, folder_id, title, original_name, source_url, storage_path, file_size, page_count, archived_at, last_opened_at, created_at").order("last_opened_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as LibraryPaper[];
}

export async function loadPaperState(paperId: string) {
  const { data, error } = await supabase.from("library_paper_states").select("reader_state, layout_result").eq("paper_id", paperId).maybeSingle();
  if (error) throw error;
  return data as { reader_state?: Record<string, unknown>; layout_result?: Record<string, unknown> } | null;
}

export function LibraryScreen({ onClose, onOpen }: { onClose: () => void; onOpen: (paper: LibraryPaper) => void }) {
  const [papers, setPapers] = useState<LibraryPaper[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [view, setView] = useState<"all" | "archived" | string>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [folderName, setFolderName] = useState("");

  const reload = async () => {
    setLoading(true); setError("");
    try {
      const [nextPapers, folderResult] = await Promise.all([
        listLibraryPapers(view === "archived"),
        supabase.from("library_folders").select("id, parent_id, name").order("name"),
      ]);
      setPapers(nextPapers); if (folderResult.error) throw folderResult.error;
      setFolders((folderResult.data || []) as LibraryFolder[]);
    } catch { setError("文献库暂时无法加载，请稍后重试。"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [view]);

  const visible = useMemo(() => papers.filter(paper => {
    if (view === "archived" ? !paper.archived_at : paper.archived_at) return false;
    if (view !== "all" && view !== "archived" && paper.folder_id !== view) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${paper.title} ${paper.original_name} ${paper.source_url || ""}`.toLowerCase().includes(needle);
  }), [papers, query, view]);
  const createFolder = async () => {
    const name = folderName.trim(); if (!name) return;
    const { error: createError } = await supabase.from("library_folders").insert({ name, parent_id: null });
    if (createError) { setError("无法创建文件夹，该名称可能已存在。"); return; }
    setFolderName(""); void reload();
  };
  const archive = async (paper: LibraryPaper) => {
    await supabase.from("library_papers").update({ archived_at: paper.archived_at ? null : new Date().toISOString() }).eq("id", paper.id);
    void reload();
  };
  const move = async (paper: LibraryPaper, folderId: string) => {
    await supabase.from("library_papers").update({ folder_id: folderId || null }).eq("id", paper.id);
    void reload();
  };
  const rename = async (paper: LibraryPaper) => {
    const title = window.prompt("修改文献题目", paper.title)?.trim();
    if (!title || title === paper.title) return;
    const { error: renameError } = await supabase.from("library_papers").update({ title: title.slice(0, 500) }).eq("id", paper.id);
    if (renameError) setError("题目保存失败，请稍后重试。"); else void reload();
  };
  const remove = async (paper: LibraryPaper) => {
    if (!window.confirm(`删除《${paper.title}》及其 PDF、批注和对话记录？`)) return;
    await supabase.storage.from("library-pdfs").remove([paper.storage_path]);
    await supabase.from("library_papers").delete().eq("id", paper.id);
    void reload();
  };

  return <main className="library-shell">
    <header className="library-header"><div className="library-brand"><img src="/brand/shidea-mark.png" alt=""/><strong>识谛文献库</strong></div><button onClick={onClose}><X size={18}/>返回阅读器</button></header>
    <div className="library-layout">
      <aside className="library-sidebar">
        <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}><FileText size={16}/>全部文献</button>
        <button className={view === "archived" ? "active" : ""} onClick={() => setView("archived")}><Archive size={16}/>已归档</button>
        <p>文件夹</p>
        {folders.map(folder => <button key={folder.id} className={view === folder.id ? "active" : ""} onClick={() => setView(folder.id)}><Folder size={16}/>{folder.name}</button>)}
        <form className="library-new-folder" onSubmit={event => { event.preventDefault(); void createFolder(); }}><input value={folderName} onChange={event => setFolderName(event.target.value)} placeholder="新建文件夹"/><button aria-label="创建文件夹"><FolderPlus size={16}/></button></form>
      </aside>
      <section className="library-content">
        <div className="library-title"><div><p>YOUR READING SPACE</p><h1>{view === "archived" ? "已归档文献" : "我的文献"}</h1></div><label><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索题目、文件名或来源"/></label></div>
        {error && <p className="library-error">{error}</p>}
        {loading ? <p className="library-empty">正在读取你的文献库…</p> : visible.length ? <div className="library-grid">{visible.map(paper => <article key={paper.id} className="library-paper" onClick={() => onOpen(paper)}><div className="library-paper-icon"><FileText size={24}/></div><div className="library-paper-body"><h2>{paper.title}</h2><p>{paper.page_count ? `${paper.page_count} 页 · ` : ""}{(paper.file_size / 1024 / 1024).toFixed(1)} MB</p><small>最近阅读 {new Date(paper.last_opened_at).toLocaleDateString("zh-CN")}</small></div><div className="library-paper-actions" onClick={event => event.stopPropagation()}><select aria-label="移动到文件夹" value={paper.folder_id || ""} onChange={event => void move(paper, event.target.value)}><option value="">未分类</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button title="修改题目" onClick={() => void rename(paper)}><MoreHorizontal size={16}/></button><button title={paper.archived_at ? "恢复" : "归档"} onClick={() => void archive(paper)}><Archive size={16}/></button><button title="删除" onClick={() => void remove(paper)}><Trash2 size={16}/></button></div><ChevronRight className="library-paper-arrow" size={18}/></article>)}</div> : <div className="library-empty"><FileText size={34}/><h2>这里还没有文献</h2><p>打开 PDF 后，识谛会自动安全保存文献、批注、对话与版面分析结果。</p></div>}
      </section>
    </div>
  </main>;
}
