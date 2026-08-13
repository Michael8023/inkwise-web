import { env } from "./core.ts";

export function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("EMAIL_INVALID");
  }
  return email;
}

export function normalizeUsername(value: unknown) {
  const username = String(value || "").trim();
  if (username.length < 3 || username.length > 24) throw new Error("USERNAME_INVALID");
  if (!/^[\p{L}\p{N}_-]+$/u.test(username)) throw new Error("USERNAME_INVALID");
  return username;
}

export async function hashSignupCode(email: string, code: string) {
  const payload = new TextEncoder().encode(`${email}:${code}:${env("SIGNUP_CODE_PEPPER")}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function signupErrorStatus(message: string) {
  if (message === "CODE_COOLDOWN" || message === "CODE_RATE_LIMITED") return 429;
  if (message === "EMAIL_ALREADY_REGISTERED" || message === "USERNAME_TAKEN") return 409;
  return 400;
}

