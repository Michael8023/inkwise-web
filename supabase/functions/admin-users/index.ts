import { admin, body, env, json, user } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";

type RemoteModel = { id: string; name: string; provider: string };

function modelProvider(modelId: string, ownedBy: unknown) {
  const value = `${String(ownedBy || "")} ${modelId}`.toLowerCase();
  if (/claude|anthropic/.test(value)) return "Anthropic";
  if (/gemini|google/.test(value)) return "Google";
  if (/gpt|openai|\bo[1-9]\b/.test(value)) return "OpenAI";
  if (/grok|xai/.test(value)) return "xAI";
  if (/qwen|alibaba/.test(value)) return "Alibaba";
  if (/deepseek/.test(value)) return "DeepSeek";
  if (/mistral/.test(value)) return "Mistral AI";
  return String(ownedBy || "其他").slice(0, 48) || "其他";
}

async function upstreamModels(): Promise<RemoteModel[]> {
  const baseUrl = (env("APILIO_BASE_URL") || "https://api.apilio.ai/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${env("APILIO_API_KEY")}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.data)) throw new Error("UPSTREAM_MODELS_FAILED");
  const unique = new Map<string, RemoteModel>();
  for (const item of payload.data) {
    const id = String(item?.id || "").trim();
    if (!/^[a-zA-Z0-9._:/-]{1,180}$/.test(id)) continue;
    unique.set(id, { id, name: String(item?.name || item?.display_name || id).slice(0, 180), provider: modelProvider(id, item?.owned_by) });
  }
  return [...unique.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

async function upstreamBalance() {
  const configuredBase = (env("APILIO_BASE_URL") || "https://api.apilio.ai/v1").replace(/\/$/, "");
  const baseUrl = configuredBase.replace(/\/v1$/, "");
  const response = await fetch(`${baseUrl}/api/usage/token`, { headers: { Authorization: `Bearer ${env("APILIO_API_KEY")}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data) throw new Error("UPSTREAM_BALANCE_FAILED");
  const data = payload.data;
  const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
  return { name: String(data.name || "Apilio API"), totalGranted: numeric(data.total_granted), totalUsed: numeric(data.total_used), totalAvailable: numeric(data.total_available), unlimited: data.unlimited_quota === true, expiresAt: numeric(data.expires_at) || null };
}

async function requireAdmin(req: Request) {
  const currentUser = await user(req);
  const db = admin();
  const { data, error } = await db.from("admin_users").select("user_id").eq("user_id", currentUser.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("ADMIN_REQUIRED");
  return { currentUser, db };
}

function statusFor(message: string) {
  if (message === "AUTH_REQUIRED") return 401;
  if (message === "ADMIN_REQUIRED") return 403;
  if (message === "USER_NOT_FOUND") return 404;
  if (message === "ADMIN_DELETE_FORBIDDEN") return 403;
  if (message === "PLAN_NOT_FOUND") return 404;
  if (message === "PLAN_NAME_EXISTS") return 409;
  if (message === "PASSWORD_INVALID") return 400;
  if (message === "INVALID_REFERRAL_BONUS") return 400;
  if (message === "UPSTREAM_MODELS_FAILED") return 502;
  if (message === "UPSTREAM_BALANCE_FAILED") return 502;
  return 400;
}

Deno.serve(async req => {
  const cors = preflight(req);
  if (cors) return cors;
  try {
    const { currentUser, db } = await requireAdmin(req);
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("feedback") === "1") {
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const limit = 40;
        const { data, error } = await db.from("user_feedback")
          .select("id,user_id,category,content,status,created_at")
          .order("status").order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
        if (error) throw error;
        const userIds = [...new Set((data || []).map(item => item.user_id))];
        const users = await Promise.all(userIds.map(id => db.auth.admin.getUserById(id)));
        const emails = new Map(users.map(result => [result.data.user?.id, result.data.user?.email || "-"]));
        return json({ feedback: (data || []).map(item => ({ ...item, email: emails.get(item.user_id) || "-" })), page });
      }
      if (url.searchParams.get("models") === "catalog") {
        const [remote, { data: catalog, error: catalogError }] = await Promise.all([
          upstreamModels(),
          db.from("model_catalog").select("model_id,enabled"),
        ]);
        if (catalogError) throw catalogError;
        const catalogById = new Map((catalog || []).map(item => [item.model_id, item]));
        return json({ models: remote.map(item => ({ ...item, enabled: !!catalogById.get(item.id)?.enabled })) });
      }
      if (url.searchParams.get("balance") === "1") return json({ balance: await upstreamBalance(), checkedAt: new Date().toISOString() });
      const detailUserId = url.searchParams.get("userId");
      if (detailUserId) {
        if (!/^[0-9a-f-]{36}$/i.test(detailUserId)) throw new Error("USER_NOT_FOUND");
        const [{ data: usage, error: usageError }, { data: adjustments, error: adjustmentError }] = await Promise.all([
          db.from("usage_ledger").select("id,feature,model,credits,status,error_code,created_at").eq("user_id", detailUserId).order("created_at", { ascending: false }).limit(30),
          db.from("credit_adjustments").select("id,operation,amount,credits_before,credits_after,note,created_at").eq("user_id", detailUserId).order("created_at", { ascending: false }).limit(30),
        ]);
        if (usageError) throw usageError;
        if (adjustmentError) throw adjustmentError;
        return json({ usage: usage || [], adjustments: adjustments || [] });
      }
      const search = (url.searchParams.get("search") || "").slice(0, 100);
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = 30;
      const [{ data: users, error: usersError }, { data: plans, error: plansError }, { data: referralSettings, error: referralSettingsError }] = await Promise.all([
        db.rpc("admin_list_users", { p_search: search, p_limit: limit, p_offset: (page - 1) * limit }),
        db.from("plans").select("id,name,monthly_credits,is_default").order("monthly_credits"),
        db.from("referral_settings").select("signup_bonus").eq("id", true).maybeSingle(),
      ]);
      if (usersError) throw usersError;
      if (plansError) throw plansError;
      if (referralSettingsError) throw referralSettingsError;
      return json({
        users: users || [],
        plans: plans || [],
        page,
        pageSize: limit,
        total: Number(users?.[0]?.total_count || 0),
        referralBonus: Number(referralSettings?.signup_bonus || 0),
      });
    }
    if (req.method === "POST") {
      const input = await body(req);
      if (input.action === "resetPassword") {
        const userId = String(input.userId || "");
        const password = String(input.password || "");
        if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("USER_NOT_FOUND");
        if (password.length < 8 || password.length > 72) throw new Error("PASSWORD_INVALID");
        if (userId === currentUser.id) throw new Error("ADMIN_PASSWORD_SELF_FORBIDDEN");
        const { data: target, error: targetError } = await db.auth.admin.getUserById(userId);
        if (targetError || !target.user) throw new Error("USER_NOT_FOUND");
        const { error: updateError } = await db.auth.admin.updateUserById(userId, { password });
        if (updateError) throw new Error("PASSWORD_RESET_FAILED");
        return json({ ok: true, userId });
      }
      if (input.action === "saveReferralBonus") {
        const signupBonus = Number(input.signupBonus);
        if (!Number.isSafeInteger(signupBonus) || signupBonus < 0 || signupBonus > 10_000_000) throw new Error("INVALID_REFERRAL_BONUS");
        const { error } = await db.from("referral_settings").upsert({ id: true, signup_bonus: signupBonus, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true, signupBonus });
      }
      if (input.action === "setFeedbackStatus") {
        const feedbackId = String(input.feedbackId || ""); const status = String(input.status || "");
        if (!/^[0-9a-f-]{36}$/i.test(feedbackId) || !["todo", "done"].includes(status)) throw new Error("INVALID_FEEDBACK");
        const { error } = await db.from("user_feedback").update({ status, updated_at: new Date().toISOString() }).eq("id", feedbackId);
        if (error) throw error;
        return json({ ok: true });
      }
      if (input.action === "saveModels") {
        const models = Array.isArray(input.models) ? input.models : [];
        if (!models.length || models.length > 500) throw new Error("INVALID_MODELS");
        const normalized = models.map(item => ({
          id: String(item?.id || "").trim(),
          name: String(item?.name || item?.id || "").trim(),
          provider: String(item?.provider || "其他").trim(),
        }));
        if (normalized.some(item => !/^[a-zA-Z0-9._:/-]{1,180}$/.test(item.id) || !item.name || item.name.length > 180 || item.provider.length > 48) || new Set(normalized.map(item => item.id)).size !== normalized.length) throw new Error("INVALID_MODELS");
        // PostgREST refuses broad updates without a predicate. Keep the
        // allow-list update explicit here instead of relying on a database
        // routine whose broad disable step can be rejected by the gateway.
        const { error: disableError } = await db.from("model_catalog")
          .update({ enabled: false })
          .neq("model_id", "");
        if (disableError) throw disableError;
        const { error: upsertError } = await db.from("model_catalog").upsert(
          normalized.map(item => ({
            model_id: item.id,
            display_name: item.name,
            provider: item.provider,
            enabled: true,
            available_features: ["summary", "explain", "chat", "visual"],
          })),
          { onConflict: "model_id" },
        );
        if (upsertError) throw upsertError;
        return json({ ok: true, enabled: normalized.length });
      }
      if (input.action === "savePlan") {
        const planId = input.planId ? String(input.planId) : null;
        const name = String(input.name || "");
        const monthlyCredits = Number(input.monthlyCredits);
        const isDefault = input.isDefault === true;
        if ((planId && !/^[0-9a-f-]{36}$/i.test(planId)) || !Number.isSafeInteger(monthlyCredits)) {
          throw new Error("INVALID_PLAN");
        }
        const { data, error } = await db.rpc("admin_save_plan", {
          p_admin_user_id: currentUser.id,
          p_plan_id: planId,
          p_name: name,
          p_monthly_credits: monthlyCredits,
          p_is_default: isDefault,
        });
        if (error) throw error;
        return json({ plan: data });
      }
      const userId = String(input.userId || "");
      const operation = String(input.operation || "");
      const amount = Number(input.amount);
      const planId = input.planId ? String(input.planId) : null;
      const note = String(input.note || "");
      if (!/^[0-9a-f-]{36}$/i.test(userId) || !["add", "subtract", "set"].includes(operation) || !Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000) {
        throw new Error("INVALID_ADJUSTMENT");
      }
      const { data, error } = await db.rpc("admin_adjust_credits", {
        p_admin_user_id: currentUser.id,
        p_user_id: userId,
        p_operation: operation,
        p_amount: amount,
        p_plan_id: planId,
        p_note: note,
      });
      if (error) throw error;
      return json(data);
    }
    if (req.method === "DELETE") {
      const input = await body(req);
      if (input.action === "deleteFeedback") {
        const feedbackId = String(input.feedbackId || "");
        if (!/^[0-9a-f-]{36}$/i.test(feedbackId)) throw new Error("INVALID_FEEDBACK");
        const { error } = await db.from("user_feedback").delete().eq("id", feedbackId);
        if (error) throw error;
        return json({ ok: true });
      }
      const userId = String(input.userId || "");
      const confirmation = String(input.confirmation || "").trim().toLowerCase();
      if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("USER_NOT_FOUND");
      if (userId === currentUser.id) throw new Error("ADMIN_DELETE_FORBIDDEN");
      const { data: target, error: targetError } = await db.auth.admin.getUserById(userId);
      if (targetError || !target.user) throw new Error("USER_NOT_FOUND");
      if (!target.user.email || confirmation !== target.user.email.toLowerCase()) throw new Error("DELETE_CONFIRMATION_INVALID");
      const { data: targetAdmin, error: targetAdminError } = await db.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) throw new Error("ADMIN_DELETE_FORBIDDEN");
      const { error: deleteError } = await db.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;
      return json({ ok: true, userId });
    }
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  } catch (error) {
    const raw = error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "ADMIN_REQUEST_FAILED";
    const message = raw.includes("ADMIN_REQUIRED") ? "ADMIN_REQUIRED" : raw;
    console.error("Admin request failed", message);
    return json({ error: message }, statusFor(message));
  }
});
