import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, Coins, LogOut, Search, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { functionRequest, supabase, supabaseConfigured } from "./api";
import "./style.css";

type AdminUser = {
  user_id: string; email: string; username: string | null; display_name: string | null;
  plan_name: string | null; plan_id: string | null; credits_remaining: number;
  period_end: string | null; status: string; created_at: string;
};
type Plan = { id: string; name: string; monthly_credits: number };
type Detail = {
  usage: Array<{ id: string; feature: string; model: string; credits: number; status: string; created_at: string }>;
  adjustments: Array<{ id: string; operation: string; amount: number; credits_before: number; credits_after: number; note: string | null; created_at: string }>;
};

const errors: Record<string, string> = {
  ADMIN_REQUIRED: "当前账号没有后台管理权限。",
  AUTH_REQUIRED: "请先登录管理员账号。",
  INVALID_ADJUSTMENT: "请输入有效的额度数值。",
};

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecked(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) loadUsers(); }, [session, page, query]);

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
      setUsers(result.users || []); setPlans(result.plans || []); setTotal(result.total || 0);
    } catch (cause) { const code=cause instanceof Error?cause.message:""; setError(errors[code] || code || "加载失败。"); }
    finally { setLoading(false); }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!supabaseConfigured) { setError("尚未配置 Supabase。"); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
  }
  async function openUser(item: AdminUser) {
    setSelected(item); setPlanId(item.plan_id || ""); setDetail(null); setError("");
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

  if (!checked) return <div className="admin-loading">正在检查登录状态…</div>;
  if (!session) return <main className="admin-login"><form onSubmit={login} className="admin-login-card"><img src="/brand/inkwise-mark.svg" alt="" /><span>INKWISE CONTROL</span><h1>后台管理</h1><label>管理员邮箱<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label><label>密码<input type="password" required value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <p className="admin-error">{error}</p>}<button type="submit">安全登录</button><a href="/">返回阅读器</a></form></main>;

  const pages = Math.max(1, Math.ceil(total / 30));
  return <div className="admin-app">
    <aside className="admin-nav"><div className="admin-logo"><img src="/brand/inkwise-mark.svg" alt="" /><div>墨知<strong>CONTROL</strong></div></div><nav><button className="active"><Users size={17}/>用户与额度</button></nav><div className="admin-nav-foot"><span>{session.user.email}</span><button onClick={() => supabase.auth.signOut()}><LogOut size={15}/>退出</button></div></aside>
    <main className="admin-main"><header><div><span>OPERATIONS</span><h1>用户额度管理</h1><p>管理套餐、积分余额并审计每一次人工调整。</p></div><div className="admin-stat"><Users size={18}/><span>注册用户<strong>{total}</strong></span></div></header>
      <section className="admin-toolbar"><form onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}><Search size={17}/><input placeholder="搜索邮箱、用户名" value={search} onChange={event => setSearch(event.target.value)}/><button>搜索</button></form><button className="admin-refresh" onClick={loadUsers}>刷新数据</button></section>
      {error && <div className="admin-alert"><ShieldCheck size={17}/>{error}</div>}
      <section className="admin-table-wrap"><table><thead><tr><th>用户</th><th>套餐</th><th>剩余额度</th><th>状态</th><th>注册时间</th><th></th></tr></thead><tbody>{users.map(item => <tr key={item.user_id}><td><strong>{item.display_name || item.username || "未命名用户"}</strong><span>{item.email}</span></td><td><b className="plan-pill">{(item.plan_name || "-").toUpperCase()}</b></td><td><strong className="credit-number">{Number(item.credits_remaining).toLocaleString()}</strong></td><td><i className={item.status === "active" ? "status-active" : ""}>{item.status}</i></td><td>{new Date(item.created_at).toLocaleDateString("zh-CN")}</td><td><button className="row-action" onClick={() => openUser(item)}>管理</button></td></tr>)}</tbody></table>{!loading && !users.length && <div className="admin-empty">没有找到匹配用户</div>}{loading && <div className="admin-empty">正在加载…</div>}</section>
      <footer className="admin-pagination"><span>共 {total} 位用户</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/></button><b>{page} / {pages}</b><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16}/></button></div></footer>
    </main>
    {selected && <div className="admin-drawer-backdrop" onMouseDown={event => event.target === event.currentTarget && setSelected(null)}><aside className="admin-drawer"><button className="admin-close" onClick={() => setSelected(null)}><X size={18}/></button><div className="drawer-user"><div>{(selected.display_name || selected.email).slice(0,1).toUpperCase()}</div><span><h2>{selected.display_name || selected.username || "用户"}</h2><p>{selected.email}</p></span></div><div className="drawer-balance"><Coins size={20}/><span>当前可用额度<strong>{Number(selected.credits_remaining).toLocaleString()} 分</strong></span></div>
      <form className="adjust-form" onSubmit={saveAdjustment}><h3>调整账户</h3><label>操作<select value={operation} onChange={event => setOperation(event.target.value)}><option value="add">增加额度</option><option value="subtract">扣减额度</option><option value="set">设为指定额度</option></select></label><label>额度<input type="number" min="0" max="10000000" required value={amount} onChange={event => setAmount(event.target.value)}/></label><label>套餐<select value={planId} onChange={event => setPlanId(event.target.value)}>{plans.map(plan => <option value={plan.id} key={plan.id}>{plan.name.toUpperCase()} · 月额度 {plan.monthly_credits}</option>)}</select></label><label>操作备注<textarea maxLength={300} placeholder="例如：购买 Pro 套餐、活动赠送" value={note} onChange={event => setNote(event.target.value)}/></label><button disabled={saving}>{saving ? "正在保存…" : "确认调整"}</button></form>
      <section className="drawer-history"><h3>人工调整</h3>{detail?.adjustments.map(item => <article key={item.id}><Sparkles size={14}/><div><strong>{item.operation === "add" ? "+" : item.operation === "subtract" ? "-" : "="}{item.amount} 分</strong><span>{item.credits_before} → {item.credits_after} · {new Date(item.created_at).toLocaleString("zh-CN")}</span>{item.note && <p>{item.note}</p>}</div></article>)}{detail && !detail.adjustments.length && <p className="history-empty">暂无人工调整记录</p>}<h3>近期 AI 消费</h3>{detail?.usage.map(item => <article key={item.id}><Coins size={14}/><div><strong>-{item.credits} 分 · {item.feature}</strong><span>{item.model} · {new Date(item.created_at).toLocaleString("zh-CN")}</span></div></article>)}{detail && !detail.usage.length && <p className="history-empty">暂无 AI 消费记录</p>}</section>
    </aside></div>}
  </div>;
}

export function mountAdmin() { createRoot(document.getElementById("root")!).render(<AdminApp />); }

