import { preflight } from "../_shared/cors.ts";
import { body, json, rateLimit, user } from "../_shared/core.ts";

/**
 * Issues a short-lived Docmee user token for the UI SDK.
 *
 * The Docmee Api-Key deliberately never reaches the browser.  A stable,
 * namespaced uid means that a user's documents and custom templates remain
 * isolated from all other users in the Docmee workspace.
 */
Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const currentUser = await user(req);
    await rateLimit(currentUser.id, "docmee_ui_token", 20);
    const input = await body(req);
    if (String(input.action || "") !== "createToken") {
      throw new Error("DOCMEE_ACTION_INVALID");
    }

    const apiKey = Deno.env.get("DOCMEE_API_KEY");
    if (!apiKey) throw new Error("DOCMEE_NOT_CONFIGURED");

    const response = await fetch("https://docmee.cn/api/user/createApiToken", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ uid: `pdf-ai-reader:${currentUser.id}` }),
    });
    const payload = await response.json().catch(() => ({})) as {
      code?: number;
      message?: string;
      data?: { token?: string; expireTime?: number };
    };
    if (!response.ok || payload.code !== 0 || !payload.data?.token) {
      throw new Error(`DOCMEE_TOKEN_FAILED${payload.message ? `:${payload.message}` : ""}`);
    }

    return json({ token: payload.data.token, expireTime: payload.data.expireTime });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCMEE_TOKEN_FAILED";
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 400);
  }
});
