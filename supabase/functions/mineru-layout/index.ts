import { body, env, json, user } from "../_shared/core.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";

const baseUrl = "https://mineru.net/api/v4";

function headers() {
  return {
    Authorization: `Bearer ${env("MINERU_API_TOKEN")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function upstreamError(payload: any, fallback: string) {
  return String(payload?.msg || payload?.message || payload?.error || fallback).slice(0, 300);
}

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  try {
    await user(req);
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const input = await body(req);
    const action = String(input.action || "");
    if (action === "prepare") {
      const name = String(input.name || "document.pdf").replace(/[^\w.\-() ]/g, "_").slice(0, 120);
      if (!name.toLowerCase().endsWith(".pdf")) throw new Error("PDF_REQUIRED");
      const response = await fetch(`${baseUrl}/file-urls/batch`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ files: [{ name, data_id: crypto.randomUUID() }], model_version: "vlm" }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.code !== 0 || !payload?.data?.file_urls?.[0]) throw new Error(upstreamError(payload, "MINERU_PREPARE_FAILED"));
      return json({
        batchId: payload.data.batch_id,
        uploadUrl: payload.data.file_urls[0],
        // MinerU currently returns a presigned URL without extra headers. Keep
        // this explicit so the browser/Worker never guesses signed headers.
        uploadHeaders: payload.data.upload_headers || {},
      });
    }
    if (action === "status") {
      const batchId = String(input.batchId || "");
      if (!/^[\w-]{8,120}$/.test(batchId)) throw new Error("MINERU_TASK_INVALID");
      const response = await fetch(`${baseUrl}/extract-results/batch/${encodeURIComponent(batchId)}`, { headers: headers() });
      const payload = await response.json();
      if (!response.ok || payload?.code !== 0) throw new Error(upstreamError(payload, "MINERU_STATUS_FAILED"));
      const result = Array.isArray(payload?.data?.extract_result) ? payload.data.extract_result[0] : payload?.data?.extract_result || payload?.data;
      return json({ state: result?.state || "pending", progress: result?.extract_progress || null, ready: Boolean(result?.full_zip_url), error: result?.err_msg || null });
    }
    if (action === "download") {
      const batchId = String(input.batchId || "");
      if (!/^[\w-]{8,120}$/.test(batchId)) throw new Error("MINERU_TASK_INVALID");
      const statusResponse = await fetch(`${baseUrl}/extract-results/batch/${encodeURIComponent(batchId)}`, { headers: headers() });
      const statusPayload = await statusResponse.json();
      if (!statusResponse.ok || statusPayload?.code !== 0) throw new Error(upstreamError(statusPayload, "MINERU_STATUS_FAILED"));
      const result = Array.isArray(statusPayload?.data?.extract_result) ? statusPayload.data.extract_result[0] : statusPayload?.data?.extract_result || statusPayload?.data;
      const zipUrl = result?.full_zip_url;
      if (result?.state !== "done" || !zipUrl) throw new Error(result?.err_msg || "MINERU_RESULT_NOT_READY");
      const zipResponse = await fetch(zipUrl);
      if (!zipResponse.ok) throw new Error(`MINERU_RESULT_DOWNLOAD_FAILED_${zipResponse.status}`);
      const zip = await zipResponse.arrayBuffer();
      if (!zip.byteLength || zip.byteLength > 50 * 1024 * 1024) throw new Error("MINERU_RESULT_INVALID");
      return new Response(zip, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/zip",
          "Cache-Control": "no-store",
        },
      });
    }
    throw new Error("MINERU_ACTION_INVALID");
  } catch (error) {
    const message = error instanceof Error ? error.message : "MINERU_REQUEST_FAILED";
    const status = message === "AUTH_REQUIRED" ? 401 : message.includes("MINERU_API_TOKEN_NOT_CONFIGURED") ? 503 : 400;
    return json({ error: message }, status);
  }
});
