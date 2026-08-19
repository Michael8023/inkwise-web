import { corsHeaders, preflight } from "../_shared/cors.ts";
import { admin, body, json, rateLimit, refund, settle, user } from "../_shared/core.ts";

type Action = "direct" | "outline" | "content" | "markdown" | "status" | "download";

const paths: Record<Action, string> = {
  // Apilio aggregates DocMee-compatible routes under the same API base and key
  // used by the rest of this application. Only exceptional path differences need
  // an override.
  direct: Deno.env.get("DOCMEE_DIRECT_GENERATE_PATH") || "/docmee/v1/api/ppt/directGeneratePptx",
  outline: "/docmee/v1/api/ppt/generateOutline",
  content: "/docmee/v1/api/ppt/generateContent",
  markdown: Deno.env.get("DOCMEE_GENERATE_PPTX_PATH") || "/docmee/v1/api/ppt/generatePptx",
  status: "/docmee/v1/api/ppt/asyncPptInfo",
  download: "/docmee/v1/api/ppt/downloadPptx",
};

function clean(value: unknown, limit: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function urlFor(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function responseData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const root = value as Record<string, unknown>;
  return (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
}

function pptIdFromEvent(raw: string) {
  const data = raw.split(/\r?\n/).find(line => line.startsWith("data:"))?.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    const nested = responseData(payload);
    return clean(payload.pptId || payload.ppt_id || nested.pptId || nested.ppt_id || nested.id, 300);
  } catch { return ""; }
}

function trackedStream(upstream: Response, userId: string, billingRequestId: string) {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "", upstreamPptId = "", outputChars = 0, jobSaved = false;
  const saveJob = async () => {
    if (!upstreamPptId || jobSaved) return;
    const { error } = await admin().from("ppt_jobs").upsert({
      user_id: userId, billing_request_id: billingRequestId, upstream_ppt_id: upstreamPptId,
      status: "generating", updated_at: new Date().toISOString(),
    }, { onConflict: "upstream_ppt_id" });
    if (error) throw error;
    jobSaved = true;
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            controller.enqueue(value);
            const text = decoder.decode(value, { stream: true });
            outputChars += text.length;
            buffer += text;
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || "";
            for (const event of events) {
              upstreamPptId ||= pptIdFromEvent(event);
              await saveJob();
            }
          }
        }
        if (buffer) upstreamPptId ||= pptIdFromEvent(buffer);
        if (!upstreamPptId) throw new Error("PPT_TASK_ID_MISSING");
        await saveJob();
        await settle(billingRequestId, outputChars);
        controller.close();
      } catch (error) {
        await refund(billingRequestId, error instanceof Error ? error.message : "PPT_STREAM_FAILED");
        controller.error(error);
      }
    },
    async cancel() {
      await reader.cancel();
      await refund(billingRequestId, "PPT_STREAM_CANCELLED");
    },
  });
}

function upstreamRequest(action: Action, request: Record<string, unknown>) {
  // DocMee's public schema intentionally stays small. Do not forward UI-only
  // fields such as `prompt`, `content`, or `stream`, which its router rejects.
  if (action === "outline" || action === "direct") return { subject: clean(request.subject, 60000) };
  if (action === "content") return { outlineMarkdown: clean(request.outlineMarkdown, 100000), asyncGenPptx: Boolean(request.asyncGenPptx) };
  if (action === "markdown") return { markdown: clean(request.markdown, 100000) };
  if (action === "download") return { id: clean(request.id, 300) };
  return request;
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req); if (preflightResponse) return preflightResponse;
  try {
    const currentUser = await user(req);
    const input = await body(req);
    const action = clean(input.action, 20) as Action;
    if (!Object.hasOwn(paths, action)) throw new Error("PPT_ACTION_INVALID");
    const request = input.request && typeof input.request === "object" ? input.request as Record<string, unknown> : {};
    const isPptTaskStart = action === "content" && Boolean(request.asyncGenPptx);
    // Only generation requests consume the short request window. Status polling
    // and the final download are part of the same job and must remain callable.
    if (action === "outline" || action === "content" || action === "direct" || action === "markdown") {
      await rateLimit(currentUser.id, "ai_ppt", 10);
    }
    const billingRequestId = clean(request.billingRequestId, 160);
    if (isPptTaskStart && !billingRequestId) throw new Error("PPT_BILLING_REQUEST_REQUIRED");
    if (isPptTaskStart) {
      const { data: quota, error: quotaError } = await admin().rpc("consume_ai_ppt_quota", {
        p_user_id: currentUser.id,
        p_request_id: billingRequestId,
        p_input_chars: clean(request.outlineMarkdown, 100000).length,
      });
      if (quotaError) throw quotaError;
      if (!quota?.ok) throw new Error(String(quota?.error || "PPT_QUOTA_EXCEEDED"));
    }
    // Chat-completions uses APILIO_BASE_URL ending in /v1, while DocMee is
    // mounted at the Apilio root as /docmee/v1/… . Normalize both deployments.
    const configuredBaseUrl = (Deno.env.get("APILIO_BASE_URL") || "https://api.apilio.ai/v1").replace(/\/+$/, "");
    const baseUrl = configuredBaseUrl.replace(/\/v1$/, "");
    const apiKey = Deno.env.get("APILIO_API_KEY");
    if (!apiKey) throw new Error("APILIO_NOT_CONFIGURED");
    const wantsStream = Boolean(request.stream) && (action === "outline" || action === "content");
    let upstreamTaskId = "";
    if (action === "status" || action === "download") {
      const suppliedId = clean(action === "status" ? request.pptId : request.id, 300);
      if (!suppliedId) throw new Error("PPT_TASK_ID_REQUIRED");
      const { data: job, error } = await admin().from("ppt_jobs").select("upstream_ppt_id")
        .eq("user_id", currentUser.id).eq("upstream_ppt_id", suppliedId).maybeSingle();
      if (error || !job) throw new Error("PPT_TASK_NOT_FOUND");
      upstreamTaskId = job.upstream_ppt_id;
    }
    const target = action === "status"
      ? `${urlFor(baseUrl, paths[action])}?pptId=${encodeURIComponent(upstreamTaskId)}`
      : urlFor(baseUrl, paths[action]);
    const upstream = await fetch(target, {
      method: action === "status" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "Accept": wantsStream ? "text/event-stream" : "application/json" },
      body: action === "status" ? undefined : JSON.stringify(upstreamRequest(action, request)),
    });
    if (!upstream.ok) {
      const detail = clean(await upstream.text(), 500);
      if (isPptTaskStart) await refund(billingRequestId, `DOCMEE_UPSTREAM_${upstream.status}`);
      throw new Error(`DOCMEE_UPSTREAM_${upstream.status}${detail ? `:${detail}` : ""}`);
    }
    if (wantsStream && upstream.body) {
      const body = isPptTaskStart ? trackedStream(upstream, currentUser.id, billingRequestId) : upstream.body;
      return new Response(body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    const payload = await upstream.json().catch(() => ({}));
    const data = responseData(payload);
    if (upstreamTaskId && (action === "status" || action === "download")) {
      await admin().from("ppt_jobs").update({
        status: data.fileUrl || data.file_url || data.downloadUrl || data.url ? "completed" : "generating",
        file_url: clean(data.fileUrl || data.file_url || data.downloadUrl || data.url, 2000) || null,
        updated_at: new Date().toISOString(),
      }).eq("user_id", currentUser.id).eq("upstream_ppt_id", upstreamTaskId);
    }
    return json({
      data: payload,
      fileUrl: clean(data.fileUrl || data.file_url || data.downloadUrl || data.url, 2000) || undefined,
      pptId: clean(data.pptId || data.ppt_id || data.id, 300) || undefined,
      progress: Number(data.progress || data.percent || 0) || undefined,
      status: clean(data.status || data.state, 100) || undefined,
      total: Number(data.total || 0) || undefined,
      current: Number(data.current || 0) || undefined,
      pptxProperty: clean(data.pptxProperty, 4_000_000) || undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_PPT_FAILED";
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 400);
  }
});
