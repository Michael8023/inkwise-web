import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import * as pdfjsLib from "pdfjs-dist";
import { functionRequest, supabase, supabaseConfigured } from "./api";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  History,
  Maximize,
  MessageSquare,
  GripVertical,
  Minus,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Send,
  RefreshCw,
  Sparkles,
  Sun,
  SlidersHorizontal,
  X,
  LogIn,
  LogOut,
  Highlighter,
  Trash2,
  Link,
  UserRound,
  ScanLine,
  Image as ImageIcon,
  Table2,
  Download,
} from "lucide-react";
import "./style.css";
import { mountAdmin } from "./admin";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

type Task = {
  kind: "translate" | "explain";
  state: "loading" | "done" | "error" | "unavailable";
  result?: string;
};
type Selection = {
  id: string;
  pageNumber: number;
  text: string;
  nx: number;
  ny: number;
  context: string;
  highlights: Array<{ x: number; y: number; width: number; height: number }>;
  offsetX?: number;
  offsetY?: number;
  highlightColor?: string;
  task?: Task;
};
type SavedHighlight = Omit<Selection, "task" | "offsetX" | "offsetY"> & { color: string };
type VisualSelection = {
  id: string;
  pageNumber: number;
  imageDataUrl: string;
  pageContext: string;
  area: { x: number; y: number; width: number; height: number };
  task?: { kind: "explain" | "table"; state: "loading" | "done" | "error"; result?: string };
};
type Tab = "summary" | "chat" | "history";
type OutlineItem = { title: string; dest?: unknown; items?: OutlineItem[] };
type ChatMessage = { role: "user" | "assistant"; content: string };
type AuthSession = { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } };
type Usage = { plan: string; creditsRemaining: number; periodEnd: string | null };
const apiErrors: Record<string, string> = {
  AUTH_REQUIRED: "请先登录后使用 AI 功能。",
  QUOTA_EXCEEDED: "AI 额度不足，请联系管理员充值。",
  MODEL_DISABLED: "当前模型不可用，请选择其他模型。",
  CONTEXT_TOO_LARGE: "文档内容过长，暂时无法提交给 AI。",
  RATE_LIMITED: "请求过于频繁，请稍后再试。",
  SUPABASE_NOT_CONFIGURED: "尚未配置 Supabase 项目。",
  EMAIL_INVALID: "请输入有效的邮箱地址。",
  USERNAME_INVALID: "用户名需为 3 至 24 个字符，只能包含文字、数字、下划线或短横线。",
  USERNAME_TAKEN: "该用户名已被使用。",
  EMAIL_ALREADY_REGISTERED: "该邮箱已注册，请直接登录。",
  CODE_COOLDOWN: "发送过于频繁，请一分钟后重试。",
  CODE_RATE_LIMITED: "验证码请求次数过多，请一小时后重试。",
  CODE_INVALID: "验证码不正确。",
  CODE_EXPIRED: "验证码已过期，请重新发送。",
  CODE_USED: "验证码已使用，请重新获取。",
  CODE_ATTEMPTS_EXCEEDED: "错误次数过多，请重新获取验证码。",
  EMAIL_SEND_FAILED: "验证邮件发送失败，请稍后重试。",
  PASSWORD_INVALID: "密码长度需为 8 至 72 位。",
  IMAGE_INVALID: "框选图像无效或过大，请缩小区域后重试。",
  MODEL_VISION_UNSUPPORTED: "当前模型不支持图像理解，请切换其他模型。",
  AI_VISUAL_FAILED: "图表识别失败，请稍后重试。",
};
function readableApiError(error: unknown, fallback: string) { const code=error instanceof Error?error.message:String(error||""); return apiErrors[code]||fallback; }

function AuthDialog({
  mode, email, password, name, code, error, notice, verifying, onClose, onSubmit, onVerify, onResend, onModeChange, onEmail, onPassword, onName, onCode,
}: {
  mode: "login" | "register"; email: string; password: string; name: string; code: string; error: string; notice: string; verifying: boolean;
  onClose: () => void; onSubmit: () => void; onVerify: () => void; onResend: () => void; onModeChange: (mode: "login" | "register") => void;
  onEmail: (value: string) => void; onPassword: (value: string) => void; onName: (value: string) => void; onCode: (value: string) => void;
}) {
  return <div className="auth-backdrop"><form className="auth-dialog" onSubmit={(event) => { event.preventDefault(); verifying ? onVerify() : onSubmit(); }}>
    <button type="button" className="popover-close" onClick={onClose}><X size={16} /></button>
    <div className="auth-brand"><img src="/brand/inkwise-mark.svg" alt="" /><span>墨知 <em>Inkwise</em></span></div>
    <div className="auth-heading"><h2>{verifying ? "验证你的邮箱" : mode === "login" ? "欢迎回来" : "创建你的阅读空间"}</h2></div>
    {verifying ? <div className="auth-fields verification-fields"><p>验证码已发送至 <strong>{email}</strong></p><label>六位验证码<input className="verification-code" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="000000" required minLength={6} maxLength={6} value={code} onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label><button className="auth-inline-action" type="button" onClick={onResend}>重新发送验证码</button></div> : <><div className="auth-tabs" role="tablist"><button className={mode === "login" ? "active" : ""} type="button" onClick={() => onModeChange("login")}>登录</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => onModeChange("register")}>注册</button></div><div className="auth-fields">
      {mode === "register" && <label>用户名<input placeholder="至少 3 个字符" required minLength={3} value={name} onChange={(event) => onName(event.target.value)} /></label>}
      <label>邮箱<input type="email" placeholder="name@example.com" required autoComplete="email" value={email} onChange={(event) => onEmail(event.target.value)} /></label>
      <label>密码<input type="password" placeholder="至少 8 位" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => onPassword(event.target.value)} /></label>
    </div></>}
    {error && <p className="auth-feedback error">{error}</p>}{notice && <p className="auth-feedback auth-notice">{notice}</p>}
    <button className="auth-submit" type="submit">{verifying ? "完成验证" : mode === "login" ? "登录墨知" : "发送验证码"}<ChevronRight size={17} /></button>
  </form></div>;
}

function AccountDialog({ session, usage, onClose, onSignOut }: { session: AuthSession; usage: Usage | null; onClose: () => void; onSignOut: () => void }) {
  const displayName = String(session.user.user_metadata?.display_name || session.user.user_metadata?.username || "墨知用户");
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "I";
  const creditAmount = usage?.creditsRemaining ?? 0;
  return <div className="auth-backdrop"><section className="auth-dialog account-dialog">
    <button type="button" className="popover-close" onClick={onClose}><X size={16} /></button>
    <div className="auth-brand"><img src="/brand/inkwise-mark.svg" alt="" /><span>墨知 <em>Inkwise</em></span></div>
    <div className="account-hero"><div className="account-avatar">{initial}</div><div><p>账户中心</p><h2>{displayName}</h2><span>{session.user.email}</span></div></div>
    <section className="account-credits"><div><span>可用 AI 额度</span><strong>{creditAmount}<small> 分</small></strong></div><div className="credit-orbit"><Sparkles size={19} /></div></section>
    <div className="quota-summary"><span>当前套餐<strong>{usage?.plan ? usage.plan.toUpperCase() : "FREE"}</strong></span><span>结算日期<strong>{usage?.periodEnd ? new Date(usage.periodEnd).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "每月"}</strong></span></div>
    <button type="button" className="account-signout" onClick={onSignOut}><LogOut size={15} />退出登录</button>
  </section></div>;
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button${active ? " active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function WelcomeScreen({
  session,
  onOpenFile,
  onOpenUrl,
  onOpenAccount,
}: {
  session: AuthSession | null;
  onOpenFile: () => void;
  onOpenUrl: () => void;
  onOpenAccount: () => void;
}) {
  const displayName = session ? String(session.user.user_metadata?.display_name || session.user.user_metadata?.username || session.user.email || "") : "";
  return (
    <main className="welcome-shell">
      <header className="welcome-nav">
        <div className="welcome-wordmark">
          <img src="/brand/inkwise-mark.svg" alt="墨知 Inkwise" />
          <span>墨知</span><em>Inkwise</em>
        </div>
        <button className="welcome-account" onClick={onOpenAccount}>
          {session ? <UserRound size={16} /> : <LogIn size={16} />}
          {session ? String(session.user.user_metadata?.display_name || session.user.email || "账户") : "登录"}
        </button>
      </header>
      <section className="welcome-stage">
        <div className="welcome-copy">
          {session ? <><p className="welcome-eyebrow">INKWISE / YOUR READING SPACE</p><h1>{displayName}，<br /><span>让理解从这一页开始</span></h1></> : <><p className="welcome-eyebrow">PDF INTELLIGENCE WORKSPACE</p><h1>读懂每一页<br /><span>也留下每一次思考。</span></h1><p className="welcome-description">墨知将 PDF 阅读、划词理解与 AI 问答放在同一处，让复杂文本回到清晰、专注的节奏。</p></>}
          <div className="welcome-actions">
            <button className="welcome-primary" onClick={onOpenFile}><FolderOpen size={18} />打开本地 PDF</button>
            <button className="welcome-secondary" onClick={onOpenUrl}><Link size={17} />导入论文链接</button>
          </div>
          <button className="welcome-library" onClick={onOpenAccount}><UserRound size={17} />{session ? "查看账户与 AI 额度" : "登录后使用 AI 功能"}</button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="welcome-sheet welcome-sheet-back" />
          <div className="welcome-sheet welcome-sheet-front">
            <div className="art-kicker">INKWISE / READING NOTES</div>
            <div className="art-title">Understanding<br />through context.</div>
            <div className="art-lines"><i /><i /><i /><i /></div>
            <div className="art-highlight">The meaning of a sentence lives in the pages around it.</div>
            <div className="art-footer"><span>01</span><span>READ WITH CLARITY</span></div>
          </div>
          <div className="welcome-marker">✦</div>
        </div>
      </section>
      <footer className="welcome-footer"><span>支持本地 PDF 拖放</span><span>·</span><span>你的文档与你同在</span></footer>
    </main>
  );
}

function OutlineTree({
  items,
  depth = 0,
  onNavigate,
}: {
  items: OutlineItem[];
  depth?: number;
  onNavigate: (destination: unknown) => void;
}) {
  return (
    <>
      {items.map((item, index) => (
        <div
          className="outline-entry"
          key={`${item.title}-${index}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <button
            disabled={!item.dest}
            onClick={() => item.dest && onNavigate(item.dest)}
          >
            {item.items?.length ? (
              <ChevronRight size={13} />
            ) : (
              <span className="outline-spacer" />
            )}
            {item.title || "未命名章节"}
          </button>
          {item.items?.length ? (
            <OutlineTree
              items={item.items}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

function SelectionPopover({
  selection,
  pageRef,
  onClose,
  onTask,
  onFollowup,
  onMove,
  onHighlight,
}: {
  selection: Selection;
  pageRef: React.RefObject<HTMLDivElement | null>;
  onClose: (id: string) => void;
  onTask: (selection: Selection, kind: "translate" | "explain") => void;
  onFollowup: (selection: Selection, question: string) => void;
  onMove: (id: string, offsetX: number, offsetY: number) => void;
  onHighlight: (id: string, color: string) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const [followup, setFollowup] = useState("");

  useLayoutEffect(() => {
    const updatePosition = () => {
      const page = pageRef.current;
      const popover = popoverRef.current;
      if (!page || !popover) return;
      const pageRect = page.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const margin = 12;
      const anchorX = pageRect.left + pageRect.width * selection.nx;
      const anchorY = pageRect.top + pageRect.height * selection.ny;
      const desiredLeft = anchorX - width / 2 + (selection.offsetX || 0);
      const desiredTop = anchorY + 10 + (selection.offsetY || 0);
      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);
      const top =
        desiredTop <= maxTop
          ? desiredTop
          : anchorY - height - 10 + (selection.offsetY || 0);
      setPosition({
        left: Math.min(Math.max(margin, desiredLeft), maxLeft),
        top: Math.min(Math.max(margin, top), maxTop),
      });
    };
    updatePosition();
    const scroller = document.querySelector(".document-scroll");
    scroller?.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);
    const observer = new ResizeObserver(updatePosition);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      scroller?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
      observer.disconnect();
    };
  }, [pageRef, selection.nx, selection.ny, selection.offsetX, selection.offsetY, selection.task]);

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: selection.offsetX || 0,
      offsetY: selection.offsetY || 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: React.PointerEvent<HTMLButtonElement>) {
    const start = dragStart.current;
    if (!start) return;
    onMove(
      selection.id,
      start.offsetX + event.clientX - start.x,
      start.offsetY + event.clientY - start.y,
    );
  }

  function stopDrag() {
    dragStart.current = null;
  }

  return (
    <div
      ref={popoverRef}
      className="selection-popover"
      style={position}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="选区操作"
    >
      <button
        className="popover-drag-handle"
        aria-label="拖动浮窗"
        title="拖动浮窗"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <GripVertical size={15} />
      </button>
      <button
        className="popover-close"
        aria-label="关闭选区"
        title="关闭"
        onClick={() => onClose(selection.id)}
      >
        <X size={15} />
      </button>
      <p className="popover-text">{selection.text}</p>
      <div className="popover-actions">
        <button onClick={() => onTask(selection, "translate")} disabled={selection.task?.state === "loading"}>译 翻译</button>
        <button onClick={() => onTask(selection, "explain")} disabled={selection.task?.state === "loading"}>✦ 解释</button>
      </div>
      <div className="highlight-palette">
        {["#f4cf4d", "#a7df91", "#8cc8ff", "#f5a6bd"].map((color) => <button key={color} className={selection.highlightColor === color ? "active" : ""} style={{ backgroundColor: color }} title="高亮" onClick={() => onHighlight(selection.id, color)} />)}
      </div>
      {selection.task && (
        <div className={`popover-result ${selection.task.state}`} aria-live="polite">
          {selection.task.state === "loading" ? "正在处理..." : <ReactMarkdown>{selection.task.result || ""}</ReactMarkdown>}
        </div>
      )}
      {selection.task?.kind === "explain" && selection.task.state === "done" && (
        <form className="explain-followup" onSubmit={(event) => { event.preventDefault(); const value = followup.trim(); if (!value) return; onFollowup(selection, value); setFollowup(""); }}>
          <input value={followup} onChange={(event) => setFollowup(event.target.value)} placeholder="继续追问这段解释…" aria-label="追问解释" />
          <button type="submit" disabled={!followup.trim()}><Send size={14} /></button>
        </form>
      )}
    </div>
  );
}

function VisualPopover({ selection, pageRef, onClose, onTask }: {
  selection: VisualSelection;
  pageRef: React.RefObject<HTMLDivElement | null>;
  onClose: (id: string) => void;
  onTask: (selection: VisualSelection, kind: "explain" | "table") => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const update = () => {
      const page = pageRef.current, popover = ref.current;
      if (!page || !popover) return;
      const rect = page.getBoundingClientRect(), margin = 12;
      const anchorX = rect.left + rect.width * (selection.area.x + selection.area.width);
      const anchorY = rect.top + rect.height * selection.area.y;
      const width = popover.offsetWidth, height = popover.offsetHeight;
      setPosition({ left: Math.min(Math.max(margin, anchorX + 9), window.innerWidth - width - margin), top: Math.min(Math.max(margin, anchorY), window.innerHeight - height - margin) });
    };
    update();
    const scroller = document.querySelector(".document-scroll");
    scroller?.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update);
    const observer = new ResizeObserver(update); if (ref.current) observer.observe(ref.current);
    return () => { scroller?.removeEventListener("scroll", update); window.removeEventListener("resize", update); observer.disconnect(); };
  }, [pageRef, selection.area, selection.task]);
  async function copyImage() {
    const blob = await (await fetch(selection.imageDataUrl)).blob();
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  }
  return <div ref={ref} className="selection-popover visual-popover" style={position} onMouseDown={event => event.stopPropagation()} role="dialog" aria-label="图表操作">
    <button className="popover-close" aria-label="关闭" onClick={() => onClose(selection.id)}><X size={15}/></button>
    <div className="visual-title"><ScanLine size={15}/><strong>图表选区</strong><span>第 {selection.pageNumber} 页</span></div>
    <img src={selection.imageDataUrl} alt="框选的 PDF 区域"/>
    <div className="popover-actions visual-actions"><button onClick={() => onTask(selection, "explain")} disabled={selection.task?.state === "loading"}><ImageIcon size={14}/>AI 解读</button><button onClick={() => onTask(selection, "table")} disabled={selection.task?.state === "loading"}><Table2 size={14}/>提取表格</button><button title="复制图片" onClick={() => copyImage().catch(() => undefined)}><Copy size={14}/></button><a title="下载图片" href={selection.imageDataUrl} download={`inkwise-page-${selection.pageNumber}.jpg`}><Download size={14}/></a></div>
    {selection.task && <div className={`popover-result ${selection.task.state}`}>{selection.task.state === "loading" ? "正在理解图表…" : <><ReactMarkdown>{selection.task.result || ""}</ReactMarkdown>{selection.task.state === "done" && <button className="visual-copy-result" onClick={() => navigator.clipboard.writeText(selection.task?.result || "")}><Copy size={13}/>复制结果</button>}</>}</div>}
  </div>;
}

function PageView({
  pdf,
  pageNumber,
  scale,
  selections,
  highlights,
  onSelect,
  onClose,
  onTask,
  onFollowup,
  onMove,
  onHighlight,
  onDeleteHighlight,
  visualMode,
  visualSelections,
  onVisualSelect,
  onVisualClose,
  onVisualTask,
  onVisible,
}: {
  pdf: any;
  pageNumber: number;
  scale: number;
  selections: Selection[];
  highlights: SavedHighlight[];
  onSelect: (selection: Omit<Selection, "id">) => void;
  onClose: (id: string) => void;
  onTask: (selection: Selection, kind: "translate" | "explain") => void;
  onFollowup: (selection: Selection, question: string) => void;
  onMove: (id: string, offsetX: number, offsetY: number) => void;
  onHighlight: (id: string, color: string) => void;
  onDeleteHighlight: (id: string) => void;
  visualMode: boolean;
  visualSelections: VisualSelection[];
  onVisualSelect: (selection: Omit<VisualSelection, "id">) => void;
  onVisualClose: (id: string) => void;
  onVisualTask: (selection: VisualSelection, kind: "explain" | "table") => void;
  onVisible: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [pageText, setPageText] = useState("");
  const [activeHighlight, setActiveHighlight] = useState<{ id: string; area: { x: number; y: number; width: number; height: number } } | null>(null);
  const highlightHideTimer = useRef<number | null>(null);
  const [visualDraft, setVisualDraft] = useState<{ startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onVisible(pageNumber);
      },
      { root: document.querySelector(".document-scroll"), threshold: 0.55 },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [onVisible, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      setLoading(true);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      const layer = layerRef.current;
      if (!canvas || !layer || cancelled) return;
      setSize({ width: viewport.width, height: viewport.height });
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      layer.replaceChildren();
      layer.style.width = `${viewport.width}px`;
      layer.style.height = `${viewport.height}px`;
      layer.style.setProperty("--scale-factor", String(scale));
      const textContent = await page.getTextContent();
      const extractedText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      setPageText(extractedText);
      if (cancelled) return;
      await page.render({
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
      }).promise;
      if (!cancelled) {
        await new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: layer,
          viewport,
        }).render();
        setLoading(false);
      }
    }
    render().catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale]);

  function selectText() {
    if (visualMode) return;
    const nativeSelection = window.getSelection();
    const text = nativeSelection?.toString().trim();
    if (!text || !nativeSelection?.rangeCount || !hostRef.current) return;
    const range = nativeSelection.getRangeAt(0);
    const selectedNode =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (!selectedNode || !layerRef.current?.contains(selectedNode)) return;
    const rect = range.getBoundingClientRect();
    const pageRect = hostRef.current.getBoundingClientRect();
    const highlights = Array.from(range.getClientRects())
      .map((clientRect) => ({
        x: (clientRect.left - pageRect.left) / pageRect.width,
        y: (clientRect.top - pageRect.top) / pageRect.height,
        width: clientRect.width / pageRect.width,
        height: clientRect.height / pageRect.height,
      }))
      .filter((highlight) => highlight.width > 0 && highlight.height > 0);
    const start = Math.max(0, pageText.indexOf(text));
    onSelect({
      pageNumber,
      text,
      context: pageText.slice(
        Math.max(0, start - 800),
        Math.min(pageText.length, start + text.length + 800),
      ),
      nx: Math.max(
        0.02,
        Math.min(
          0.98,
          (rect.left - pageRect.left + rect.width / 2) / pageRect.width,
        ),
      ),
      ny: Math.max(
        0.02,
        Math.min(0.98, (rect.bottom - pageRect.top + 10) / pageRect.height),
      ),
      highlights,
    });
    nativeSelection.removeAllRanges();
  }
  function beginVisualSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!visualMode || !hostRef.current) return;
    event.preventDefault();
    const rect = hostRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setVisualDraft({ startX: x, startY: y, x, y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveVisualSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!visualDraft || !hostRef.current) return;
    const rect = hostRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const currentY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setVisualDraft(draft => draft && ({ ...draft, x: Math.min(draft.startX, currentX), y: Math.min(draft.startY, currentY), width: Math.abs(currentX - draft.startX), height: Math.abs(currentY - draft.startY) }));
  }
  function finishVisualSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!visualDraft || !canvasRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const area = { x: visualDraft.x, y: visualDraft.y, width: visualDraft.width, height: visualDraft.height };
    setVisualDraft(null);
    if (area.width < 0.025 || area.height < 0.025) return;
    const source = canvasRef.current;
    const sx = Math.round(area.x * source.width), sy = Math.round(area.y * source.height);
    const sw = Math.max(1, Math.round(area.width * source.width)), sh = Math.max(1, Math.round(area.height * source.height));
    const ratio = Math.min(1, 1600 / Math.max(sw, sh));
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(sw * ratio)); crop.height = Math.max(1, Math.round(sh * ratio));
    crop.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    onVisualSelect({ pageNumber, imageDataUrl: crop.toDataURL("image/jpeg", .88), pageContext: pageText, area });
  }
  function detectHighlight(event: React.MouseEvent<HTMLDivElement>) {
    const page = hostRef.current;
    if (!page) return;
    if ((event.target as HTMLElement).closest(".highlight-delete")) return;
    if (highlightHideTimer.current !== null) {
      window.clearTimeout(highlightHideTimer.current);
      highlightHideTimer.current = null;
    }
    const rect = page.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const hit = highlights.flatMap((item) => item.highlights.map((area) => ({ id: item.id, area }))).find(({ area }) =>
      x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height,
    );
    if (hit) {
      setActiveHighlight(hit);
    } else if (activeHighlight) {
      highlightHideTimer.current = window.setTimeout(() => {
        setActiveHighlight(null);
        highlightHideTimer.current = null;
      }, 500);
    }
  }

  return (
    <div id={`pdf-page-${pageNumber}`} className="page-wrap">
      <span className="page-label">第 {pageNumber} 页</span>
      <div
        ref={hostRef}
        className={`page-sheet${visualMode ? " visual-select-mode" : ""}`}
        style={{
          width: size.width || undefined,
          height: size.height || undefined,
        }}
        onMouseUp={selectText}
        onMouseMove={detectHighlight}
        onPointerDown={beginVisualSelection}
        onPointerMove={moveVisualSelection}
        onPointerUp={finishVisualSelection}
        onPointerCancel={() => setVisualDraft(null)}
        onMouseLeave={() => {
          if (highlightHideTimer.current !== null) window.clearTimeout(highlightHideTimer.current);
          highlightHideTimer.current = window.setTimeout(() => {
            setActiveHighlight(null);
            highlightHideTimer.current = null;
          }, 500);
        }}
      >
        <canvas ref={canvasRef} />
        <div className="text-layer" ref={layerRef} />
        {visualDraft && <div className="visual-selection-draft" style={{ left: `${visualDraft.x * 100}%`, top: `${visualDraft.y * 100}%`, width: `${visualDraft.width * 100}%`, height: `${visualDraft.height * 100}%` }} />}
        {visualSelections.map(selection => <div key={selection.id} className="visual-selection-area" style={{ left: `${selection.area.x * 100}%`, top: `${selection.area.y * 100}%`, width: `${selection.area.width * 100}%`, height: `${selection.area.height * 100}%` }} />)}
        <div className="temporary-selection-layer" aria-hidden="true">
          {selections.flatMap((selection) => selection.highlights.map((highlight, index) => (
            <span key={`${selection.id}-${index}`} style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.width * 100}%`, height: `${highlight.height * 100}%` }} />
          )))}
        </div>
        <div className="selection-highlights">
          {highlights.flatMap((selection) =>
            selection.highlights.map((highlight, index) => (
              <span
                key={`${selection.id}-${index}`}
                style={{
                  left: `${highlight.x * 100}%`,
                  top: `${highlight.y * 100}%`,
                  width: `${highlight.width * 100}%`,
                  height: `${highlight.height * 100}%`, backgroundColor: selection.color,
                }}
              />
            )),
          )}
          {activeHighlight && <button type="button" className="highlight-delete" aria-label="删除高亮" title="删除高亮" style={{ left: `${Math.min(97, (activeHighlight.area.x + activeHighlight.area.width) * 100)}%`, top: `${Math.max(0, (activeHighlight.area.y + activeHighlight.area.height / 2) * 100)}%` }} onMouseEnter={() => { if (highlightHideTimer.current !== null) window.clearTimeout(highlightHideTimer.current); highlightHideTimer.current = null; setActiveHighlight(activeHighlight); }} onMouseLeave={() => { highlightHideTimer.current = window.setTimeout(() => setActiveHighlight(null), 500); }} onClick={(event) => { event.stopPropagation(); onDeleteHighlight(activeHighlight.id); setActiveHighlight(null); }}><Trash2 size={13} /></button>}
        </div>
        {loading && <div className="page-loading" />}
        {selections.map((selection) => (
          <SelectionPopover
            key={selection.id}
            selection={selection}
            pageRef={hostRef}
            onClose={onClose}
            onTask={onTask}
            onFollowup={onFollowup}
            onMove={onMove}
            onHighlight={onHighlight}
          />
        ))}
        {visualSelections.map(selection => <VisualPopover key={selection.id} selection={selection} pageRef={hostRef} onClose={onVisualClose} onTask={onVisualTask}/>)}
      </div>
    </div>
  );
}

function App() {
  const [pdf, setPdf] = useState<any>(null);
  const [fileName, setFileName] = useState("");
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [scale, setScale] = useState(1.2);
  const [currentPage, setCurrentPage] = useState(1);
  const [railOpen, setRailOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(400);
  const panelResize = useRef<{ startX: number; startWidth: number } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tab, setTab] = useState<Tab>("summary");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [highlights, setHighlights] = useState<SavedHighlight[]>([]);
  const [visualMode, setVisualMode] = useState(false);
  const [visualSelections, setVisualSelections] = useState<VisualSelection[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [documentId, setDocumentId] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [documentReady, setDocumentReady] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [model, setModel] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [summary, setSummary] = useState<{
    short?: string;
    full?: string;
    loading?: "short" | "full";
  }>({});
  const [summaryOpen, setSummaryOpen] = useState({ short: false, full: false });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [highlightMode, setHighlightMode] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authError, setAuthError] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authVerifying, setAuthVerifying] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [paperUrl, setPaperUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session as AuthSession | null));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next as AuthSession | null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    functionRequest("models")
      .then((response) => response.json())
      .then((result) => {
        const fallbackModels = [
          { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
          { id: "gpt-4o-mini", name: "GPT-4o mini" },
          { id: "grok-4.5", name: "Grok 4.5" },
          { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
          { id: "gpt-5.4-nano", name: "GPT-5.4 nano" },
        ];
        const availableModels = Array.isArray(result.models) && result.models.length ? result.models : fallbackModels;
        setModels(availableModels);
        const fallbackModel =
          result.defaultModel || availableModels[0]?.id || "";
        setDefaultModel(fallbackModel);
        setModel(fallbackModel);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!session) { setUsage(null); return; }
    refreshUsage();
  }, [session]);
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!panelResize.current) return;
      const delta = panelResize.current.startX - event.clientX;
      setPanelWidth(Math.max(320, Math.min(620, panelResize.current.startWidth + delta)));
    };
    const onUp = () => {
      if (!panelResize.current) return;
      panelResize.current = null;
      document.body.classList.remove("is-resizing-panel");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  async function refreshUsage() {
    try {
      const response = await functionRequest("usage");
      if (response.ok) setUsage(await response.json());
    } catch { setUsage(null); }
  }
  async function submitAuth() {
    setAuthError("");
    setAuthNotice("");
    try {
      if (!supabaseConfigured) throw new Error("SUPABASE_NOT_CONFIGURED");
      if (authMode === "register") {
        const response = await functionRequest("request-signup-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: authEmail, username: authName }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "EMAIL_SEND_FAILED");
        setAuthNotice("请输入邮件中的六位验证码。");
        setAuthCode("");
        setAuthVerifying(true);
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
      }
      setAuthOpen(false);
      setAuthPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "REQUEST_FAILED";
      setAuthError(apiErrors[message] || message);
    }
  }
  async function verifyEmailCode() {
    setAuthError(""); setAuthNotice("");
    try {
      if (authCode.length !== 6) throw new Error("请输入六位验证码。");
      const response = await functionRequest("complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword, code: authCode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "SIGNUP_FAILED");
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
      if (error) throw error;
      setAuthOpen(false); setAuthVerifying(false); setAuthCode(""); setAuthPassword("");
    } catch (error) { const message=error instanceof Error?error.message:"SIGNUP_FAILED"; setAuthError(apiErrors[message] || message); }
  }
  async function resendEmailCode() {
    setAuthError(""); setAuthNotice("");
    try {
      const response = await functionRequest("request-signup-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, username: authName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "EMAIL_SEND_FAILED");
      setAuthNotice("新的验证码已发送，请查收邮箱。");
    } catch (error) { const message=error instanceof Error?error.message:"EMAIL_SEND_FAILED"; setAuthError(apiErrors[message] || message); }
  }
  async function signOut() {
    await supabase.auth.signOut();
  }
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelections([]);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  async function openPdfData(data: ArrayBuffer, name: string) {
    try {
      setSelections([]); setHighlights([]); setVisualSelections([]); setVisualMode(false);
      setDocumentReady(false);
      setFileName(name);
      const document = await pdfjsLib.getDocument({
        data: new Uint8Array(data),
      }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item: any) => item.str).join(" "));
      }
      const nextDocumentText = pages
        .map((text, index) => `\n[第 ${index + 1} 页]\n${text}`)
        .join("\n");
      setPdf(document); setDocumentId(crypto.randomUUID()); setDocumentText(nextDocumentText);
      setSummary({});
      setSummaryOpen({ short: false, full: false });
      setMessages([]);
      setQuestion(""); setPageInput("1");
      setOutline(((await document.getOutline()) ?? []) as OutlineItem[]);
      setCurrentPage(1);
      setDocumentReady(true);
    } catch {
      setPdf(null);
      setOutline([]);
      setDocumentReady(false);
      setFileName("无法打开该 PDF");
    }
  }
  async function openFile(file: File) {
    await openPdfData(await file.arrayBuffer(), file.name);
  }
  function validatePdfUrl(value: string) {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("仅支持 http 或 https 链接。");
    if (["localhost", "0.0.0.0", "::1"].includes(parsed.hostname) || parsed.hostname.endsWith(".localhost") || parsed.hostname.endsWith(".local")) {
      throw new Error("不允许读取本机或内网链接。");
    }
    return parsed;
  }
  async function openPdfUrl() {
    setUrlError("");
    let parsed: URL;
    try { parsed = validatePdfUrl(paperUrl.trim()); } catch (error) { setUrlError(error instanceof Error ? error.message : "链接格式不正确。"); return; }
    setUrlLoading(true);
    try {
      let response: Response;
      try {
        response = await fetch(parsed.toString());
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
      } catch {
        if (!session) throw new Error("该站点不允许跨域读取，请登录后通过安全代理导入。");
        response = await functionRequest("pdf-fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: parsed.toString() }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "PDF_URL_FETCH_FAILED");
        }
      }
      const contentType = response.headers.get("content-type") || "";
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 40 * 1024 * 1024) throw new Error("PDF 文件超过 40 MB 限制。");
      const data = await response.arrayBuffer();
      if (data.byteLength > 40 * 1024 * 1024) throw new Error("PDF 文件超过 40 MB 限制。");
      if (contentType && !contentType.includes("pdf") && new Uint8Array(data.slice(0, 4)).join(",") !== "37,80,68,70") {
        throw new Error("该链接返回的不是 PDF 文件。");
      }
      const disposition = response.headers.get("content-disposition") || "";
      const name = decodeURIComponent(disposition.match(/filename\*?=(?:UTF-8'')?\"?([^;\"]+)/i)?.[1] || parsed.pathname.split("/").pop() || "在线论文.pdf");
      await openPdfData(data, name.endsWith(".pdf") ? name : `${name}.pdf`);
      setUrlOpen(false);
      setPaperUrl("");
    } catch (error) {
      setUrlError(readableApiError(error, "无法读取该 PDF 链接。"));
    } finally { setUrlLoading(false); }
  }
  async function requestSummary(kind: "short" | "full") {
    if (!documentReady || !defaultModel || !documentId) return;
    setSummary((current) => ({ ...current, loading: kind }));
    try {
      if (!session) throw new Error("AUTH_REQUIRED");
      const response = await functionRequest("ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          model: defaultModel,
          documentText: documentText.slice(0, 120000),
          requestId: crypto.randomUUID(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSummary((current) => ({
        ...current,
        [kind]: result.text,
        loading: undefined,
      }));
      if (typeof result.creditsRemaining === "number") setUsage((current) => current ? { ...current, creditsRemaining: result.creditsRemaining } : current);
    } catch (error) {
      setSummary((current) => ({
        ...current,
        loading: undefined,
        [kind]: readableApiError(error, "摘要生成失败，请稍后重试。"),
      }));
    }
  }
  function addSelection(selection: Omit<Selection, "id">) {
    const id = crypto.randomUUID();
    const next = { ...selection, id, highlightColor: highlightMode ? "#f4cf4d" : undefined };
    setSelections((items) => [...items, next]);
    if (highlightMode) persistHighlight(next);
  }
  function addVisualSelection(selection: Omit<VisualSelection, "id">) {
    setVisualSelections(items => [...items, { ...selection, id: crypto.randomUUID() }]);
    setVisualMode(false);
  }
  async function runVisualTask(selection: VisualSelection, kind: "explain" | "table") {
    setVisualSelections(items => items.map(item => item.id === selection.id ? { ...item, task: { kind, state: "loading" } } : item));
    try {
      const response = await functionRequest("ai-visual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, imageDataUrl: selection.imageDataUrl, pageContext: selection.pageContext, documentContext: documentText.slice(0, 30000), pageNumber: selection.pageNumber, model, requestId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok || !result.text) throw new Error(result.error || "AI_VISUAL_FAILED");
      if (typeof result.creditsRemaining === "number") setUsage(current => current ? { ...current, creditsRemaining: result.creditsRemaining } : current);
      setVisualSelections(items => items.map(item => item.id === selection.id ? { ...item, task: { kind, state: "done", result: result.text } } : item));
    } catch (error) {
      setVisualSelections(items => items.map(item => item.id === selection.id ? { ...item, task: { kind, state: "error", result: readableApiError(error, "图表理解失败，请稍后重试。") } } : item));
    }
  }
  function persistHighlight(selection: Selection) {
    if (!selection.highlightColor) return;
    setHighlights((items) => {
      const saved = { ...selection, color: selection.highlightColor! };
      return [...items.filter((item) => item.id !== selection.id), saved];
    });
  }
  function highlightSelection(id: string, color: string) {
    setSelections((items) => items.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, highlightColor: color };
      persistHighlight(next); return next;
    }));
  }
  async function followupExplanation(selection: Selection, question: string) {
    updateTask(selection.id, { kind: "explain", state: "loading" });
    try {
      if (!session) throw new Error("AUTH_REQUIRED");
      const response = await functionRequest("ai-explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedText: selection.text, nearbyContext: `${selection.context}\n\n上一轮解释：\n${selection.task?.result || ""}\n\n追问：${question}`, documentContext: documentText.slice(0, 100000), pageNumber: selection.pageNumber, model, requestId: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      updateTask(selection.id, { kind: "explain", state: "done", result: result.text });
      if (typeof result.creditsRemaining === "number") setUsage((current) => current ? { ...current, creditsRemaining: result.creditsRemaining } : current);
    } catch (error) { updateTask(selection.id, { kind: "explain", state: "error", result: readableApiError(error, "追问失败，请稍后重试。") }); }
  }
  async function askQuestion() {
    const currentQuestion = question.trim();
    if (!currentQuestion || !documentReady || !model || chatLoading) return;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: currentQuestion }]);
    setChatLoading(true);
    try {
      if (!session) throw new Error("AUTH_REQUIRED");
      const history = [...messages, { role: "user" as const, content: currentQuestion }].slice(-12);
      const response = await functionRequest("ai-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, documentContext: documentText.slice(0, 100000), messages: history, requestId: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setMessages((current) => [...current, { role: "assistant", content: result.answer }]);
      if (typeof result.creditsRemaining === "number") setUsage((current) => current ? { ...current, creditsRemaining: result.creditsRemaining } : current);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: readableApiError(error, "AI 请求失败，请稍后重试。") }]);
    } finally { setChatLoading(false); }
  }
  function updateTask(id: string, task: Task) {
    setSelections((items) =>
      items.map((item) => (item.id === id ? { ...item, task } : item)),
    );
  }
  function moveSelection(id: string, offsetX: number, offsetY: number) {
    setSelections((items) =>
      items.map((item) =>
        item.id === id ? { ...item, offsetX, offsetY } : item,
      ),
    );
  }
  async function runTask(selection: Selection, kind: "translate" | "explain") {
    updateTask(selection.id, { kind, state: "loading" });
    try {
      if (kind === "explain" && !session) throw new Error("AUTH_REQUIRED");
      const response = await functionRequest(
        kind === "translate" ? "translate" : "ai-explain",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "translate"
              ? {
                  text: selection.text,
                  sourceLanguage: "auto",
                  targetLanguage: "zh",
                }
              : {
                  selectedText: selection.text,
                  nearbyContext: selection.context,
                  documentContext: documentText.slice(0, 100000),
                  pageNumber: selection.pageNumber,
                  model,
                  requestId: crypto.randomUUID(),
                },
          ),
        },
      );
      const result = (await response.json()) as {
        translatedText?: string;
        text?: string;
        error?: string;
      };
      const content =
        kind === "translate" ? result.translatedText : result.text;
      if (!response.ok || !content) throw new Error(result.error);
      if (typeof (result as any).creditsRemaining === "number") setUsage((current) => current ? { ...current, creditsRemaining: (result as any).creditsRemaining } : current);
      updateTask(selection.id, {
        kind,
        state: "done",
        result: content,
      });
    } catch (error) {
      updateTask(selection.id, {
        kind,
        state: "error",
        result:
          kind === "translate"
            ? readableApiError(error, "翻译失败，请重试。")
            : readableApiError(error, "解释失败，请稍后重试。"),
      });
    }
  }
  function goToPage(page: number) {
    if (!pdf || !Number.isInteger(page) || page < 1 || page > pdf.numPages) return;
    setPageInput(String(page));
    document
      .getElementById(`pdf-page-${page}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function goToOutline(destination: unknown) {
    if (!pdf) return;
    const resolved =
      typeof destination === "string"
        ? await pdf.getDestination(destination)
        : destination;
    if (!Array.isArray(resolved) || !resolved[0]) return;
    const pageIndex = await pdf.getPageIndex(resolved[0]);
    goToPage(pageIndex + 1);
  }

  if (!pdf) {
    return (
      <div
        className="welcome-app"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) openFile(file);
        }}
      >
        <WelcomeScreen
          session={session}
          onOpenFile={() => fileInput.current?.click()}
          onOpenUrl={() => setUrlOpen(true)}
          onOpenAccount={() => setAuthOpen(true)}
        />
        <input ref={fileInput} className="welcome-file-input" type="file" accept="application/pdf" onChange={(event) => event.target.files?.[0] && openFile(event.target.files[0])} />
        {authOpen && (session ? <AccountDialog session={session} usage={usage} onClose={() => setAuthOpen(false)} onSignOut={() => { signOut(); setAuthOpen(false); }} /> : <AuthDialog mode={authMode} email={authEmail} password={authPassword} name={authName} code={authCode} error={authError} notice={authNotice} verifying={authVerifying} onClose={() => setAuthOpen(false)} onSubmit={submitAuth} onVerify={verifyEmailCode} onResend={resendEmailCode} onModeChange={(nextMode) => { setAuthMode(nextMode); setAuthVerifying(false); setAuthError(""); setAuthNotice(""); }} onEmail={setAuthEmail} onPassword={setAuthPassword} onName={setAuthName} onCode={setAuthCode} />)}
        {urlOpen && <div className="auth-backdrop"><form className="auth-dialog" onSubmit={(event) => { event.preventDefault(); openPdfUrl(); }}><button type="button" className="popover-close" onClick={() => setUrlOpen(false)}><X size={16} /></button><h2>打开在线 PDF</h2><p className="auth-notice">支持公开的 PDF 直链。跨域受限的链接需登录后导入，文件不会保存到服务器。</p><input type="url" required placeholder="粘贴 PDF 直链，例如 https://arxiv.org/pdf/..." value={paperUrl} onChange={(event) => { setPaperUrl(event.target.value); setUrlError(""); }} />{urlError && <p>{urlError}</p>}<button type="submit" disabled={urlLoading}>{urlLoading ? "正在读取…" : "打开 PDF"}</button></form></div>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <IconButton
            label="切换目录"
            onClick={() => setRailOpen((value) => !value)}
            active={railOpen}
          >
            <PanelLeft size={18} />
          </IconButton>
          <strong>
            <img className="brand-mark" src="/brand/inkwise-mark.svg" alt="" />
            墨知 <span className="brand-english">Inkwise</span>
          </strong>
          <span className="filename">{fileName || "未打开文档"}</span>
        </div>
        {pdf && (
          <div className="topbar-center">
            <button className="search-trigger" title="文档搜索将在下一阶段接入">
              <Search size={16} />
              搜索
            </button>
            <form className="page-jump" onSubmit={(event) => { event.preventDefault(); goToPage(Number(pageInput)); }}>
              <input aria-label="跳转页码" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} onBlur={() => setPageInput(String(currentPage))} />
              <span>/ {pdf.numPages}</span>
            </form>
            <div className="zoom-group" title="也可按住 Ctrl 或 Command 使用鼠标滚轮缩放">
              <IconButton
                label="缩小"
                onClick={() =>
                  setScale((value) => Math.max(0.6, +(value - 0.1).toFixed(1)))
                }
              >
                <Minus size={16} />
              </IconButton>
              <span>{Math.round(scale * 100)}%</span>
              <IconButton
                label="放大"
                onClick={() =>
                  setScale((value) => Math.min(3, +(value + 0.1).toFixed(1)))
                }
              >
                <Plus size={16} />
              </IconButton>
            </div>
            <IconButton label={visualMode ? "退出图表框选" : "框选图片或表格"} active={visualMode} onClick={() => { setVisualMode(value => !value); setSelections([]); }}>
              <ScanLine size={17} />
            </IconButton>
          </div>
        )}
        <div className="topbar-right">
          <label className="open-button">
            <FolderOpen size={16} />
            打开 PDF
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              onChange={(event) =>
                event.target.files?.[0] && openFile(event.target.files[0])
              }
            />
          </label>
          <IconButton label="全屏">
            <Maximize size={17} />
          </IconButton>
          <IconButton
            label="切换主题"
            onClick={() =>
              setTheme((value) => (value === "light" ? "dark" : "light"))
            }
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </IconButton>
          <IconButton
            label="切换 AI 面板"
            onClick={() => setPanelOpen((value) => !value)}
            active={panelOpen}
          >
            <PanelRight size={18} />
          </IconButton>
          <IconButton label={session ? "账户与额度" : "登录"} onClick={() => setAuthOpen(true)}>
            {session ? <UserRound size={17} /> : <LogIn size={17} />}
          </IconButton>
        </div>
      </header>
      <main
        className={`workspace${railOpen ? " rail-open" : ""}${panelOpen ? " panel-open" : ""}`}
        style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
      >
        <nav className="rail" aria-label="文档导航">
          <div className="rail-tabs">
            <button className="active">大纲</button>
          </div>
          {pdf ? (
            <div className="outline-list">
              {outline.length ? (
                <OutlineTree items={outline} onNavigate={goToOutline} />
              ) : (
                <p>该文档未提供大纲。</p>
              )}
            </div>
          ) : (
            <p>打开文档后显示大纲。</p>
          )}
        </nav>
        <section className="viewer">
          <div
            className="document-scroll"
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              const direction = event.deltaY > 0 ? -1 : 1;
              setScale((value) => Math.max(0.6, Math.min(3, +(value + direction * 0.1).toFixed(1))));
            }}
          >
              {Array.from({ length: pdf.numPages }, (_, index) => (
                <PageView
                  key={index + 1}
                  pdf={pdf}
                  pageNumber={index + 1}
                  scale={scale}
                  selections={selections.filter(
                    (item) => item.pageNumber === index + 1,
                  )}
                  onSelect={addSelection}
                  onClose={(id) =>
                    setSelections((items) =>
                      items.filter((item) => item.id !== id),
                    )
                  }
                  onTask={runTask}
                  onFollowup={followupExplanation}
                  onMove={moveSelection}
                  onHighlight={highlightSelection}
                  onDeleteHighlight={(id) => setHighlights((items) => items.filter((item) => item.id !== id))}
                  highlights={highlights.filter((item) => item.pageNumber === index + 1)}
                  visualMode={visualMode}
                  visualSelections={visualSelections.filter(item => item.pageNumber === index + 1)}
                  onVisualSelect={addVisualSelection}
                  onVisualClose={(id) => setVisualSelections(items => items.filter(item => item.id !== id))}
                  onVisualTask={runVisualTask}
                  onVisible={(page) => { setCurrentPage(page); setPageInput(String(page)); }}
                />
              ))}
              <div className="page-pill">
                第 {currentPage} / {pdf.numPages} 页
              </div>
          </div>
        </section>
        {panelOpen && (
          <div
            className="panel-resizer"
            role="separator"
            aria-label="调整 AI 侧栏宽度"
            aria-orientation="vertical"
            onMouseDown={(event) => {
              event.preventDefault();
              panelResize.current = { startX: event.clientX, startWidth: panelWidth };
              document.body.classList.add("is-resizing-panel");
            }}
          >
            <GripVertical size={14} />
          </div>
        )}
        <aside className="ai-panel">
          <div className="panel-header">
            <span className="panel-status">{usage && <small className="quota-badge">{usage.plan} · {usage.creditsRemaining} 分</small>}</span>
            <IconButton label="收起面板" onClick={() => setPanelOpen(false)}>
              <ChevronRight size={17} />
            </IconButton>
          </div>
          <div className="panel-content ai-reading-panel">
            {(
              [
                ["short", "三行摘要", summary.short],
                ["full", "摘要", summary.full],
              ] as const
            ).map(([kind, title, value]) => (
              <section className="ai-section" key={kind}>
                <div className="ai-section-title">
                  <strong>{title}</strong>
                  <IconButton
                    label={`折叠${title}`}
                    onClick={() =>
                      value &&
                      setSummaryOpen((current) => ({
                        ...current,
                        [kind]: !current[kind],
                      }))
                    }
                  >
                    <ChevronDown size={16} />
                  </IconButton>
                </div>
                {value ? (
                  <>
                    <div
                      className={`summary-result reference-style${summaryOpen[kind] ? " open" : ""}`}
                    >
                      <ReactMarkdown>{value}</ReactMarkdown>
                    </div>
                    <div className="summary-tools">
                      <IconButton
                        label="复制摘要"
                        onClick={() => navigator.clipboard.writeText(value)}
                      >
                        <Copy size={15} />
                      </IconButton>
                      <IconButton
                        label="重新生成摘要"
                        onClick={() => requestSummary(kind)}
                      >
                        <RefreshCw size={15} />
                      </IconButton>
                    </div>
                    {!summaryOpen[kind] && (
                      <button
                        className="show-more"
                        onClick={() =>
                          setSummaryOpen((current) => ({
                            ...current,
                            [kind]: true,
                          }))
                        }
                      >
                        Show more
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="generate-summary"
                    onClick={() => requestSummary(kind)}
                    disabled={
                      !defaultModel || !documentReady || summary.loading === kind
                    }
                  >
                    {summary.loading === kind ? "生成中…" : `生成${title}`}
                  </button>
                )}
              </section>
            ))}
            <section className="chat-thread">
              <div className="chat-messages">
                {messages.map((message, index) => (
                  <div key={index} className={`chat-message ${message.role}`}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                ))}
              {chatLoading && (
                <div className="chat-message assistant">正在思考…</div>
              )}
              </div>
            </section>
          </div>
          <div className="chat-composer">
            <textarea
              aria-label="文档提问"
              placeholder={model ? "针对文档提问…" : "请先配置模型"}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  askQuestion();
                }
              }}
              disabled={!model || !documentReady}
            />
            <button
              className="send-button"
              aria-label="发送问题"
              onClick={askQuestion}
              disabled={
                !model || !documentReady || !question.trim() || chatLoading
              }
            >
              <Send size={17} />
            </button>
            <div className="composer-footer">
              <div className="composer-model">
                <SlidersHorizontal size={15} />
                <select
                  aria-label="选择对话模型"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={!models.length}
                >
                  <option value="">未配置</option>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </aside>
      </main>
      {authOpen && (session ? <AccountDialog session={session} usage={usage} onClose={() => setAuthOpen(false)} onSignOut={() => { signOut(); setAuthOpen(false); }} /> : <AuthDialog mode={authMode} email={authEmail} password={authPassword} name={authName} code={authCode} error={authError} notice={authNotice} verifying={authVerifying} onClose={() => setAuthOpen(false)} onSubmit={submitAuth} onVerify={verifyEmailCode} onResend={resendEmailCode} onModeChange={(nextMode) => { setAuthMode(nextMode); setAuthVerifying(false); setAuthError(""); setAuthNotice(""); }} onEmail={setAuthEmail} onPassword={setAuthPassword} onName={setAuthName} onCode={setAuthCode} />)}
      {urlOpen && <div className="auth-backdrop"><form className="auth-dialog" onSubmit={(event) => { event.preventDefault(); openPdfUrl(); }}><button type="button" className="popover-close" onClick={() => setUrlOpen(false)}><X size={16} /></button><h2>打开在线 PDF</h2><p className="auth-notice">支持公开的 PDF 直链。跨域受限的链接需登录后导入，文件不会保存到服务器。</p><input type="url" required placeholder="粘贴 PDF 直链，例如 https://arxiv.org/pdf/..." value={paperUrl} onChange={(event) => { setPaperUrl(event.target.value); setUrlError(""); }} />{urlError && <p>{urlError}</p>}<button type="submit" disabled={urlLoading}>{urlLoading ? "正在读取…" : "打开 PDF"}</button></form></div>}
    </div>
  );
}
if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) mountAdmin();
else createRoot(document.getElementById("root")!).render(<App />);
