import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Archive, Check, ChevronDown, FilePlus2, FileText, Folder, FolderPlus,
  Heart, LayoutGrid, List, MoreHorizontal, Pencil, Search, Star, Trash2, Upload, X, ChevronLeft, Presentation,
} from "lucide-react";
import { supabase } from "./api";
import { PptStudio } from "./ppt-studio";

export type LibraryFolder = { id: string; parent_id: string | null; name: string };
export type LibraryTag = { id: string; name: string; color: string };
export type LibraryPaper = {
  id: string; folder_id: string | null; title: string; original_name: string; source_url: string | null;
  storage_path: string; file_size: number; page_count: number | null; archived_at: string | null;
  last_opened_at: string; created_at: string; is_favorite?: boolean; document_text?: string | null;
  library_paper_states?: { reader_state?: { currentPage?: number } } | null;
  library_paper_tags?: Array<{ library_tags?: LibraryTag | null }>;
};

type View = "all" | "favorite" | "archived" | "ppt" | string;
type Sort = "recent" | "added" | "title" | "size";
type Dialog = null | { kind: "rename" | "folder" | "tag" | "delete" | "deleteMany" | "folderDelete" | "tagDelete"; paper?: LibraryPaper; papers?: LibraryPaper[]; folder?: LibraryFolder; tag?: LibraryTag; parentId?: string | null };

export async function listLibraryPapers() {
  const { data, error } = await supabase.from("library_papers")
    .select("id, folder_id, title, original_name, source_url, storage_path, file_size, page_count, archived_at, last_opened_at, created_at, is_favorite, library_paper_states(reader_state), library_paper_tags(library_tags(id,name,color))")
    .order("last_opened_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as LibraryPaper[];
}

export async function listBrainstormPapers() {
  const { data, error } = await supabase.from("library_papers")
    .select("id,title,storage_path,page_count,archived_at,document_text")
    .order("last_opened_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as LibraryPaper[];
}

export async function loadPaperState(paperId: string) {
  const { data, error } = await supabase.from("library_paper_states").select("reader_state, layout_result").eq("paper_id", paperId).maybeSingle();
  if (error) throw error;
  return data as { reader_state?: Record<string, unknown>; layout_result?: Record<string, unknown> } | null;
}

function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value)); }
function sourceName(url: string | null) { try { return url ? new URL(url).hostname.replace(/^www\./, "") : "本地 PDF"; } catch { return "本地 PDF"; } }
function progress(paper: LibraryPaper) {
  const current = Number(paper.library_paper_states?.reader_state?.currentPage || 0);
  return paper.page_count && current ? Math.min(100, Math.round(current / paper.page_count * 100)) : 0;
}

export function LibraryScreen({ onClose, onOpen, onImportFile, onImportUrl, extractText, canReturn = true }: {
  onClose: () => void; onOpen: (paper: LibraryPaper) => void; onImportFile: (file: File) => void;
  onImportUrl: (url: string) => Promise<void>; extractText: (paper: LibraryPaper) => Promise<string>; canReturn?: boolean;
}) {
  const [papers, setPapers] = useState<LibraryPaper[]>([]), [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [tags, setTags] = useState<LibraryTag[]>([]), [view, setView] = useState<View>("all"), [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent"), [layout, setLayout] = useState<"list" | "grid">(() => localStorage.getItem("shidea-library-layout") === "grid" ? "grid" : "list");
  const [selected, setSelected] = useState<string[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [menu, setMenu] = useState<string | null>(null), [dialog, setDialog] = useState<Dialog>(null), [name, setName] = useState("");
  const [tagFilter, setTagFilter] = useState(""), [importOpen, setImportOpen] = useState(false), [url, setUrl] = useState(""), [importing, setImporting] = useState(false);
  const [researchOverview, setResearchOverview] = useState(""), [researchDraft, setResearchDraft] = useState(""), [editingResearch, setEditingResearch] = useState(false), [savingResearch, setSavingResearch] = useState(false);

  const reload = async () => {
    setLoading(true); setError("");
    try {
      const [nextPapers, folderResult, tagResult] = await Promise.all([listLibraryPapers(), supabase.from("library_folders").select("id,parent_id,name").order("name"), supabase.from("library_tags").select("id,name,color").order("name")]);
      if (folderResult.error) throw folderResult.error; if (tagResult.error) throw tagResult.error;
      setPapers(nextPapers); setFolders((folderResult.data || []) as LibraryFolder[]); setTags((tagResult.data || []) as LibraryTag[]);
    } catch { setError("文献库暂时无法加载，请稍后重试。"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => { localStorage.setItem("shidea-library-layout", layout); }, [layout]);
  useEffect(() => { void supabase.from("research_profiles").select("overview").maybeSingle().then(({ data }) => { const overview = data?.overview || ""; setResearchOverview(overview); setResearchDraft(overview); }); }, []);

  const visible = useMemo(() => papers.filter(paper => {
    if (view === "ppt") return false;
    if (view === "archived" ? !paper.archived_at : paper.archived_at) return false;
    if (view === "favorite" && !paper.is_favorite) return false;
    if (!(["all", "favorite", "archived"] as string[]).includes(view) && paper.folder_id !== view) return false;
    const paperTags = paper.library_paper_tags?.map(item => item.library_tags?.id).filter(Boolean) || [];
    if (tagFilter && !paperTags.includes(tagFilter)) return false;
    const needle = query.trim().toLowerCase(); return !needle || `${paper.title} ${paper.original_name} ${paper.source_url || ""}`.toLowerCase().includes(needle);
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "size" ? b.file_size - a.file_size : sort === "added" ? +new Date(b.created_at) - +new Date(a.created_at) : +new Date(b.last_opened_at) - +new Date(a.last_opened_at)), [papers, view, query, sort, tagFilter]);
  const totalSize = papers.filter(item => !item.archived_at).reduce((sum, item) => sum + item.file_size, 0);
  const running = papers.filter(item => progress(item) > 0 && progress(item) < 100 && !item.archived_at).length;
  const activeFolder = folders.find(folder => folder.id === view);

  const update = async (ids: string[], values: Record<string, unknown>) => { const { error: updateError } = await supabase.from("library_papers").update(values).in("id", ids); if (updateError) setError("保存失败，请稍后重试。"); else { setSelected([]); void reload(); } };
  const toggleTag = async (paper: LibraryPaper, tag: LibraryTag) => {
    const exists = paper.library_paper_tags?.some(item => item.library_tags?.id === tag.id);
    const result = exists ? await supabase.from("library_paper_tags").delete().eq("paper_id", paper.id).eq("tag_id", tag.id) : await supabase.from("library_paper_tags").insert({ paper_id: paper.id, tag_id: tag.id });
    if (result.error) setError("标签保存失败，请稍后重试。"); else void reload();
  };
  const userId = async () => { const { data } = await supabase.auth.getUser(); if (!data.user) throw new Error("AUTH_REQUIRED"); return data.user.id; };
  const submitDialog = async () => {
    const value = name.trim(); if ((dialog?.kind === "rename" || dialog?.kind === "folder" || dialog?.kind === "tag") && !value) return;
    if (dialog?.kind === "rename" && dialog.paper) await update([dialog.paper.id], { title: value.slice(0, 500) });
    if (dialog?.kind === "folder") {
      if (dialog.folder) { const result = await supabase.from("library_folders").update({ name: value.slice(0, 120) }).eq("id", dialog.folder.id); if (result.error) setError("文件夹保存失败。"); else void reload(); }
      else { try { const result = await supabase.from("library_folders").insert({ name: value.slice(0, 120), parent_id: dialog.parentId || null, user_id: await userId() }); if (result.error) throw result.error; void reload(); } catch { setError("文件夹创建失败，该位置可能已有同名文件夹。"); } }
    }
    if (dialog?.kind === "tag") { const result = dialog.tag ? await supabase.from("library_tags").update({ name: value.slice(0, 48) }).eq("id", dialog.tag.id) : await supabase.from("library_tags").insert({ name: value.slice(0, 48), color: "#0e9f9a", user_id: await userId() }); if (result.error) setError(dialog.tag ? "标签保存失败。" : "标签创建失败，该名称可能已存在。"); else void reload(); }
    if ((dialog?.kind === "delete" || dialog?.kind === "deleteMany") && (dialog.paper || dialog.papers)) {
      const targets = dialog.papers || [dialog.paper!];
      const storage = await supabase.storage.from("library-pdfs").remove(targets.map(item => item.storage_path));
      if (storage.error) setError("PDF 文件删除失败，未移除文献记录。"); else { const result = await supabase.from("library_papers").delete().in("id", targets.map(item => item.id)); if (result.error) setError("文献记录删除失败，请稍后重试。"); else { setSelected([]); void reload(); } }
    }
    if (dialog?.kind === "folderDelete" && dialog.folder) { const result = await supabase.from("library_folders").delete().eq("id", dialog.folder.id); if (result.error) setError("文件夹删除失败，请稍后重试。"); else { setView("all"); void reload(); } }
    if (dialog?.kind === "tagDelete" && dialog.tag) { const result = await supabase.from("library_tags").delete().eq("id", dialog.tag.id); if (result.error) setError("标签删除失败，请稍后重试。"); else { if (tagFilter === dialog.tag.id) setTagFilter(""); void reload(); } }
    setDialog(null); setName("");
  };
  const submitUrl = async () => { if (!url.trim()) return; setImporting(true); try { await onImportUrl(url.trim()); setImportOpen(false); setUrl(""); } catch { setError("无法导入该链接，请确认 URL 或 DOI 后重试。"); } finally { setImporting(false); } };
  const toggleSelected = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  const saveResearchOverview = async () => { const overview = researchDraft.trim().slice(0, 6000); setSavingResearch(true); try { const id = await userId(); const { error: saveError } = await supabase.from("research_profiles").upsert({ user_id: id, overview }, { onConflict: "user_id" }); if (saveError) throw saveError; setResearchOverview(overview); setEditingResearch(false); } catch { setError("研究主线保存失败，请稍后重试。"); } finally { setSavingResearch(false); } };
  const folderLabel = (folder: LibraryFolder, seen = new Set<string>()): string => { if (seen.has(folder.id)) return folder.name; seen.add(folder.id); const parent = folders.find(item => item.id === folder.parent_id); return parent ? `${folderLabel(parent, seen)} / ${folder.name}` : folder.name; };
  const FolderTree = ({ parentId, depth = 0 }: { parentId: string | null; depth?: number }) => <>{folders.filter(folder => folder.parent_id === parentId).map(folder => <div className="library-folder-node" key={folder.id}><div className="library-folder-row" style={{ paddingLeft: `${10 + depth * 16}px` }}><button className={view === folder.id ? "active" : ""} onClick={() => setView(folder.id)}><Folder size={16}/><span className="library-folder-name">{folder.name}</span><em>{papers.filter(paper => paper.folder_id === folder.id && !paper.archived_at).length}</em></button><div><button aria-label="在此文件夹中新建子文件夹" title="新建子文件夹" onClick={() => { setName(""); setDialog({ kind: "folder", parentId: folder.id }); }}><FolderPlus size={14}/></button><button aria-label="管理文件夹" title="重命名或删除" onClick={() => { setName(folder.name); setDialog({ kind: "folder", folder }); }}><MoreHorizontal size={15}/></button></div></div><FolderTree parentId={folder.id} depth={depth + 1}/></div>)}</>;

  const Paper = ({ paper }: { paper: LibraryPaper }) => <article className={`library-paper ${layout === "grid" ? "library-paper-grid" : ""}`} onClick={() => onOpen(paper)}>
    <button className={`library-select ${selected.includes(paper.id) ? "selected" : ""}`} aria-label="选择文献" onClick={event => { event.stopPropagation(); toggleSelected(paper.id); }}>{selected.includes(paper.id) && <Check size={13}/>}</button>
    <div className="library-paper-icon"><FileText size={22}/><span>PDF</span></div>
    <div className="library-paper-body"><div className="library-paper-heading"><h2>{paper.title}</h2>{paper.is_favorite && <Star className="library-favorite" size={15} fill="currentColor"/>}</div><p className="library-paper-meta">{sourceName(paper.source_url)} <i/> {paper.page_count || "—"} 页 <i/> {formatBytes(paper.file_size)}</p><div className="library-tags">{paper.library_paper_tags?.slice(0, 3).map(item => item.library_tags && <span key={item.library_tags.id} style={{ "--tag-color": item.library_tags.color } as CSSProperties}>{item.library_tags.name}</span>)}</div><div className="library-progress"><span><b style={{ width: `${progress(paper)}%` }}/></span><small>{progress(paper) ? `${progress(paper)}% · 最近阅读 ${formatDate(paper.last_opened_at)}` : "尚未开始阅读"}</small></div></div>
    <div className="library-paper-actions" onClick={event => event.stopPropagation()}><button aria-label="更多操作" onClick={() => setMenu(menu === paper.id ? null : paper.id)}><MoreHorizontal size={18}/></button>{menu === paper.id && <div className="library-menu"><button onClick={() => void update([paper.id], { is_favorite: !paper.is_favorite })}><Star size={15}/>{paper.is_favorite ? "取消收藏" : "收藏"}</button><button onClick={() => { setName(paper.title); setDialog({ kind: "rename", paper }); setMenu(null); }}><Pencil size={15}/>编辑标题</button><label><Folder size={15}/>移动到<select value={paper.folder_id || ""} onChange={event => void update([paper.id], { folder_id: event.target.value || null })}><option value="">未分类</option>{folders.map(folder => <option value={folder.id} key={folder.id}>{folderLabel(folder)}</option>)}</select></label><div className="library-menu-tags"><span>标签</span>{tags.map(tag => <button key={tag.id} className={paper.library_paper_tags?.some(item => item.library_tags?.id === tag.id) ? "active" : ""} onClick={() => void toggleTag(paper, tag)}>{tag.name}</button>)}</div><button onClick={() => void update([paper.id], { archived_at: paper.archived_at ? null : new Date().toISOString() })}><Archive size={15}/>{paper.archived_at ? "恢复文献" : "归档"}</button><button className="danger" onClick={() => { setDialog({ kind: "delete", paper }); setMenu(null); }}><Trash2 size={15}/>永久删除</button></div>}</div>
  </article>;

  return <main className="library-shell" onClick={() => menu && setMenu(null)}>
    <header className="library-header"><div className="library-brand"><img src="/brand/shidea-mark.png" alt=""/><div><strong>识谛</strong><small>文献工作台</small></div></div><div className="library-global-search"><Search size={17}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、文件名或来源"/></div><div className="library-header-actions"><button className="library-add" onClick={() => setImportOpen(true)}><FilePlus2 size={17}/>添加文献</button>{canReturn && <button className="library-return" onClick={onClose}><ChevronLeft size={17}/>返回阅读</button>}</div></header>
    <div className="library-layout"><aside className="library-sidebar"><nav><button className={view === "all" ? "active" : ""} onClick={() => setView("all")}><FileText size={17}/>全部文献 <span>{papers.filter(item => !item.archived_at).length}</span></button><button className={view === "favorite" ? "active" : ""} onClick={() => setView("favorite")}><Heart size={17}/>我的收藏 <span>{papers.filter(item => item.is_favorite && !item.archived_at).length}</span></button><button className={view === "archived" ? "active" : ""} onClick={() => setView("archived")}><Archive size={17}/>已归档 <span>{papers.filter(item => item.archived_at).length}</span></button><button className={view === "ppt" ? "active" : ""} onClick={() => setView("ppt")}><Presentation size={17}/>AI PPT 制作</button></nav><div className="library-side-section"><div><p>文件夹</p><button aria-label="新建根文件夹" onClick={() => { setName(""); setDialog({ kind: "folder", parentId: null }); }}><FolderPlus size={16}/></button></div><FolderTree parentId={null}/></div><div className="library-side-section"><div><p>标签</p><button aria-label="新建标签" onClick={() => { setName(""); setDialog({ kind: "tag" }); }}>+</button></div><div className="library-tag-filter">{tags.map(tag => <div className="library-tag-row" key={tag.id}><button className={tagFilter === tag.id ? "active" : ""} onClick={() => setTagFilter(tagFilter === tag.id ? "" : tag.id)}><i style={{ background: tag.color }}/>{tag.name}</button><button aria-label={`管理标签 ${tag.name}`} onClick={() => { setName(tag.name); setDialog({ kind: "tag", tag }); }}><MoreHorizontal size={14}/></button></div>)}</div></div></aside>
      <section className="library-content">{view === "ppt" ? <PptStudio papers={papers} extractText={extractText}/> : <><div className="library-page-heading"><div><p>YOUR READING SPACE</p><h1>{activeFolder?.name || (view === "archived" ? "已归档文献" : view === "favorite" ? "我的文献" : "最近阅读")}</h1><span>{visible.length} 篇文献</span></div><div className="library-tools">{activeFolder && <button className="library-folder-settings" aria-label="管理当前文件夹" onClick={() => { setName(activeFolder.name); setDialog({ kind: "folder", folder: activeFolder }); }}><Pencil size={16}/>管理文件夹</button>}<select aria-label="排序方式" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">标题 A–Z</option><option value="size">文件大小</option></select><div><button className={layout === "list" ? "active" : ""} aria-label="列表视图" onClick={() => setLayout("list")}><List size={17}/></button><button className={layout === "grid" ? "active" : ""} aria-label="网格视图" onClick={() => setLayout("grid")}><LayoutGrid size={17}/></button></div></div></div>
        <section className={`research-overview${editingResearch ? " editing" : ""}`}><div className="research-overview-heading"><div><p>RESEARCH THREAD</p><h2>我的工作概述</h2></div><button type="button" onClick={() => { if (editingResearch) { setResearchDraft(researchOverview); setEditingResearch(false); } else setEditingResearch(true); }}>{editingResearch ? "取消" : researchOverview ? "编辑" : "建立研究主线"}</button></div>{editingResearch ? <><textarea autoFocus maxLength={6000} value={researchDraft} onChange={event => setResearchDraft(event.target.value)} placeholder="写下你正在解决的问题、目标对象、方法偏好、约束条件与近期目标。Brainstorm 会将它作为每次分析的研究主线。"/><div className="research-overview-actions"><span>{researchDraft.length}/6000</span><button type="button" onClick={() => void saveResearchOverview()} disabled={savingResearch}>{savingResearch ? "保存中…" : "保存研究主线"}</button></div></> : <p className={researchOverview ? "" : "empty"}>{researchOverview || "尚未建立研究主线。用几句话定义你正在推进的工作，Brainstorm 将据此把文献转化为可执行的启发。"}</p>}</section>
        {view !== "archived" && <div className="library-stats"><div><span>文献总数</span><strong>{papers.filter(item => !item.archived_at).length}</strong></div><div><span>阅读进行中</span><strong>{running}</strong></div><div><span>我的收藏</span><strong>{papers.filter(item => item.is_favorite && !item.archived_at).length}</strong></div><div><span>已用存储</span><strong>{formatBytes(totalSize)}</strong></div></div>}
        {error && <div className="library-error"><span>{error}</span><button onClick={() => void reload()}>重试</button></div>}
        {selected.length > 0 && <div className="library-bulk" onClick={event => event.stopPropagation()}><strong>已选择 {selected.length} 篇</strong><button onClick={() => void update(selected, { is_favorite: true })}><Star size={15}/>收藏</button><label><Folder size={15}/>移动到<select defaultValue="" onChange={event => event.target.value && void update(selected, { folder_id: event.target.value })}><option value="" disabled>选择文件夹</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderLabel(folder)}</option>)}</select></label><button onClick={() => void update(selected, { archived_at: new Date().toISOString() })}><Archive size={15}/>归档</button><button className="bulk-danger" onClick={() => setDialog({ kind: "deleteMany", papers: papers.filter(paper => selected.includes(paper.id)) })}><Trash2 size={15}/>删除</button><button onClick={() => setSelected([])}>取消选择</button></div>}
        {loading ? <div className="library-skeleton"><i/><i/><i/><i/></div> : visible.length ? <div className={`library-paper-list ${layout}`}>{visible.map(paper => <Paper key={paper.id} paper={paper}/>)}</div> : <div className="library-empty"><FileText size={34}/><h2>{query || tagFilter ? "没有匹配的文献" : "你的文献库还是空的"}</h2><p>{query || tagFilter ? "试试调整搜索词或筛选条件。" : "上传 PDF 或输入 DOI / 链接，开始建立你的个人研究空间。"}</p>{!query && !tagFilter && <button className="library-add" onClick={() => setImportOpen(true)}><Upload size={17}/>添加第一篇文献</button>}</div>}</>}
      </section></div>
    {importOpen && <div className="library-modal-backdrop" onMouseDown={() => setImportOpen(false)}><section className="library-modal" onMouseDown={event => event.stopPropagation()}><button className="library-modal-back" aria-label="返回文献库" onClick={() => setImportOpen(false)}><ChevronLeft size={19}/></button><button className="library-modal-close" aria-label="关闭" onClick={() => setImportOpen(false)}><X size={18}/></button><FilePlus2 size={26}/><h2>添加文献</h2><p>上传本地 PDF，或通过 DOI / 论文链接导入。</p><label className="library-upload"><Upload size={17}/>选择本地 PDF<input type="file" accept="application/pdf" onChange={event => { const file = event.target.files?.[0]; if (file) { onImportFile(file); setImportOpen(false); } }}/></label><div className="library-modal-divider"><span>或</span></div><form onSubmit={event => { event.preventDefault(); void submitUrl(); }}><input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="DOI 或论文链接"/><button className="library-add" disabled={importing}>{importing ? "正在导入…" : "导入"}</button></form></section></div>}
    {dialog && <div className="library-modal-backdrop" onMouseDown={() => setDialog(null)}><section className="library-modal library-confirm" onMouseDown={event => event.stopPropagation()}><button className="library-modal-close" aria-label="关闭" onClick={() => setDialog(null)}><X size={18}/></button>{dialog.kind === "delete" || dialog.kind === "deleteMany" ? <><Trash2 size={26}/><h2>永久删除文献？</h2><p>{dialog.kind === "deleteMany" ? `将永久移除 ${dialog.papers?.length || 0} 篇文献的 PDF、批注和阅读记录，且无法恢复。` : `《${dialog.paper?.title}》的 PDF、批注和阅读记录将被永久移除，且无法恢复。`}</p></> : dialog.kind === "folderDelete" ? <><Trash2 size={26}/><h2>删除文件夹？</h2><p>该文件夹及其子文件夹会被删除；其中的文献不会删除，会自动回到未分类。</p></> : dialog.kind === "tagDelete" ? <><Trash2 size={26}/><h2>删除标签？</h2><p>标签将从所有文献中移除，文献本身不会受影响。</p></> : <><Pencil size={24}/><h2>{dialog.kind === "rename" ? "编辑文献标题" : dialog.kind === "tag" ? dialog.tag ? "编辑标签" : "新建标签" : dialog.folder ? "重命名文件夹" : dialog.parentId ? "新建子文件夹" : "新建文件夹"}</h2><input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => event.key === "Enter" && void submitDialog()} placeholder="输入名称"/>{dialog.folder && <button className="library-folder-delete" onClick={() => setDialog({ kind: "folderDelete", folder: dialog.folder })}>删除此文件夹</button>}{dialog.tag && <button className="library-folder-delete" onClick={() => setDialog({ kind: "tagDelete", tag: dialog.tag })}>删除此标签</button>}</>}<div className="library-confirm-actions"><button onClick={() => setDialog(null)}>取消</button><button className={dialog.kind === "delete" || dialog.kind === "deleteMany" || dialog.kind === "folderDelete" || dialog.kind === "tagDelete" ? "danger" : "library-add"} onClick={() => void submitDialog()}>{dialog.kind === "delete" || dialog.kind === "deleteMany" ? "永久删除" : dialog.kind === "folderDelete" ? "删除文件夹" : dialog.kind === "tagDelete" ? "删除标签" : "保存"}</button></div></section></div>}
  </main>;
}
