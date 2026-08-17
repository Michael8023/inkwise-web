import { admin, body, json, user } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";

const products = {
  "points-50": { type: "credits", credits: 50, prefix: "SHD50" },
  "points-250": { type: "credits", credits: 250, prefix: "SHD250" },
  "points-500": { type: "credits", credits: 500, prefix: "SHD500" },
  "pro-month": { type: "pro_month", durationDays: 30, prefix: "SHDPRO" },
} as const;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalize(code: string) { return code.trim().toUpperCase().replace(/\s+/g, ""); }
async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function issue(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  return `${prefix}-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}
async function requireAdmin(req: Request) {
  const current = await user(req); const db = admin();
  const { data, error } = await db.from("admin_users").select("user_id").eq("user_id", current.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("ADMIN_REQUIRED");
  return { current, db };
}
function status(error: unknown) {
  const message = error instanceof Error ? error.message : "REDEMPTION_FAILED";
  if (message === "AUTH_REQUIRED") return 401;
  if (message === "ADMIN_REQUIRED") return 403;
  if (message === "REDEMPTION_CODE_INVALID" || message === "REDEMPTION_CODE_REDEEMED") return 400;
  return 400;
}

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("history") === "1") {
        const current = await user(req);
        const { data, error } = await admin().from("redemption_codes")
          .select("product_code,product_type,credits,duration_days,redeemed_at")
          .eq("redeemed_by", current.id).not("redeemed_at", "is", null)
          .order("redeemed_at", { ascending: false }).limit(100);
        if (error) throw error;
        return json({ redemptions: data || [] });
      }
      if (url.searchParams.get("admin") !== "1") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      const { db } = await requireAdmin(req);
      const { data, error } = await db.from("redemption_codes").select("batch_label,product_code,product_type,credits,duration_days,created_at,redeemed_at").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      const batches = new Map<string, { label: string; productCode: string; createdAt: string; total: number; redeemed: number }>();
      for (const row of data || []) { const key = `${row.batch_label}|${row.product_code}|${row.created_at.slice(0, 16)}`; const batch = batches.get(key) || { label: row.batch_label, productCode: row.product_code, createdAt: row.created_at, total: 0, redeemed: 0 }; batch.total++; if (row.redeemed_at) batch.redeemed++; batches.set(key, batch); }
      return json({ batches: [...batches.values()] });
    }
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const input = await body(req);
    if (input.action === "redeem") {
      const current = await user(req); const code = normalize(String(input.code || ""));
      if (!/^(SHD50|SHD250|SHD500|SHDPRO)-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(code)) throw new Error("REDEMPTION_CODE_INVALID");
      const { data, error } = await admin().rpc("redeem_redemption_code", { p_user_id: current.id, p_code_hash: await hash(code) });
      if (error) throw new Error(error.message);
      return json({ redemption: data });
    }
    if (input.action !== "generate") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const { current, db } = await requireAdmin(req); const productCode = String(input.productCode || "") as keyof typeof products;
    const count = Number(input.count); const batchLabel = String(input.batchLabel || "").trim().slice(0, 80);
    const product = products[productCode];
    if (!product || !Number.isSafeInteger(count) || count < 1 || count > 5000) throw new Error("INVALID_REDEMPTION_BATCH");
    const codes = Array.from({ length: count }, () => issue(product.prefix));
    const hashes = await Promise.all(codes.map(hash));
    const rows = hashes.map(codeHash => ({ code_hash: codeHash, product_code: productCode, product_type: product.type, credits: "credits" in product ? product.credits : null, duration_days: "durationDays" in product ? product.durationDays : null, batch_label: batchLabel || `${productCode}-${new Date().toISOString().slice(0, 10)}`, created_by: current.id }));
    const { error } = await db.from("redemption_codes").insert(rows); if (error) throw error;
    return json({ codes, productCode, count: codes.length, batchLabel: rows[0].batch_label });
  } catch (error) { const message = error instanceof Error ? error.message : "REDEMPTION_FAILED"; console.error("Redemption codes failed", message); return json({ error: message }, status(error)); }
});
