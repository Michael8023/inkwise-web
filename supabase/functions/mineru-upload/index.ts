import { env, json, user } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";

const maxBytes = 15 * 1024 * 1024;

function headers() {
  return { Authorization: `Bearer ${env("MINERU_API_TOKEN")}`, "Content-Type": "application/json", Accept: "application/json" };
}

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  try {
    await user(req);
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const declaredSize = Number(req.headers.get("content-length") || 0);
    if (declaredSize > maxBytes) throw new Error("MINERU_FILE_TOO_LARGE");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw new Error("MINERU_FILE_TOO_LARGE");
    const encodedName = req.headers.get("x-file-name") || "document.pdf";
    let decodedName = encodedName;
    try { decodedName = decodeURIComponent(encodedName); } catch { /* Keep a malformed header value safe. */ }
    const name = decodedName.replace(/[^\w.\-() ]/g, "_").slice(0, 120);
    if (!name.toLowerCase().endsWith(".pdf")) throw new Error("PDF_REQUIRED");
    const preparedResponse = await fetch("https://mineru.net/api/v4/file-urls/batch", { method: "POST", headers: headers(), body: JSON.stringify({ files: [{ name, data_id: crypto.randomUUID() }], model_version: "vlm" }) });
    const prepared = await preparedResponse.json();
    if (!preparedResponse.ok || prepared?.code !== 0 || !prepared?.data?.file_urls?.[0]) throw new Error(String(prepared?.msg || "MINERU_PREPARE_FAILED"));
    const uploadResponse = await fetch(prepared.data.file_urls[0], { method: "PUT", body: bytes });
    if (!uploadResponse.ok) throw new Error(`MINERU_UPLOAD_FAILED_${uploadResponse.status}`);
    return json({ batchId: prepared.data.batch_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MINERU_UPLOAD_FAILED";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "MINERU_FILE_TOO_LARGE" ? 413 : message.includes("MINERU_API_TOKEN_NOT_CONFIGURED") ? 503 : 400;
    return json({ error: message }, status);
  }
});
