const maxUploadBytes = 15 * 1024 * 1024;
const mineruOssHost = "mineru.oss-cn-shanghai.aliyuncs.com";

function badRequest(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type StaticAssets = { fetch(request: Request): Promise<Response> };

export default {
  async fetch(request: Request, env: { ASSETS: StaticAssets }) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/api/mineru-upload") return env.ASSETS.fetch(request);
    if (request.method !== "PUT") return badRequest("METHOD_NOT_ALLOWED", 405);

    const target = requestUrl.searchParams.get("target");
    if (!target) return badRequest("MINERU_UPLOAD_URL_REQUIRED");
    let uploadUrl: URL;
    try { uploadUrl = new URL(target); } catch { return badRequest("MINERU_UPLOAD_URL_INVALID"); }
    if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== mineruOssHost || !uploadUrl.pathname.startsWith("/api-upload/extract/")) {
      return badRequest("MINERU_UPLOAD_TARGET_REJECTED", 403);
    }
    const length = Number(request.headers.get("content-length") || 0);
    if (length > maxUploadBytes) return badRequest("MINERU_FILE_TOO_LARGE", 413);

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
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 180) : "unknown network error";
      return badRequest(`MINERU_UPLOAD_NETWORK_FAILED: ${detail}`, 502);
    }
  },
};
