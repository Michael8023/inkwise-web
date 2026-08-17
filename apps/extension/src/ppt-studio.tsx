import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Presentation, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { DocmeeUI } from "@docmee/sdk-ui";
import { functionRequest } from "./api";
import { loadPaperState, type LibraryPaper } from "./library";

type DocmeeToken = { token: string; expireTime?: number };
type DocmeeMessage = { type?: string; data?: { id?: string; name?: string; message?: string } };

const maxMaterialCharacters = 20_000;

function extractDataCandidates(text: string) {
  const values = text.match(/(?:\b\d+(?:\.\d+)?\s*(?:%|ms|s|min|h|Hz|kHz|MHz|GHz|nm|μm|mm|cm|m|kg|g|mg|mL|μL|MB|GB|dB|K|°C|p\s*[<=>]\s*0?\.\d+)|\b(?:n|N)\s*=\s*\d+|\b(?:mean|accuracy|loss|F1|AUC)\s*[=:]\s*\d+(?:\.\d+)?)/gi) || [];
  return [...new Set(values.map(value => value.replace(/\s+/g, " ")))].slice(0, 24);
}

function materialForDocmee(title: string, prompt: string, source: string) {
  const evidence = source.slice(0, maxMaterialCharacters);
  return [
    `# ${title}`,
    "## 学术演示制作约束（必须遵守）",
    "- 仅使用下方已确认的论文资料；不得编造研究结论、实验设置、数值、单位、样本量或显著性。",
    "- 所有实验数据必须原样保留：数值、单位、误差、p 值、样本量和比较对象不得改写或合并。资料未明确时标为“原文未说明”。",
    "- 对资料中的每个 Markdown 表格：保留列名、行名和单元格数值，并在结果部分生成对应的数据表或图表；不可省略为普通文字描述。",
    "- 采用简洁、专业的学术汇报视觉风格；每页只表达一个核心论点，实验结果优先采用图表或表格。",
    `- 用户要求：${prompt.trim() || "突出研究问题、方法、实验结果、局限性和结论。"}`,
    "## 已确认的 MinerU 版面分析 Markdown（作为唯一事实来源）",
    evidence,
  ].join("\n\n");
}

async function createDocmeeToken() {
  const response = await functionRequest("ai-ppt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "createToken" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw new Error(payload.error || "DOCMEE_TOKEN_FAILED");
  return payload as DocmeeToken;
}

export function PptStudio({ papers, extractText }: { papers: LibraryPaper[]; extractText: (paper: LibraryPaper) => Promise<string> }) {
  const usablePapers = useMemo(() => papers.filter(paper => !paper.archived_at), [papers]);
  const [paperId, setPaperId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState("");
  const [sourceKind, setSourceKind] = useState<"markdown" | "text" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<"review" | "launching" | "creator">("review");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const sdkRef = useRef<DocmeeUI | null>(null);
  const paper = usablePapers.find(item => item.id === paperId);
  const dataCandidates = useMemo(() => extractDataCandidates(source), [source]);

  useEffect(() => { if (!paperId && usablePapers[0]) setPaperId(usablePapers[0].id); }, [paperId, usablePapers]);
  useEffect(() => () => sdkRef.current?.destroy(), []);

  async function loadSource() {
    if (!paper) return;
    setError(""); setMessage(""); setConfirmed(false); setPhase("review");
    try {
      const layoutState = await loadPaperState(paper.id);
      const markdown = typeof layoutState?.layout_result?.markdown === "string" ? layoutState.layout_result.markdown : "";
      const extracted = markdown.trim() || await extractText(paper);
      if (!extracted.trim()) throw new Error("未能从该 PDF 提取文字，请在阅读器中重新解析文档后再试。");
      setSource(extracted.slice(0, maxMaterialCharacters));
      setSourceKind(markdown.trim() ? "markdown" : "text");
      if (!markdown.trim()) setMessage("未找到已保存的版面分析 Markdown，当前使用 PDF 纯文本；请先在阅读器中完成“智能版面分析”以保留实验表格。");
      if (extracted.length > maxMaterialCharacters) setMessage(`已载入前 ${maxMaterialCharacters.toLocaleString("zh-CN")} 个字符。请在下方删除无关内容，并保留实验结果、表格和图注后再确认。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "PDF 资料读取失败"); }
  }

  async function launchCreator() {
    if (!paper || !source.trim() || !confirmed || !containerRef.current) return;
    setError(""); setMessage(""); setPhase("launching");
    try {
      const { token } = await createDocmeeToken();
      sdkRef.current?.destroy();
      const material = materialForDocmee(paper.title, prompt, source);
      const sdk = new DocmeeUI({
        container: containerRef.current,
        page: "creator",
        creatorVersion: "v2",
        token,
        lang: "zh",
        mode: "light",
        background: "#f6fbfc",
        padding: "0",
      });
      sdkRef.current = sdk;
      sdk.on("mounted", () => {
        // V2 accepts `content`; false leaves the final generation and template
        // selection under the user's control.
        (sdk as any).changeCreatorData({ content: material, type: 6, options: { scene: "研究报告", audience: "科研人员", prompt: "学术风格；严格保持资料中的实验数据" } }, false);
        setPhase("creator");
        setMessage("资料已注入官方 Agent 创作器。请先检查大纲，再选择模板并开始创作。");
      });
      sdk.on("beforeGenerate", () => confirmed);
      sdk.on("afterGenerate", (event: DocmeeMessage) => setMessage(`PPT 已生成${event.data?.name ? `：${event.data.name}` : ""}，可在官方编辑器内继续调整并下载。`));
      sdk.on("invalid-token", async () => {
        try { sdk.updateToken((await createDocmeeToken()).token); }
        catch { setError("Docmee 授权已过期，请返回并重新打开创作器。"); }
      });
      sdk.on("error", (event: DocmeeMessage) => setError(event.data?.message || "Docmee 创作器发生错误，请稍后重试。"));
    } catch (caught) {
      setPhase("review"); setError(caught instanceof Error ? caught.message : "无法启动 Docmee 创作器");
    }
  }

  function returnToReview() { sdkRef.current?.destroy(); sdkRef.current = null; setPhase("review"); setMessage(""); }

  return <section className="ppt-studio docmee-studio">
    <header><div><span><Presentation size={15}/> DOCMEE AGENT DESIGN</span><h1>学术 PPT 创作</h1><p>先确认 PDF 事实与实验数据，再进入文多多官方 Agent 创作器选择精美模板。</p></div>{phase === "creator" && <button className="docmee-back" onClick={returnToReview}>返回资料核验</button>}</header>
    {phase !== "creator" && <section className="docmee-review">
      <label>选择 PDF<select value={paperId} onChange={event => { setPaperId(event.target.value); setSource(""); setConfirmed(false); }}><option value="">请选择文献</option>{usablePapers.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="docmee-prompt">制作要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={800} placeholder="例如：面向组会汇报，10 页以内；突出消融实验和统计显著性。" /></label>
      <button className="ppt-generate" type="button" disabled={!paper} onClick={() => void loadSource()}><RefreshCw size={16}/>读取版面分析资料并核验</button>
      {source && <><div className="docmee-evidence"><div><b><ShieldCheck size={16}/>数据保真核验</b><small>{sourceKind === "markdown" ? "已使用 MinerU 版面分析 Markdown；Markdown 表格会作为结果页数据表/图表的强制依据。" : "当前为 PDF 纯文本，表格行列可能已经丢失；请先运行智能版面分析。"}</small></div>{dataCandidates.length > 0 && <p><strong>识别到的数值/统计项：</strong>{dataCandidates.map(value => <code key={value}>{value}</code>)}</p>}<textarea value={source} onChange={event => { setSource(event.target.value.slice(0, maxMaterialCharacters)); setConfirmed(false); }} /></div>
      <label className="docmee-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span><CheckCircle2 size={18}/>我已核验资料中的实验数据、单位、样本量及统计结论；生成时不得改写或虚构。</span></label>
      <button className="ppt-generate docmee-launch" type="button" disabled={!confirmed || phase === "launching"} onClick={() => void launchCreator()}><Sparkles size={17}/>{phase === "launching" ? "正在启动官方 Agent…" : "进入 Agent 精美设计与模板选择"}</button></>}
      {message && <p className="ppt-progress">{message}</p>}{error && <p className="ppt-error">{error}</p>}
    </section>}
    <div ref={containerRef} className={`docmee-container ${phase === "creator" ? "visible" : ""}`} />
    {phase === "creator" && <><p className="docmee-tip"><FileText size={15}/> 已将已确认 PDF 资料注入创作器。生成前可继续在官方界面调整大纲；模板选择、编辑和下载均在该界面完成。</p>{message && <p className="ppt-progress">{message}</p>}{error && <p className="ppt-error">{error}</p>}</>}
  </section>;
}
