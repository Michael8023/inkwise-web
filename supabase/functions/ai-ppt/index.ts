import { corsHeaders, preflight } from "../_shared/cors.ts";
import { admin, body, json, rateLimit, refund_credits, user } from "../_shared/core.ts";

type Action = "outline" | "content" | "status" | "download";

const paths: Record<Action, string> = {
  outline: "/docmee/v1/api/ppt/generateOutline",
  content: "/docmee/v1/api/ppt/generateContent",
  status: "/docmee/v1/api/ppt/asyncPptInfo",
  download: "/docmee/v1/api/ppt/downloadPptx",
};

function clean(value: unknown, limit: number) { return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit); }
function urlFor(baseUrl: string, path: string) { return `${baseUrl.replace(/\/+$/, "")}${path}`; }
function responseData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const root = value as Record<string, unknown>;
  return (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
}

Deno.serve(async (req) => {
  const cors = preflight(req); if (cors) return cors;
  try {
    const currentUser = await user(req);
    await rateLimit(currentUser.id, "ai_ppt", 10);
    const input = await body(req);
    const action = clean(input.action, 20) as Action;
    if (!Object.hasOwn(paths, action)) throw new Error("PPT_ACTION_INVALID");
    const request = input.request && typeof input.request === "object" ? input.request as Record<string, unknown> : {};
    const startsPptTask = action === "content" && Boolean(request.asyncGenPptx);
    const billingRequestId = clean(request.billingRequestId, 160);
    if (startsPptTask && !billingRequestId) throw new Error("PPT_BILLING_REQUEST_REQUIRED");
    if (startsPptTask) {
      const { data, error } = await admin().rpc("consume_ai_ppt_quota", {
        p_user_id: currentUser.id, p_request_id: billingRequestId,
        p_input_chars: clean(request.outlineMarkdown, 100_000).length,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(String(data?.error || "PPT_QUOTA_EXCEEDED"));
    }

    const configuredBase = (Deno.env.get("APILIO_BASE_URL") || "https://api.apilio.ai/v1").replace(/\/+$/, "");
    const baseUrl = configuredBase.replace(/\/v1$/, "");
    const apiKey = Deno.env.get("APILIO_API_KEY");
    if (!apiKey) throw new Error("APILIO_NOT_CONFIGURED");
    const stream = Boolean(request.stream) && (action === "outline" || action === "content");
    const target = action === "status"
      ? `${urlFor(baseUrl, paths.status)}?pptId=${encodeURIComponent(clean(request.pptId, 300))}`
      : urlFor(baseUrl, paths[action]);
    const upstreamBody = action === "outline" ? { subject: clean(request.subject, 60_000) }
      : action === "content" ? { outlineMarkdown: clean(request.outlineMarkdown, 100_000), asyncGenPptx: startsPptTask }
      : { id: clean(request.id, 300) };
    const upstream = await fetch(target, {
      method: action === "status" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
      body: action === "status" ? undefined : JSON.stringify(upstreamBody),
    });
    if (!upstream.ok) {
      const detail = clean(await upstream.text(), 500);
      if (startsPptTask) await refund_credits(billingRequestId, `APILIO_PPT_${upstream.status}`);
      throw new Error(`APILIO_PPT_${upstream.status}${detail ? `:${detail}` : ""}`);
    }
    if (stream && upstream.body) return new Response(upstream.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    const payload = await upstream.json().catch(() => ({}));
    const data = responseData(payload);
    return json({ data: payload, pptId: clean(data.pptId || data.ppt_id || data.id, 300) || undefined,
      fileUrl: clean(data.fileUrl || data.file_url || data.downloadUrl || data.url, 2_000) || undefined,
      total: Number(data.total || 0) || undefined, current: Number(data.current || 0) || undefined,
      progress: Number(data.progress || data.percent || 0) || undefined, status: clean(data.status || data.state, 100) || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_PPT_FAILED";
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 400);
  }
});
