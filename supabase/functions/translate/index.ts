import { preflight } from "../_shared/cors.ts";
import { admin, body, env, json, rateLimit, user } from "../_shared/core.ts";

async function anonymousRateLimit(req: Request) {
  const source = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const rateKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await admin().rpc("check_anonymous_rate_limit", {
    p_rate_key: rateKey,
    p_feature: "translate",
    p_limit: 10,
  });
  if (error) throw error;
  if (!data) throw new Error("RATE_LIMITED");
}

Deno.serve(async req => {
  const cors = preflight(req);
  if (cors) return cors;
  try {
    // Signed-in users retain the existing, more generous per-account limit.
    try {
      const currentUser = await user(req);
      await rateLimit(currentUser.id, "translate", 30);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "AUTH_REQUIRED") throw error;
      await anonymousRateLimit(req);
    }

    const input = await body(req);
    const text = String(input.text || "");
    if (!text || text.length > 5000) throw new Error("TEXT_TOO_LONG");
    const tokenResponse = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(env("BAIDU_TRANSLATE_API_KEY"))}&client_secret=${encodeURIComponent(env("BAIDU_TRANSLATE_SECRET_KEY"))}`);
    const token = await tokenResponse.json();
    if (!token.access_token) throw new Error("BAIDU_AUTH_FAILED");
    const response = await fetch(`https://aip.baidubce.com/rpc/2.0/mt/texttrans/v1?access_token=${encodeURIComponent(token.access_token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, from: String(input.sourceLanguage || "auto"), to: String(input.targetLanguage || "zh") }),
    });
    const payload = await response.json();
    const translated = payload.result?.trans_result?.map((item: { dst: string }) => item.dst).join("\n");
    if (!response.ok || !translated) throw new Error("BAIDU_TRANSLATION_UNAVAILABLE");
    return json({ translatedText: translated, sourceLanguage: payload.result?.from, targetLanguage: payload.result?.to, provider: "baidu" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TRANSLATION_FAILED";
    return json({ error: message }, message === "RATE_LIMITED" ? 429 : 400);
  }
});
