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

    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: request.body,
        headers: { "Content-Type": "application/pdf" },
      });
      if (!response.ok) return badRequest(`MINERU_UPLOAD_FAILED_${response.status}`, 502);
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch {
      return badRequest("MINERU_UPLOAD_NETWORK_FAILED", 502);
    }
  },
};
