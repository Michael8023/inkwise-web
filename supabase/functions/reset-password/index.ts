import { admin, body, json } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";
import { hashSignupCode, normalizeEmail, signupErrorStatus } from "../_shared/signup.ts";

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const input = await body(req); const email = normalizeEmail(input.email); const code = String(input.code || "").trim(); const password = String(input.password || "");
    if (!/^\d{6}$/.test(code)) throw new Error("CODE_INVALID");
    if (password.length < 8 || password.length > 72) throw new Error("PASSWORD_INVALID");
    const db = admin();
    const { data: claimed, error: claimError } = await db.rpc("claim_password_reset_code", { p_email: email, p_code_hash: await hashSignupCode(email, code) });
    if (claimError) throw claimError;
    if (!claimed?.ok) throw new Error(claimed?.error || "CODE_INVALID");
    const { data: userId, error: userError } = await db.rpc("find_password_reset_user", { p_email: email });
    if (userError || !userId) throw new Error("CODE_INVALID");
    const { error: updateError } = await db.auth.admin.updateUserById(userId, { password });
    if (updateError) throw new Error("PASSWORD_RESET_FAILED");
    return json({ ok: true });
  } catch (error) { const message = error instanceof Error ? error.message : "PASSWORD_RESET_FAILED"; console.error("Password reset failed", message); return json({ error: message }, signupErrorStatus(message)); }
});
