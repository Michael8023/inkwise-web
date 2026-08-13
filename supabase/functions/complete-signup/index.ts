import { admin, body, json } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";
import { hashSignupCode, normalizeEmail, signupErrorStatus } from "../_shared/signup.ts";

Deno.serve(async req => {
  const cors = preflight(req);
  if (cors) return cors;
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const code = String(input.code || "").trim();
    const password = String(input.password || "");
    if (!/^\d{6}$/.test(code)) throw new Error("CODE_INVALID");
    if (password.length < 8 || password.length > 72) throw new Error("PASSWORD_INVALID");

    const db = admin();
    const codeHash = await hashSignupCode(email, code);
    const { data: claimed, error: claimError } = await db.rpc("claim_signup_code", {
      p_email: email, p_code_hash: codeHash,
    });
    if (claimError) throw claimError;
    if (!claimed?.ok) throw new Error(claimed?.error || "CODE_INVALID");

    const username = String(claimed.username);
    const { data, error: createError } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: username },
    });
    if (createError) {
      const duplicate = /already|registered|exists/i.test(createError.message);
      if (!duplicate) await db.rpc("release_signup_code", { p_email: email });
      throw new Error(duplicate ? "EMAIL_ALREADY_REGISTERED" : "SIGNUP_FAILED");
    }
    return json({ ok: true, userId: data.user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SIGNUP_FAILED";
    console.error("Signup completion failed", message);
    return json({ error: message }, signupErrorStatus(message));
  }
});
