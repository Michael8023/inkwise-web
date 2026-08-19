const freeUploadBytes = 15 * 1024 * 1024;
const proUploadBytes = 50 * 1024 * 1024;
const mineruOssHost = "mineru.oss-cn-shanghai.aliyuncs.com";
const uploadCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

function badRequest(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...uploadCorsHeaders },
  });
}

type StaticAssets = { fetch(request: Request): Promise<Response> };
type Env = { ASSETS: StaticAssets; SUPABASE_URL: string; SUPABASE_ANON_KEY: string };

async function uploadLimit(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return 0;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/user_entitlements?select=period_end,status,plans(name)`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization },
  });
  if (!response.ok) return 0;
  const rows = await response.json() as Array<{ period_end?: string; status?: string; plans?: { name?: string } | Array<{ name?: string }> }>;
  const entitlement = rows[0];
  const plan = Array.isArray(entitlement?.plans) ? entitlement.plans[0]?.name : entitlement?.plans?.name;
  return plan === "pro" && entitlement?.status === "active" && new Date(entitlement.period_end || 0) > new Date() ? proUploadBytes : freeUploadBytes;
}

export default {
  async fetch(request: Request, env: Env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/api/mineru-upload") return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: uploadCorsHeaders });
    if (request.method !== "PUT") return badRequest("METHOD_NOT_ALLOWED", 405);

    const target = requestUrl.searchParams.get("target");
    if (!target) return badRequest("MINERU_UPLOAD_URL_REQUIRED");
    let uploadUrl: URL;
    try { uploadUrl = new URL(target); } catch { return badRequest("MINERU_UPLOAD_URL_INVALID"); }
    if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== mineruOssHost || !uploadUrl.pathname.startsWith("/api-upload/extract/")) {
      return badRequest("MINERU_UPLOAD_TARGET_REJECTED", 403);
    }
    const limit = await uploadLimit(request, env);
    if (!limit) return badRequest("AUTH_REQUIRED", 401);
    const length = Number(request.headers.get("content-length") || 0);
    if (!Number.isFinite(length) || length < 1 || length > limit) return badRequest("MINERU_FILE_TOO_LARGE", 413);

    const encodedHeaders = requestUrl.searchParams.get("headers") || "";
    let signedHeaders: Record<string, string> = {};
    try {
      const parsed = JSON.parse(atob(encodedHeaders));
      if (parsed && typeof parsed === "object") {
        signedHeaders = Object.fromEntries(
          Object.entries(parsed)
            .filter(([key, value]) => /^x-oss-|^content-type$/i.test(key) && typeof value === "string")
            .map(([key, value]) => [key, String(value)]),
        );
      }
    } catch { return badRequest("MINERU_UPLOAD_HEADERS_INVALID"); }

    try {
      // Preserve the signed request shape. MinerU's OSS URL does not sign a
      // Content-Type header, so adding one here can invalidate the signature.
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: request.body,
        headers: signedHeaders,
      });
      if (!response.ok) {
        const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
        return badRequest(`MINERU_UPLOAD_UPSTREAM_${response.status}${detail ? `: ${detail}` : ""}`, 502);
      }
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...uploadCorsHeaders } });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 180) : "unknown network error";
      return badRequest(`MINERU_UPLOAD_NETWORK_FAILED: ${detail}`, 502);
    }
  },
};
