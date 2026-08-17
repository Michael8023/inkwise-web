import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FileText, Presentation, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { functionRequest } from "./api";
import type { LibraryPaper } from "./library";

type Template = { id: string; name: string; coverUrl?: string };
const maxMaterialCharacters = 20_000;

function extractDataCandidates(text: string) {
  const values = text.match(/(?:\b\d+(?:\.\d+)?\s*(?:%|ms|s|min|h|Hz|kHz|MHz|GHz|nm|μm|mm|cm|m|kg|g|mg|mL|μL|dB|K|°C|p\s*[<=>]\s*0?\.\d+)|\b(?:n|N)\s*=\s*\d+|\b(?:mean|accuracy|loss|F1|AUC)\s*[=:]\s*\d+(?:\.\d+)?)/gi) || [];
  return [...new Set(values.map(value => value.replace(/\s+/g, " ")))].slice(0, 24);
}

function materialForDocmee(title: string, prompt: string, source: string) {
  return [
    `# ${title}`,
    "## 学术演示制作约束（必须遵守）",
    "- 仅使用下方已确认的 MinerU Markdown；不得编造研究结论、实验设置、数值、单位、样本量或显著性。",
    "- 所有实验数据必须原样保留：数值、单位、误差、p 值、样本量和比较对象不得改写或合并；资料未明确时标为“原文未说明”。",
    "- 每个 Markdown 表格必须保留列名、行名和单元格数值，并在结果部分生成对应的数据表或图表，不可压缩为普通文字。",
    "- 流程、算法和实验步骤应生成独立的可编辑流程图页，节点、顺序及判断分支不得遗漏。",
    "- 采用简洁专业的学术报告风格；每页一个核心论点，结果页优先表格、图表和流程图。",
    `- 用户要求：${prompt.trim() || "突出研究问题、方法、实验结果、局限性和结论。"}`,
    "## 已确认的论文资料",
    source.slice(0, maxMaterialCharacters),
  ].join("\n\n");
}

async function request<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await functionRequest("ai-ppt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "DOCMEE_REQUEST_FAILED");
  return result as T;
}

export function PptStudio({ papers, extractText, loadLayoutMarkdown }: {
  papers: LibraryPaper[];
  extractText: (paper: LibraryPaper) => Promise<string>;
  loadLayoutMarkdown: (paperId: string) => Promise<string>;
}) {
  const usablePapers = useMemo(() => papers.filter(paper => !paper.archived_at), [papers]);
  const [paperId, setPaperId] = useState(""), [prompt, setPrompt] = useState(""), [source, setSource] = useState("");
  const [sourceKind, setSourceKind] = useState<"markdown" | "text" | null>(null), [confirmed, setConfirmed] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]), [templateId, setTemplateId] = useState(""), [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState(""), [fileUrl, setFileUrl] = useState("");
  const paper = usablePapers.find(item => item.id === paperId);
  const dataCandidates = useMemo(() => extractDataCandidates(source), [source]);
  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);

  async function loadSource() {
    if (!paper) return;
    setLoading(true); setError(""); setNotice(""); setFileUrl(""); setConfirmed(false);
    try {
      const markdown = await loadLayoutMarkdown(paper.id);
      const value = markdown.trim() || await extractText(paper);
      if (!value.trim()) throw new Error("未能读取论文资料，请先完成 PDF 解析。");
      setSource(value.slice(0, maxMaterialCharacters)); setSourceKind(markdown.trim() ? "markdown" : "text");
      const result = await request<{ templates: Template[] }>("templates");
      setTemplates(result.templates || []); setTemplateId(result.templates?.[0]?.id || "");
      setNotice(markdown.trim() ? "已载入 MinerU Markdown；表格、图注和流程结构将优先用于生成。" : "未找到已保存的版面分析 Markdown，当前为纯文本。建议先完成“智能版面分析”后再生成。 ");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "资料读取失败"); }
    finally { setLoading(false); }
  }

  async function generate() {
    if (!paper || !source.trim() || !confirmed) return;
    setLoading(true); setError(""); setFileUrl(""); setNotice("正在由 Docmee 生成学术 PPT…");
    try {
      const generated = await request<{ pptId: string; name?: string }>("generate", { templateId, markdown: materialForDocmee(paper.title, prompt, source) });
      for (let retry = 0; retry < 30; retry += 1) {
        const downloaded = await request<{ fileUrl?: string }>("download", { pptId: generated.pptId });
        if (downloaded.fileUrl) { setFileUrl(downloaded.fileUrl); setNotice(`${generated.name || "PPT"} 已生成，可下载或在 PowerPoint 中继续编辑。`); return; }
        await new Promise(resolve => window.setTimeout(resolve, 2_000));
      }
      setNotice("PPT 已提交生成，但文件仍在处理中；请稍后重新生成或刷新后重试。 ");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "PPT 生成失败"); }
    finally { setLoading(false); }
  }

  return <section className="ppt-studio docmee-studio">
    <header><div><span><Presentation size={15}/> DOCMEE API</span><h1>学术 PPT 创作</h1><p>一体化生成：核验 MinerU Markdown、选择模板、生成并下载，无需跳转到第三方界面。</p></div></header>
    <section className="docmee-review">
      <label>选择 PDF<select value={paperId} onChange={event => { setPaperId(event.target.value); setSource(""); setConfirmed(false); setFileUrl(""); }}><option value="">请选择文献</option>{usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="docmee-prompt">制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={800} placeholder="例如：面向组会汇报，10 页以内；突出消融实验和统计显著性。" /></label>
      <button className="ppt-generate" type="button" disabled={!paper || loading} onClick={() => void loadSource()}><RefreshCw size={16}/>读取版面分析资料</button>
      {source && <><div className="docmee-evidence"><div><b><ShieldCheck size={16}/>数据保真核验</b><small>{sourceKind === "markdown" ? "已使用 MinerU 版面分析 Markdown；Markdown 表格将强制映射到结果页表格或图表。" : "当前为 PDF 纯文本，表格行列可能丢失；建议先运行智能版面分析。"}</small></div>{dataCandidates.length > 0 && <p><strong>识别到的数值/统计项：</strong>{dataCandidates.map(value => <code key={value}>{value}</code>)}</p>}<textarea value={source} onChange={event => { setSource(event.target.value.slice(0, maxMaterialCharacters)); setConfirmed(false); }} /></div>
      <fieldset className="docmee-templates"><legend>选择设计模板</legend><div>{templates.map(template => <button type="button" className={template.id === templateId ? "selected" : ""} onClick={() => setTemplateId(template.id)} key={template.id}>{template.coverUrl ? <img src={template.coverUrl} alt=""/> : <Presentation size={22}/>}<span>{template.name}</span></button>)}</div></fieldset>
      <label className="docmee-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span><CheckCircle2 size={18}/>我已核验实验数据、单位、样本量及统计结论；生成时不得改写或虚构。</span></label>
      <button className="ppt-generate docmee-launch" type="button" disabled={!confirmed || loading} onClick={() => void generate()}><Sparkles size={17}/>{loading ? "正在处理中…" : "生成并下载学术 PPT"}</button></>}
      {notice && <p className="ppt-progress">{notice}</p>}{error && <p className="ppt-error">{error}</p>}{fileUrl && <a className="ppt-download" href={fileUrl} target="_blank" rel="noreferrer"><Download size={16}/>下载 PPTX</a>}
    </section>
    {fileUrl && <p className="docmee-tip"><FileText size={15}/>已由 API 生成。若需修改版式或文字，可直接用 PowerPoint/WPS 打开该 PPTX。</p>}
  </section>;
}
