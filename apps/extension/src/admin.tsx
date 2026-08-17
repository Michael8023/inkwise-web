import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronLeft, ChevronRight, Coins, FileText, LogOut, MessageSquare, Search, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";
import { functionRequest, supabase, supabaseConfigured } from "./api";
import "./style.css";

type AdminUser = {
  user_id: string; email: string; username: string | null; display_name: string | null;
  plan_name: string | null; plan_id: string | null; credits_remaining: number;
  period_end: string | null; status: string; created_at: string; library_paper_count: number; library_storage_bytes: number; invite_code: string | null; invited_by_email: string | null; successful_referral_count: number; referral_bonus_credits: number;
};
type Plan = { id: string; name: string; monthly_credits: number; is_default: boolean };
type CatalogModel = { id: string; name: string; provider: string; enabled: boolean; free_enabled?: boolean; pro_enabled?: boolean };
type Detail = {
  usage: Array<{ id: string; feature: string; model: string; credits: number; status: string; created_at: string }>;
  adjustments: Array<{ id: string; operation: string; amount: number; credits_before: number; credits_after: number; note: string | null; created_at: string }>;
};
type FeedbackItem = { id: string; user_id: string; category: "suggestion" | "bug" | "other"; content: string; status: "todo" | "done"; created_at: string; email: string };
type UpstreamBalance = { name: string; totalGranted: number; totalUsed: number; totalAvailable: number; availableAmountUsd: number; usedAmountUsd: number; quotaPerUsd: number; unlimited: boolean; expiresAt: number | null };
type DatabaseStorage = { databaseBytes: number; publicRelationBytes: number; pdfStorageBytes: number; pdfObjectCount: number; largestTables: Array<{ name: string; bytes: number }> };

const errors: Record<string, string> = {
  ADMIN_REQUIRED: "当前账号没有后台管理权限。",
  AUTH_REQUIRED: "请先登录管理员账号。",
  INVALID_ADJUSTMENT: "请输入有效的额度数值。",
  DELETE_CONFIRMATION_INVALID: "请输入与目标账户完全一致的邮箱地址以确认删除。",
  ADMIN_DELETE_FORBIDDEN: "不能删除管理员账户，包括当前登录的管理员。",
  USER_NOT_FOUND: "该用户已不存在或已被删除。",
  INVALID_MODELS: "请至少选择一个有效模型。",
  UPSTREAM_MODELS_FAILED: "无法读取模型服务列表，请稍后刷新重试。",
  APILIO_BALANCE_NOT_CONFIGURED: "尚未配置 Apilio 系统令牌或用户 ID。",
  UPSTREAM_BALANCE_FAILED: "无法读取 Apilio 上游余额，请稍后重试。",
  NETWORK_REQUEST_FAILED: "请求未能到达后台。请确认 Edge Function 已部署，并检查网络或跨域配置。",
  PASSWORD_INVALID: "密码长度需为 8 至 72 位。",
  PASSWORD_MISMATCH: "两次输入的密码不一致。",
  ADMIN_PASSWORD_SELF_FORBIDDEN: "请使用账户中心的忘记密码流程重设自己的密码。",
  PASSWORD_RESET_FAILED: "密码重设失败，请稍后重试。",
  INVALID_REFERRAL_BONUS: "请输入有效的邀请码奖励额度。",
};
function formatStorage(bytes: number) {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function FeedbackAdmin() {
  const [items, setItems] = useState<FeedbackItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  async function request(init?: RequestInit) { const response = await functionRequest("admin-users?feedback=1", init); const result = await response.json(); if (!response.ok) throw new Error(result.error || "ADMIN_REQUEST_FAILED"); return result; }
  async function load() { setLoading(true); setError(""); try { const result = await request(); setItems(result.feedback || []); } catch (cause) { setError(cause instanceof Error ? cause.message : "加载失败。"); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function setStatus(item: FeedbackItem) { try { await request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setFeedbackStatus", feedbackId: item.id, status: item.status === "todo" ? "done" : "todo" }) }); setItems(all => all.map(entry => entry.id === item.id ? { ...entry, status: entry.status === "todo" ? "done" : "todo" } : entry)); } catch { setError("更新反馈状态失败。"); } }
  async function remove(id: string) { if (!window.confirm("删除这条反馈？此操作不可恢复。")) return; try { const response = await functionRequest("admin-users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteFeedback", feedbackId: id }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setItems(all => all.filter(item => item.id !== id)); } catch { setError("删除反馈失败。"); } }
  const todo = items.filter(item => item.status === "todo"); const done = items.filter(item => item.status === "done");
  const cards = (list: FeedbackItem[]) => list.map(item => <article className={`feedback-todo-card ${item.status}`} key={item.id}><header><span className={`feedback-category ${item.category}`}>{item.category === "bug" ? "问题反馈" : item.category === "suggestion" ? "功能建议" : "其他想法"}</span><time>{new Date(item.created_at).toLocaleString("zh-CN")}</time></header><p>{item.content}</p><footer><span>{item.email}</span><div><button onClick={() => void setStatus(item)}>{item.status === "todo" ? <><Check size={14}/>标记完成</> : "重新打开"}</button><button className="feedback-delete" onClick={() => void remove(item.id)}><Trash2 size={14}/>删除</button></div></footer></article>);
  return <main className="admin-main feedback-admin-main"><header><div><span>CO-CREATION TODO</span><h1>用户反馈</h1><p>每一条反馈都是识谛继续学习的方向。</p></div><button className="admin-refresh" onClick={load}>刷新反馈</button></header>{error && <div className="admin-alert"><ShieldCheck size={17}/>{error}</div>}{loading ? <div className="admin-empty">正在整理反馈…</div> : <div className="feedback-todo-layout"><section><div className="feedback-todo-head"><h2>待处理</h2><b>{todo.length}</b></div>{cards(todo)}{!todo.length && <p className="history-empty">暂无待处理反馈</p>}</section><section><div className="feedback-todo-head"><h2>已完成</h2><b>{done.length}</b></div>{cards(done)}{!done.length && <p className="history-empty">暂无已完成反馈</p>}</section></div>}</main>;
}

function AdminApp() {
  const [session, setSession] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [operation, setOperation] = useState("add");
  const [amount, setAmount] = useState("100");
  const [planId, setPlanId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [freeModelIds, setFreeModelIds] = useState<Set<string>>(new Set());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [adminPage, setAdminPage] = useState<"users" | "models" | "balance" | "feedback">("users");
  const [referralBonus, setReferralBonus] = useState("50");
  const [referralSaving, setReferralSaving] = useState(false);
  const [upstreamBalance, setUpstreamBalance] = useState<UpstreamBalance | null>(null);
  const [balanceCheckedAt, setBalanceCheckedAt] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [databaseStorage, setDatabaseStorage] = useState<DatabaseStorage | null>(null);
  const [storageCheckedAt, setStorageCheckedAt] = useState("");
  const [storageLoading, setStorageLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecked(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session && adminPage === "users") void loadUsers(); }, [session, page, query, adminPage]);
  useEffect(() => { if (session && adminPage === "models") void loadModels(); }, [session, adminPage]);
  useEffect(() => { if (!session || adminPage !== "balance") return; void loadUpstreamBalance(); void loadDatabaseStorage(); const timer = window.setInterval(() => { void loadUpstreamBalance(); void loadDatabaseStorage(); }, 30_000); return () => window.clearInterval(timer); }, [session, adminPage]);

  async function request(path = "", init?: RequestInit) {
    const response = await functionRequest(`admin-users${path}`, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ADMIN_REQUEST_FAILED");
    return result;
  }
  async function loadUsers() {
    setLoading(true); setError("");
    try {
      const result = await request(`?search=${encodeURIComponent(query)}&page=${page}`);
      setUsers(result.users || []); setPlans(result.plans || []); setTotal(result.total || 0); setReferralBonus(String(result.referralBonus ?? 50));
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "加载失败。"); }
    finally { setLoading(false); }
  }
  async function loadModels() {
    setModelsLoading(true); setError("");
    try {
      const result = await request("?models=catalog");
      const items = Array.isArray(result.models) ? result.models as CatalogModel[] : [];
      setCatalogModels(items);
      setSelectedModelIds(new Set(items.filter(item => item.pro_enabled ?? item.enabled).map(item => item.id)));
      setFreeModelIds(new Set(items.filter(item => item.free_enabled ?? item.enabled).map(item => item.id)));
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "模型列表加载失败。"); }
    finally { setModelsLoading(false); }
  }
  async function loadUpstreamBalance() {
    setBalanceLoading(true);
    try { const result = await request("?balance=1"); setUpstreamBalance(result.balance || null); setBalanceCheckedAt(result.checkedAt || new Date().toISOString()); }
    catch (cause) { const code = cause instanceof Error ? cause.message : ""; setError(current => current || errors[code] || code || "上游余额读取失败。"); }
    finally { setBalanceLoading(false); }
  }
  async function loadDatabaseStorage() {
    setStorageLoading(true);
    try { const result = await request("?databaseStorage=1"); setDatabaseStorage(result.storage || null); setStorageCheckedAt(result.checkedAt || new Date().toISOString()); }
    catch (cause) { const code = cause instanceof Error ? cause.message : ""; setError(current => current || errors[code] || code || "数据库存储读取失败。"); }
    finally { setStorageLoading(false); }
  }
  function toggleModel(id: string) {
    setSelectedModelIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleFreeModel(id: string) { setFreeModelIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function saveModels() {
    const selected = catalogModels.filter(item => selectedModelIds.has(item.id));
    if (!selected.length || !freeModelIds.size) { setError(errors.INVALID_MODELS); return; }
    setModelsSaving(true); setError("");
    try {
      await request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveModels", models: catalogModels.map(({ id, name, provider }) => ({ id, name, provider, freeEnabled: freeModelIds.has(id), proEnabled: selectedModelIds.has(id) })) }) });
      await loadModels();
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "模型配置保存失败。"); }
    finally { setModelsSaving(false); }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!supabaseConfigured) { setError("尚未配置 Supabase。"); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
  }
  async function openUser(item: AdminUser) {
    setSelected(item); setPlanId(item.plan_id || ""); setDetail(null); setError(""); setAdminPassword(""); setAdminPasswordConfirm("");
    try { setDetail(await request(`?userId=${item.user_id}`)); }
    catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "记录加载失败。"); }
  }
  async function saveAdjustment(event: React.FormEvent) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError("");
    try {
      const result = await request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: selected.user_id, operation, amount: Number(amount), planId: planId || null, note }) });
      const updated = { ...selected, credits_remaining: result.creditsAfter, plan_id: planId || selected.plan_id, plan_name: plans.find(plan => plan.id === planId)?.name || selected.plan_name };
      setSelected(updated); setUsers(current => current.map(user => user.user_id === updated.user_id ? updated : user)); setNote("");
      setDetail(await request(`?userId=${selected.user_id}`));
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "额度调整失败。"); }
    finally { setSaving(false); }
  }
  async function deleteUser() {
    if (!selected) return;
    setDeleting(true); setError("");
    try {
      await request("", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: selected.user_id, confirmation: deleteConfirmation }) });
      setUsers(current => current.filter(user => user.user_id !== selected.user_id));
      setTotal(current => Math.max(0, current - 1));
      setSelected(null); setDetail(null); setDeleteConfirmOpen(false); setDeleteConfirmation("");
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "删除用户失败。"); }
    finally { setDeleting(false); }
  }
  async function resetUserPassword(event: React.FormEvent) {
    event.preventDefault(); if (!selected) return;
    if (adminPassword !== adminPasswordConfirm) { setError(errors.PASSWORD_MISMATCH); return; }
    setPasswordSaving(true); setError("");
    try {
      await request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resetPassword", userId: selected.user_id, password: adminPassword }) });
      setAdminPassword(""); setAdminPasswordConfirm("");
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "密码重设失败。"); }
    finally { setPasswordSaving(false); }
  }
  async function saveReferralBonus(event: React.FormEvent) {
    event.preventDefault(); setReferralSaving(true); setError("");
    try { await request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveReferralBonus", signupBonus: Number(referralBonus) }) }); }
    catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "邀请码奖励保存失败。"); }
    finally { setReferralSaving(false); }
  }

  if (!checked) return <div className="admin-loading">正在检查登录状态…</div>;
  if (!session) return <main className="admin-login"><form onSubmit={login} className="admin-login-card"><img src="/brand/shidea-mark.png" alt="" /><span>SHIDEA CONTROL</span><h1>后台管理</h1><label>管理员邮箱<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label><label>密码<input type="password" required value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <p className="admin-error">{error}</p>}<button type="submit">安全登录</button><a href="/">返回阅读器</a></form></main>;

  const pages = Math.max(1, Math.ceil(total / 30));
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const visibleModels = catalogModels.filter(item => !normalizedModelSearch || `${item.name} ${item.id} ${item.provider}`.toLowerCase().includes(normalizedModelSearch));
  const modelGroups = visibleModels.reduce<Record<string, CatalogModel[]>>((groups, item) => { (groups[item.provider] ||= []).push(item); return groups; }, {});
  const formatQuota = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  return <div className="admin-app">
    <aside className="admin-nav"><div className="admin-logo"><img src="/brand/shidea-mark.png" alt="" /><div>识谛<strong>CONTROL</strong></div></div><nav><button className={adminPage === "users" ? "active" : ""} onClick={() => setAdminPage("users")}><Users size={17}/>用户与积分</button><button className={adminPage === "models" ? "active" : ""} onClick={() => setAdminPage("models")}><Sparkles size={17}/>模型权限</button><button className={adminPage === "balance" ? "active" : ""} onClick={() => setAdminPage("balance")}><Coins size={17}/>Apilio 余额</button><button className={adminPage === "feedback" ? "active" : ""} onClick={() => setAdminPage("feedback")}><MessageSquare size={17}/>反馈待办</button></nav><div className="admin-nav-foot"><span>{session.user.email}</span><button onClick={() => supabase.auth.signOut()}><LogOut size={15}/>退出</button></div></aside>
    {adminPage === "feedback" ? <FeedbackAdmin /> : adminPage === "models" ? <main className="admin-main"><header><div><span>MODEL ACCESS</span><h1>模型权限</h1><p>分别定义 Free 与 Pro 用户可使用的模型。</p></div></header>{error && <div className="admin-alert"><ShieldCheck size={17}/>{error}</div>}<section className="model-management admin-page-card"><div className="model-management-head"><div><span>FREE / PRO</span><h2>可用模型配置</h2><p>Free 用户可见全部模型，但只能选择标记为 Free 的模型；Pro 可使用标记为 Pro 的模型。</p></div><div><button type="button" className="admin-refresh" onClick={loadModels} disabled={modelsLoading || modelsSaving}>{modelsLoading ? "读取中…" : "刷新列表"}</button><button type="button" className="admin-save-models" onClick={saveModels} disabled={modelsLoading || modelsSaving || !catalogModels.length}>{modelsSaving ? "正在保存…" : "保存模型权限"}</button></div></div>{!modelsLoading && <div className="model-search"><Search size={16}/><input value={modelSearch} onChange={event => setModelSearch(event.target.value)} placeholder="搜索模型、模型 ID 或厂商" /><span>Free {freeModelIds.size} · Pro {selectedModelIds.size}</span></div>}{modelsLoading ? <p className="model-empty">正在从模型服务读取列表…</p> : <div className="model-provider-groups">{Object.entries(modelGroups).map(([provider, items]) => <details key={provider} open><summary><span>{provider}</span><b>{items.length} 个模型</b></summary><div>{items.map(item => <div key={item.id} className="model-option"><span>{item.name}<small>{item.id}</small></span><label>Free<input type="checkbox" checked={freeModelIds.has(item.id)} onChange={() => toggleFreeModel(item.id)} /></label><label>Pro<input type="checkbox" checked={selectedModelIds.has(item.id)} onChange={() => toggleModel(item.id)} /></label></div>)}</div></details>)}{!visibleModels.length && <p className="model-empty">没有匹配的模型</p>}</div>}</section></main> : adminPage === "balance" ? <main className="admin-main"><header><div><span>APILIO & DATABASE</span><h1>账户与数据库资源</h1><p>本页面打开时，每 30 秒刷新 Apilio 余额与数据库存储情况。</p></div><button className="admin-refresh" onClick={() => { void loadUpstreamBalance(); void loadDatabaseStorage(); }} disabled={balanceLoading || storageLoading}>{balanceLoading || storageLoading ? "刷新中…" : "立即刷新"}</button></header>{error && <div className="admin-alert"><ShieldCheck size={17}/>{error}</div>}<section className="admin-balance-page">{upstreamBalance ? <><div className="admin-balance-primary"><span>当前可用余额</span><strong>{upstreamBalance.unlimited ? "不限额" : `US$ ${upstreamBalance.availableAmountUsd.toFixed(2)}`}</strong><small>{upstreamBalance.name} · 最近更新 {balanceCheckedAt ? new Date(balanceCheckedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</small></div><div className="admin-balance-grid"><article><span>剩余额度</span><strong>{formatQuota(upstreamBalance.totalAvailable)}</strong><small>按当前 Apilio 账户配额</small></article><article><span>已使用金额</span><strong>US$ {upstreamBalance.usedAmountUsd.toFixed(2)}</strong><small>累计账户使用量</small></article><article><span>已发放额度</span><strong>{formatQuota(upstreamBalance.totalGranted)}</strong><small>额度单位：{formatQuota(upstreamBalance.quotaPerUsd)} / US$1</small></article></div></> : <div className="admin-empty">{balanceLoading ? "正在读取 Apilio 账户余额…" : "暂无余额数据，请点击立即刷新。"}</div>}{databaseStorage ? <section className="database-storage-card"><div><span>DATABASE STORAGE</span><h2>数据库存储占用</h2><p>不包含 Supabase Storage 中的 PDF 等对象文件。</p></div><strong>{formatStorage(databaseStorage.databaseBytes)}</strong><small>业务表及其索引 {formatStorage(databaseStorage.publicRelationBytes)} · 更新于 {storageCheckedAt ? new Date(storageCheckedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</small><div className="database-largest-tables">{databaseStorage.largestTables.map(item => <span key={item.name}><b>{item.name}</b><em>{formatStorage(item.bytes)}</em></span>)}</div></section> : <div className="admin-empty">{storageLoading ? "正在读取数据库占用…" : "暂无数据库存储数据。"}</div>}</section></main> : <main className="admin-main"><header><div><span>USER OPERATIONS</span><h1>用户与积分</h1><p>管理用户积分、会员状态与人工调整记录。</p></div><div className="admin-header-stats"><div className="admin-stat"><Users size={18}/><span>注册用户<strong>{total}</strong></span></div></div></header>
      <section className="admin-toolbar"><form onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}><Search size={17}/><input placeholder="搜索邮箱、用户名" value={search} onChange={event => setSearch(event.target.value)}/><button>搜索</button></form><button className="admin-refresh" onClick={loadUsers}>刷新数据</button></section>
      {error && <div className="admin-alert"><ShieldCheck size={17}/>{error}</div>}
      <section className="referral-management"><div><span>邀请码奖励</span><h2>注册奖励配置</h2><p>新用户注册时填写有效邀请码后，获得此处设置的额外 AI 额度。</p></div><form onSubmit={saveReferralBonus}><label>奖励额度<input type="number" min="0" max="10000000" required value={referralBonus} onChange={event => setReferralBonus(event.target.value)} /><small>分</small></label><button disabled={referralSaving}>{referralSaving ? "保存中…" : "保存奖励"}</button></form></section>
      <section className="admin-table-wrap"><table><thead><tr><th>用户</th><th>套餐</th><th>剩余额度</th><th>邀请码 / 邀请</th><th>文献库</th><th>状态</th><th>注册时间</th><th></th></tr></thead><tbody>{users.map(item => <tr key={item.user_id}><td><strong>{item.display_name || item.username || "未命名用户"}</strong><span>{item.email}</span></td><td><b className="plan-pill">{(item.plan_name || "-").toUpperCase()}</b></td><td><strong className="credit-number">{Number(item.credits_remaining).toLocaleString()}</strong></td><td><div className="admin-referral-usage"><strong>{item.invite_code || "-"}</strong><span>{item.invited_by_email ? `受邀：${item.invited_by_email}` : "自主注册"}</span><em>已邀 {Number(item.successful_referral_count || 0)} 人 · 奖励 +{Number(item.referral_bonus_credits || 0)}</em></div></td><td><div className="admin-library-usage"><strong>{Number(item.library_paper_count || 0).toLocaleString()} 篇</strong><span>{formatStorage(Number(item.library_storage_bytes || 0))}</span></div></td><td><i className={item.status === "active" ? "status-active" : ""}>{item.status}</i></td><td>{new Date(item.created_at).toLocaleDateString("zh-CN")}</td><td><button className="row-action" onClick={() => openUser(item)}>管理</button></td></tr>)}</tbody></table>{!loading && !users.length && <div className="admin-empty">没有找到匹配用户</div>}{loading && <div className="admin-empty">正在加载…</div>}</section>
      <footer className="admin-pagination"><span>共 {total} 位用户</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/></button><b>{page} / {pages}</b><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16}/></button></div></footer>
    </main>}
    {selected && <div className="admin-drawer-backdrop" onMouseDown={event => event.target === event.currentTarget && setSelected(null)}><aside className="admin-drawer"><button className="admin-close" onClick={() => setSelected(null)}><X size={18}/></button><div className="drawer-user"><div>{(selected.display_name || selected.email).slice(0,1).toUpperCase()}</div><span><h2>{selected.display_name || selected.username || "用户"}</h2><p>{selected.email}</p></span></div><div className="drawer-balance"><Coins size={20}/><span>当前可用额度<strong>{Number(selected.credits_remaining).toLocaleString()} 分</strong></span></div><div className="drawer-library-usage"><FileText size={19}/><span>个人文献库<strong>{Number(selected.library_paper_count || 0).toLocaleString()} 篇 · {formatStorage(Number(selected.library_storage_bytes || 0))}</strong></span></div><div className="drawer-referral"><strong>邀请码：{selected.invite_code || "-"}</strong><span>{selected.invited_by_email ? `邀请人：${selected.invited_by_email}` : "未填写邀请码"}</span><span>成功邀请 {Number(selected.successful_referral_count || 0)} 人 · 本人奖励 +{Number(selected.referral_bonus_credits || 0)} 分</span></div>
      <form className="adjust-form" onSubmit={saveAdjustment}><h3>调整账户</h3><label>操作<select value={operation} onChange={event => setOperation(event.target.value)}><option value="add">增加额度</option><option value="subtract">扣减额度</option><option value="set">设为指定额度</option></select></label><label>额度<input type="number" min="0" max="10000000" required value={amount} onChange={event => setAmount(event.target.value)}/></label><label>套餐<select value={planId} onChange={event => setPlanId(event.target.value)}>{plans.map(plan => <option value={plan.id} key={plan.id}>{plan.name.toUpperCase()} · 月额度 {plan.monthly_credits}</option>)}</select></label><label>操作备注<textarea maxLength={300} placeholder="例如：购买 Pro 套餐、活动赠送" value={note} onChange={event => setNote(event.target.value)}/></label><button disabled={saving}>{saving ? "正在保存…" : "确认调整"}</button></form>
      <section className="drawer-history"><h3>人工调整</h3>{detail?.adjustments.map(item => <article key={item.id}><Sparkles size={14}/><div><strong>{item.operation === "add" ? "+" : item.operation === "subtract" ? "-" : "="}{item.amount} 分</strong><span>{item.credits_before} → {item.credits_after} · {new Date(item.created_at).toLocaleString("zh-CN")}</span>{item.note && <p>{item.note}</p>}</div></article>)}{detail && !detail.adjustments.length && <p className="history-empty">暂无人工调整记录</p>}<h3>近期 AI 消费</h3>{detail?.usage.map(item => <article key={item.id}><Coins size={14}/><div><strong>-{item.credits} 分 · {item.feature}</strong><span>{item.model} · {new Date(item.created_at).toLocaleString("zh-CN")}</span></div></article>)}{detail && !detail.usage.length && <p className="history-empty">暂无 AI 消费记录</p>}</section>
      <form className="admin-password-reset" onSubmit={resetUserPassword}><h3>直接重设密码</h3><p>无需验证码。请将新密码安全地告知该用户。</p><label>新密码<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} /></label><label>确认新密码<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={adminPasswordConfirm} onChange={event => setAdminPasswordConfirm(event.target.value)} /></label><button disabled={passwordSaving}>{passwordSaving ? "正在重设…" : "重设此用户密码"}</button></form>
      <section className="admin-danger-zone"><div><strong>删除用户</strong><span>该操作会永久删除登录账户及关联额度、用量和资料。</span></div><button type="button" onClick={() => { setDeleteConfirmation(""); setDeleteConfirmOpen(true); }}><Trash2 size={15}/>删除账户</button></section>
      {deleteConfirmOpen && <div className="admin-confirm"><div><h3>永久删除账户？</h3><p>此操作不可撤销。请输入目标用户邮箱以确认：</p><strong>{selected.email}</strong><input autoFocus value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder="输入完整邮箱地址" /><footer><button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>取消</button><button type="button" className="admin-delete-confirm" onClick={deleteUser} disabled={deleting || deleteConfirmation.trim().toLowerCase() !== selected.email.toLowerCase()}>{deleting ? "正在删除…" : "永久删除"}</button></footer></div></div>}
    </aside></div>}
  </div>;
}

export function mountAdmin() { createRoot(document.getElementById("root")!).render(<AdminApp />); }
