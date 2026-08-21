// 认证：Edge Function（注册/找回密码）+ Supabase Auth（登录/会话）。
// 契约对齐 supabase/functions/{request-signup-code,complete-signup,request-password-reset,reset-password}
import { edgeJson } from "./edge";
import { supabase } from "./supabase";

export async function requestSignupCode(input: {
  email: string;
  username: string;
  inviteCode?: string;
}): Promise<{ ok: boolean; expiresIn: number }> {
  return edgeJson<{ ok: boolean; expiresIn: number }>("request-signup-code", {
    email: input.email.trim(),
    username: input.username.trim(),
    inviteCode: input.inviteCode?.trim() || "",
  });
}

export async function completeSignup(input: {
  email: string;
  code: string;
  password: string;
}): Promise<{ ok: boolean; userId: string }> {
  return edgeJson<{ ok: boolean; userId: string }>("complete-signup", {
    email: input.email.trim(),
    code: input.code.trim(),
    password: input.password,
  });
}

export async function loginWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    // supabase 错误信息映射为网页端语义
    const message = error.message.toLowerCase();
    if (/invalid login credentials/i.test(message)) throw new Error("INVALID_CREDENTIALS");
    if (/email not confirmed/i.test(message)) throw new Error("EMAIL_NOT_CONFIRMED");
    throw new Error(error.message);
  }
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; expiresIn: number }> {
  return edgeJson<{ ok: boolean; expiresIn: number }>("request-password-reset", {
    email: email.trim(),
  });
}

export async function resetPassword(input: {
  email: string;
  code: string;
  password: string;
}): Promise<{ ok: boolean }> {
  return edgeJson<{ ok: boolean }>("reset-password", {
    email: input.email.trim(),
    code: input.code.trim(),
    password: input.password,
  });
}
