import { body, json, rateLimit, user } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";

type Action = "templates" | "generate" | "download";

function clean(value: unknown, limit: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
}

async function docmeeToken(uid: string) {
  const apiKey = Deno.env.get("DOCMEE_API_KEY");
  if (!apiKey) throw new Error("DOCMEE_NOT_CONFIGURED");
  const response = await fetch("https://docmee.cn/api/user/createApiToken", {
    method: "POST",
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ uid: `pdf-ai-reader:${uid}` }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Number(payload?.code) !== 0 || !payload?.data?.token) {
    throw new Error(`DOCMEE_TOKEN_FAILED${payload?.message ? `:${payload.message}` : ""}`);
  }
  return String(payload.data.token);
}

async function docmeeRequest(token: string, path: string, value: unknown) {
  const response = await fetch(`https://docmee.cn${path}`, {
    method: "POST",
    headers: { token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(value),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Number(payload?.code) !== 0) {
    throw new Error(`DOCMEE_REQUEST_FAILED${payload?.message ? `:${payload.message}` : `_${response.status}`}`);
  }
  return payload?.data || {};
}

function templateList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (!value || typeof value !== "object") return [];
  const result = value as Record<string, unknown>;
  for (const key of ["list", "records", "templates", "items"]) {
    if (Array.isArray(result[key])) return result[key].filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  return [];
}

/** Pure API integration: no Docmee UI or client-side credential is required. */
Deno.serve(async (req) => {
  const cors = preflight(req); if (cors) return cors;
  try {
    const currentUser = await user(req);
    await rateLimit(currentUser.id, "docmee_ppt", 12);
    const input = await body(req);
    const action = clean(input.action, 20) as Action;
    if (!(["templates", "generate", "download"] as string[]).includes(action)) throw new Error("DOCMEE_ACTION_INVALID");
    const token = await docmeeToken(currentUser.id);

    if (action === "templates") {
      const templates = await docmeeRequest(token, "/api/ppt/randomTemplates", { size: 8, filters: { type: 1 } });
      return json({ templates: templateList(templates).map((item) => ({
        id: clean(item.id, 160), name: clean(item.name || item.title || "学术模板", 160),
        coverUrl: clean(item.coverUrl || item.cover || item.cover_url, 2000) || undefined,
      })).filter((item: { id: string }) => item.id) });
    }

    if (action === "generate") {
      const markdown = clean(input.markdown, 20_000);
      const templateId = clean(input.templateId, 160);
      if (!markdown) throw new Error("PPT_MARKDOWN_REQUIRED");
      const pptInfo = await docmeeRequest(token, "/api/ppt/generatePptx", { templateId: templateId || undefined, outlineContentMarkdown: markdown, pptxProperty: false });
      const id = clean(typeof pptInfo === "string" ? pptInfo : pptInfo.id || pptInfo.pptId, 160);
      if (!id) throw new Error("DOCMEE_PPT_ID_MISSING");
      return json({ pptId: id, name: clean(typeof pptInfo === "object" ? pptInfo.name : "", 300) || undefined });
    }

    const id = clean(input.pptId, 160);
    if (!id) throw new Error("PPT_ID_REQUIRED");
    const pptInfo = await docmeeRequest(token, "/api/ppt/downloadPptx", { id });
    return json({ pptId: id, fileUrl: clean(typeof pptInfo === "string" ? pptInfo : pptInfo.fileUrl || pptInfo.file_url || pptInfo.url, 2000) || undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCMEE_REQUEST_FAILED";
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 400);
  }
});
