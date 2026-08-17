import { admin, body, env, json, user } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";

function pemBytes(value: string) { const raw = value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, ""); const binary = atob(raw); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function encoded(params: Record<string, string>) { return Object.entries(params).filter(([, value]) => value !== "" && value != null).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&"); }
async function sign(params: Record<string, string>) { const key = await crypto.subtle.importKey("pkcs8", pemBytes(env("ALIPAY_PRIVATE_KEY")), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(encoded(params))); return btoa(String.fromCharCode(...new Uint8Array(signature))); }
function amount(cents: number) { return (cents / 100).toFixed(2); }

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  try {
    const currentUser = await user(req); const db = admin();
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("history") === "1") {
        const { data, error } = await db.from("payment_orders")
          .select("out_trade_no,product_name,product_type,credits,amount_cents,status,paid_at,created_at")
          .eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        return json({ orders: data || [] });
      }
      const orderNo = url.searchParams.get("outTradeNo") || "";
      const { data, error } = await db.from("payment_orders").select("out_trade_no,status,credits,amount_cents,product_type,duration_days,paid_at").eq("out_trade_no", orderNo).eq("user_id", currentUser.id).maybeSingle();
      if (error || !data) throw new Error("ORDER_NOT_FOUND"); return json({ order: data });
    }
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const productCode = String((await body(req)).productCode || "");
    const { data: product, error: productError } = await db.from("payment_products").select("code,name,credits,amount_cents,product_type,duration_days").eq("code", productCode).eq("active", true).maybeSingle();
    if (productError || !product) throw new Error("PRODUCT_NOT_FOUND");
    const outTradeNo = `SHD${Date.now()}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`.slice(0, 64);
    const { error: insertError } = await db.from("payment_orders").insert({ out_trade_no: outTradeNo, user_id: currentUser.id, product_code: product.code, product_name: product.name, credits: product.credits, amount_cents: product.amount_cents, product_type: product.product_type, duration_days: product.duration_days });
    if (insertError) throw insertError;
    const params: Record<string, string> = { app_id: env("ALIPAY_APP_ID"), method: "alipay.trade.page.pay", format: "JSON", charset: "utf-8", sign_type: "RSA2", timestamp: new Date().toISOString().replace("T", " ").slice(0, 19), version: "1.0", notify_url: env("ALIPAY_NOTIFY_URL"), return_url: env("ALIPAY_RETURN_URL"), biz_content: JSON.stringify({ out_trade_no: outTradeNo, product_code: "FAST_INSTANT_TRADE_PAY", total_amount: amount(product.amount_cents), subject: product.name }) };
    params.sign = await sign(params);
    const gateway = (Deno.env.get("ALIPAY_GATEWAY_URL") || "https://openapi-sandbox.dl.alipaydev.com/gateway.do").replace(/\?$/, "");
    return json({ outTradeNo, paymentUrl: `${gateway}?${new URLSearchParams(params).toString()}` });
  } catch (error) { const message = error instanceof Error ? error.message : "PAYMENT_REQUEST_FAILED"; console.error("Alipay order failed", message); return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 400); }
});
