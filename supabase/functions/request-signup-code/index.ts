import { admin, body, env, json } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";
import { hashSignupCode, normalizeEmail, normalizeUsername, signupErrorStatus } from "../_shared/signup.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]!);
}

function brandedFrom(value: string) {
  const address = value.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)?.[1] || value.trim();
  return `史谛 shidea <${address}>`;
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
        from: brandedFrom(env("RESEND_FROM_EMAIL")),
        to: [email],
        subject: `${printableCode} · 史谛 shidea 邀你开始阅读`,
        html: `<div style="background:#eef6f5;padding:42px 16px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#173047"><div style="max-width:500px;margin:auto;border:1px solid #d7e8e5;border-radius:20px;background:#ffffff;box-shadow:0 18px 48px rgba(6,52,119,.10);padding:36px"><div style="color:#078b8e;font-size:12px;font-weight:800;letter-spacing:2px">SHIDEA · READING SPACE</div><div style="margin-top:12px;color:#063477;font-family:Georgia,'Times New Roman','Songti SC',serif;font-size:27px;line-height:1.25">让每一页阅读，<br/>都通向更清晰的理解。</div><p style="margin:24px 0 0;color:#54707d;font-size:14px;line-height:1.8">你好，${escapeHtml(username)}。欢迎来到史谛 shidea。请使用下面的验证码完成注册，期待和你一起读过那些重要的文献、问题与灵光。</p><div style="margin:26px 0 20px;border:1px solid #bce4df;border-radius:14px;background:#edf9f7;color:#063477;padding:20px 12px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:800;letter-spacing:9px">${printableCode}</div><p style="margin:0;color:#7c9199;font-size:12px;line-height:1.7">验证码将在 10 分钟后失效。若不是你发起的注册，可以安心忽略这封邮件。</p><div style="height:1px;margin:24px 0 16px;background:#e5efed"></div><div style="color:#078b8e;font-size:13px;font-weight:700">史谛 shidea</div><div style="margin-top:4px;color:#8a9ca3;font-size:11px">与你一起，把阅读变成自己的思想地图。</div></div></div>`,
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
