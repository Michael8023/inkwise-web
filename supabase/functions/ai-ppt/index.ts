import { corsHeaders, preflight } from "../_shared/cors.ts";
import { body, json, rateLimit, user } from "../_shared/core.ts";

type Action = "direct" | "outline" | "content" | "markdown" | "status";

const paths: Record<Action, string> = {
  // Apilio aggregates DocMee-compatible routes under the same API base and key
  // used by the rest of this application. Only exceptional path differences need
  // an override.
  direct: Deno.env.get("DOCMEE_DIRECT_GENERATE_PATH") || "/docmee/v1/api/ppt/directGeneratePptx",
  outline: "/docmee/v1/api/ppt/generateOutline",
  content: "/docmee/v1/api/ppt/generateContent",
  markdown: Deno.env.get("DOCMEE_GENERATE_PPTX_PATH") || "/docmee/v1/api/ppt/generatePptx",
  status: "/docmee/v1/api/ppt/asyncPptInfo",
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

function upstreamRequest(action: Action, request: Record<string, unknown>) {
  // DocMee's public schema intentionally stays small. Do not forward UI-only
  // fields such as `prompt`, `content`, or `stream`, which its router rejects.
  if (action === "outline" || action === "direct") return { subject: clean(request.subject, 60000) };
  if (action === "content") return { outlineMarkdown: clean(request.outlineMarkdown, 100000), asyncGenPptx: Boolean(request.asyncGenPptx) };
  if (action === "markdown") return { markdown: clean(request.markdown, 100000) };
  return request;
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req); if (preflightResponse) return preflightResponse;
  try {
    const currentUser = await user(req);
    await rateLimit(currentUser.id, "ai_ppt", 10);
    const input = await body(req);
    const action = clean(input.action, 20) as Action;
    if (!Object.hasOwn(paths, action)) throw new Error("PPT_ACTION_INVALID");
    const request = input.request && typeof input.request === "object" ? input.request as Record<string, unknown> : {};
    // Chat-completions uses APILIO_BASE_URL ending in /v1, while DocMee is
    // mounted at the Apilio root as /docmee/v1/… . Normalize both deployments.
    const configuredBaseUrl = (Deno.env.get("APILIO_BASE_URL") || "https://api.apilio.ai/v1").replace(/\/+$/, "");
    const baseUrl = configuredBaseUrl.replace(/\/v1$/, "");
    const apiKey = Deno.env.get("APILIO_API_KEY");
    if (!apiKey) throw new Error("APILIO_NOT_CONFIGURED");
    const wantsStream = Boolean(request.stream) && (action === "outline" || action === "content");
    const target = action === "status" && request.pptId
      ? `${urlFor(baseUrl, paths[action])}?pptId=${encodeURIComponent(String(request.pptId))}`
      : urlFor(baseUrl, paths[action]);
    const upstream = await fetch(target, {
      method: action === "status" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "Accept": wantsStream ? "text/event-stream" : "application/json" },
      body: action === "status" ? undefined : JSON.stringify(upstreamRequest(action, request)),
    });
    if (!upstream.ok) {
      const detail = clean(await upstream.text(), 500);
      throw new Error(`DOCMEE_UPSTREAM_${upstream.status}${detail ? `:${detail}` : ""}`);
    }
    if (wantsStream && upstream.body) {
      return new Response(upstream.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    const payload = await upstream.json().catch(() => ({}));
    const data = responseData(payload);
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
