import { admin, env } from "../_shared/core.ts";

function pemBytes(value: string) { const raw = value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, ""); const binary = atob(raw); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function canonical(params: Record<string, string>) { return Object.entries(params).filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "" && value != null).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&"); }
async function verify(params: Record<string, string>) { const signature = params.sign || ""; if (!signature || params.sign_type !== "RSA2") return false; const key = await crypto.subtle.importKey("spki", pemBytes(env("ALIPAY_PUBLIC_KEY")), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]); const bytes = Uint8Array.from(atob(signature), char => char.charCodeAt(0)); return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes, new TextEncoder().encode(canonical(params))); }

Deno.serve(async req => {
  if (req.method !== "POST") return new Response("failure", { status: 405 });
  try {
    const raw = await req.text(); const form = new URLSearchParams(raw); const params = Object.fromEntries(form.entries());
    if (params.app_id !== env("ALIPAY_APP_ID") || !await verify(params)) throw new Error("SIGNATURE_INVALID");
    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status || "")) return new Response("success");
    const tradeNo = params.trade_no || ""; const orderNo = params.out_trade_no || ""; const totalAmount = Number(params.total_amount);
    if (!tradeNo || !orderNo || !Number.isFinite(totalAmount)) throw new Error("PAYLOAD_INVALID");
    const { error } = await admin().rpc("complete_alipay_order", { p_out_trade_no: orderNo, p_alipay_trade_no: tradeNo, p_total_amount: totalAmount, p_payload: params });
    if (error) throw error;
    return new Response("success");
  } catch (error) { console.error("Alipay notification failed", error instanceof Error ? error.message : "UNKNOWN"); return new Response("failure", { status: 400 }); }
});
