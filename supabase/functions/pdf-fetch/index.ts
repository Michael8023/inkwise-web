import { corsHeaders, preflight } from "../_shared/cors.ts";
import { body, rateLimit, user } from "../_shared/core.ts";

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function unsafeAddress(host: string) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) return true;
  if (value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}
function target(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || unsafeAddress(url.hostname)) throw new Error("URL_NOT_ALLOWED");
  return url;
}
async function assertPublicDns(url: URL) {
  // Reject DNS rebinding targets as well as literal private addresses.
  const records = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const addresses = records.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!addresses.length || addresses.some((address) => unsafeAddress(address))) throw new Error("URL_NOT_ALLOWED");
}

Deno.serve(async (req) => {
  const p = preflight(req); if (p) return p;
  try {
    if (req.method !== "POST") throw new Error("METHOD_NOT_ALLOWED");
    const account = await user(req);
    await rateLimit(account.id, "pdf_fetch", 8);
    let current = target(String((await body(req)).url || ""));
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertPublicDns(current);
      response = await fetch(current, { redirect: "manual", headers: { Accept: "application/pdf" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
      current = target(new URL(location, current).toString());
    }
    if (!response?.ok) throw new Error(`PDF_UPSTREAM_${response?.status || 502}`);
    const size = Number(response.headers.get("content-length") || 0);
    const type = response.headers.get("content-type") || "";
    if (size > MAX_BYTES) throw new Error("PDF_TOO_LARGE");
    if (type && !type.toLowerCase().includes("pdf")) throw new Error("NOT_A_PDF");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("NOT_A_PDF");
    return new Response(bytes, { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength), "Content-Disposition": response.headers.get("content-disposition") || "" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF_URL_FETCH_FAILED";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
