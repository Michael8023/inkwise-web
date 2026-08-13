import { admin, body, env, json } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";
import { hashSignupCode, normalizeEmail, normalizeUsername, signupErrorStatus } from "../_shared/signup.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]!);
}

Deno.serve(async req => {
  const cors = preflight(req);
  if (cors) return cors;
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    const db = admin();

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile) throw new Error("USERNAME_TAKEN");

    const code = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    const printableCode = code.toString().padStart(6, "0");
    const codeHash = await hashSignupCode(email, printableCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: issued, error: issueError } = await db.rpc("issue_signup_code", {
      p_email: email, p_username: username, p_code_hash: codeHash, p_expires_at: expiresAt,
    });
    if (issueError) throw issueError;
    if (!issued?.ok) throw new Error(issued?.error || "CODE_SEND_FAILED");

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env("RESEND_FROM_EMAIL"),
        to: [email],
        subject: `${printableCode} 是你的 Inkwise 验证码`,
        html: `<div style="background:#f5f7f8;padding:32px 16px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17201d"><div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e2e8e5;border-radius:16px;padding:32px"><div style="font-size:18px;font-weight:700;color:#176b51">墨知 Inkwise</div><h1 style="font-size:24px;margin:28px 0 10px">验证你的邮箱</h1><p style="color:#60706a;line-height:1.7">你好，${escapeHtml(username)}。输入以下验证码完成账号注册：</p><div style="font-size:34px;font-weight:750;letter-spacing:8px;text-align:center;background:#eef7f3;color:#155f49;border-radius:12px;padding:20px 12px;margin:24px 0">${printableCode}</div><p style="font-size:13px;color:#84918c;line-height:1.7">验证码将在 10 分钟后失效。若非本人操作，请忽略此邮件。</p></div></div>`,
      }),
    });
    if (!resendResponse.ok) {
      console.error("Resend request failed", resendResponse.status);
      await db.from("signup_verification_codes").delete().eq("email", email);
      throw new Error("EMAIL_SEND_FAILED");
    }
    return json({ ok: true, expiresIn: 600 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODE_SEND_FAILED";
    console.error("Signup code request failed", message);
    return json({ error: message }, signupErrorStatus(message));
  }
});
