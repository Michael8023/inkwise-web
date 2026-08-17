import { admin, body, env, json } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";
import { hashSignupCode, normalizeEmail, signupErrorStatus } from "../_shared/signup.ts";

function brandedFrom(value: string) {
  const address = value.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)?.[1] || value.trim();
  return `识谛 shidea <${address}>`;
}

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const email = normalizeEmail((await body(req)).email);
    const db = admin();
    const { data: userId, error: userError } = await db.rpc("find_password_reset_user", { p_email: email });
    if (userError) throw userError;
    // Always return success for a missing address to avoid account enumeration.
    if (!userId) return json({ ok: true, expiresIn: 600 });
    const printableCode = (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).toString().padStart(6, "0");
    const { data: issued, error: issueError } = await db.rpc("issue_password_reset_code", {
      p_email: email, p_code_hash: await hashSignupCode(email, printableCode), p_expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    if (issueError) throw issueError;
    if (!issued?.ok) throw new Error(issued?.error || "CODE_SEND_FAILED");
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({
      from: brandedFrom(env("RESEND_FROM_EMAIL")), to: [email], subject: `${printableCode} · 重设你的识谛 shidea 密码`,
      html: `<div style="background:#eef6f5;padding:42px 16px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#173047"><div style="max-width:500px;margin:auto;border:1px solid #d7e8e5;border-radius:20px;background:#fff;padding:36px"><div style="color:#078b8e;font-size:12px;font-weight:800;letter-spacing:2px">SHIDEA · READING SPACE</div><h1 style="color:#063477;font-size:26px">找回你的阅读空间</h1><p style="color:#54707d;line-height:1.8">请使用下面的验证码重设识谛 shidea 密码。愿你很快回到那些尚未读完的段落与思考中。</p><div style="margin:26px 0 20px;border:1px solid #bce4df;border-radius:14px;background:#edf9f7;color:#063477;padding:20px 12px;text-align:center;font-family:ui-monospace,monospace;font-size:34px;font-weight:800;letter-spacing:9px">${printableCode}</div><p style="color:#7c9199;font-size:12px">验证码将在 10 分钟后失效。若非本人操作，请忽略此邮件。</p><div style="color:#078b8e;font-size:13px;font-weight:700">识谛 shidea</div></div></div>`,
    }) });
    if (!response.ok) { await db.from("password_reset_codes").delete().eq("email", email); throw new Error("EMAIL_SEND_FAILED"); }
    return json({ ok: true, expiresIn: 600 });
  } catch (error) { const message = error instanceof Error ? error.message : "CODE_SEND_FAILED"; console.error("Password reset code request failed", message); return json({ error: message }, signupErrorStatus(message)); }
});
