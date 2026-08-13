import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomInt, randomBytes } from "node:crypto";
import { requireDatabase } from "./db.js";

export type AuthUser = { id: string; email: string; displayName: string };

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET_NOT_CONFIGURED");
  return value;
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
async function sendVerificationEmail(email: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [email], subject: "墨知邮箱验证码", html: `<p>你的墨知验证码是：<strong>${code}</strong></p><p>验证码 10 分钟内有效。</p>` }) });
  if (!response.ok) throw new Error("EMAIL_SEND_FAILED");
}

export async function issueVerification(userId: string, email: string, purpose = "register") {
  const db = requireDatabase();
  const code = String(randomInt(100000, 1000000));
  await db.query("UPDATE email_verification_codes SET consumed_at = now() WHERE lower(email)=lower($1) AND purpose=$2 AND consumed_at IS NULL", [email, purpose]);
  await db.query("INSERT INTO email_verification_codes (user_id, email, purpose, code_hash, expires_at) VALUES ($1,$2,$3,$4,now()+interval '10 minutes')", [userId, email, purpose, hash(code)]);
  await sendVerificationEmail(email, code);
}

export async function verifyEmail(email: string, code: string) {
  const db = requireDatabase();
  const result = await db.query("SELECT id,user_id FROM email_verification_codes WHERE lower(email)=lower($1) AND purpose='register' AND consumed_at IS NULL AND expires_at>now() AND attempts<5 ORDER BY created_at DESC LIMIT 1", [email]);
  const row = result.rows[0];
  if (!row) throw new Error("VERIFICATION_CODE_INVALID");
  await db.query("UPDATE email_verification_codes SET attempts=attempts+1,consumed_at=now() WHERE id=$1 AND code_hash=$2", [row.id, hash(code)]);
  const check = await db.query("SELECT consumed_at FROM email_verification_codes WHERE id=$1", [row.id]);
  if (!check.rows[0]?.consumed_at) throw new Error("VERIFICATION_CODE_INVALID");
  await db.query("UPDATE users SET status='active',email_verified_at=now(),updated_at=now() WHERE id=$1", [row.user_id]);
  return { ok: true };
}

export async function register(input: { email: string; password: string; username: string; displayName: string }) {
  const db = requireDatabase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await db.query<AuthUser>(
    "INSERT INTO users (email, username, display_name, password_hash, status) VALUES ($1,$2,$3,$4,'pending') RETURNING id,email,display_name AS \"displayName\"",
    [input.email.toLowerCase(), input.username, input.displayName, passwordHash],
  );
  await issueVerification(result.rows[0].id, input.email, "register");
  return { pendingVerification: true, email: input.email };
}

export async function login(input: { email: string; password: string }, metadata: { userAgent?: string; ip?: string } = {}) {
  const db = requireDatabase();
  const result = await db.query<AuthUser & { passwordHash: string }>(
    "SELECT id,email,display_name AS \"displayName\",password_hash AS \"passwordHash\" FROM users WHERE email=$1 AND status='active' AND email_verified_at IS NOT NULL",
    [input.email.toLowerCase()],
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
    throw new Error("INVALID_CREDENTIALS");
  return issue(user, metadata);
}

export function verify(token: string) {
  return jwt.verify(token, secret()) as AuthUser;
}

async function issue(user: AuthUser, metadata: { userAgent?: string; ip?: string } = {}) {
  const refreshToken = randomBytes(48).toString("base64url");
  await requireDatabase().query(
    "INSERT INTO auth_sessions (user_id,refresh_token_hash,user_agent,ip_address,expires_at) VALUES ($1,$2,$3,$4,now()+interval '30 days')",
    [user.id, hash(refreshToken), metadata.userAgent || null, metadata.ip || null],
  );
  return { user, token: jwt.sign(user, secret(), { expiresIn: "15m" }), refreshToken };
}

export async function refresh(refreshToken: string, metadata: { userAgent?: string; ip?: string } = {}) {
  const db = requireDatabase();
  const session = await db.query<AuthUser & { sessionId: string }>(
    "SELECT s.id AS \"sessionId\",u.id,u.email,u.display_name AS \"displayName\" FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'",
    [hash(refreshToken)],
  );
  const row = session.rows[0];
  if (!row) throw new Error("REFRESH_TOKEN_INVALID");
  await db.query("UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", [row.sessionId]);
  return issue(row, metadata);
}

export async function logout(refreshToken: string) {
  await requireDatabase().query("UPDATE auth_sessions SET revoked_at=now() WHERE refresh_token_hash=$1 AND revoked_at IS NULL", [hash(refreshToken)]);
}
