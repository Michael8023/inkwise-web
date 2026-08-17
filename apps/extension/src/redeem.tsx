import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, ArrowLeft } from "lucide-react";
import { functionRequest, supabase } from "./api";
import "./redeem.css";

const messages: Record<string, string> = {
  AUTH_REQUIRED: "请先登录识谛账户后再兑换。",
  REDEMPTION_CODE_INVALID: "兑换码无效，请检查是否完整复制。",
  REDEMPTION_CODE_REDEEMED: "该兑换码已被使用，不能重复兑换。",
};

export function RedeemPage() {
  const [ready, setReady] = useState(false), [loggedIn, setLoggedIn] = useState(false), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [success, setSuccess] = useState(false);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { setLoggedIn(Boolean(data.session)); setReady(true); }); }, []);
  async function redeem(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setSuccess(false);
    try {
      const response = await functionRequest("redemption-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "redeem", code }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "REDEMPTION_FAILED");
      const item = result.redemption; setSuccess(true); setCode(""); setMessage(item.productType === "pro_month" ? `Pro 已开通，有效期至 ${new Date(item.periodEnd).toLocaleDateString("zh-CN")}。` : `${item.credits} 积分已到账，当前可用 ${item.creditsRemaining} 积分。`);
    } catch (error) { const key = error instanceof Error ? error.message : ""; setMessage(messages[key] || "兑换失败，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <main className="redeem-page"><a className="redeem-back" href="/"><ArrowLeft size={16}/>返回识谛</a><section className="redeem-card"><div className="redeem-icon"><KeyRound size={25}/></div><p>SHIDEA / REDEEM</p><h1>兑换你的权益</h1><span>输入购买后获得的卡密，积分或 Pro 权益将自动到账。</span>{!ready ? <div className="redeem-loading"><LoaderCircle size={17}/>正在检查登录状态…</div> : !loggedIn ? <a className="redeem-login" href="/?account=1">登录后兑换</a> : <form onSubmit={redeem}><label>兑换码<input autoFocus value={code} maxLength={32} placeholder="SHD50-XXXX-XXXX-XXXX-XXXX" onChange={event => setCode(event.target.value.toUpperCase().replace(/\s/g, ""))}/></label><button disabled={busy || !code.trim()}>{busy ? <><LoaderCircle className="redeem-spin" size={16}/>正在兑换…</> : "确认兑换"}</button></form>}{message && <div className={success ? "redeem-message success" : "redeem-message"}>{success && <CheckCircle2 size={16}/>} {message}</div>}<small>兑换码一经使用不可撤销。若有问题，请通过识谛反馈页面联系我们。</small></section></main>;
}
