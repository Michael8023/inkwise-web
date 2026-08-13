import { admin, body, json, user } from "../_shared/core.ts";
import { preflight } from "../_shared/cors.ts";

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
  return 400;
}

Deno.serve(async req => {
  const cors = preflight(req);
  if (cors) return cors;
  try {
    const { currentUser, db } = await requireAdmin(req);
    if (req.method === "GET") {
      const url = new URL(req.url);
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
      const [{ data: users, error: usersError }, { data: plans, error: plansError }] = await Promise.all([
        db.rpc("admin_list_users", { p_search: search, p_limit: limit, p_offset: (page - 1) * limit }),
        db.from("plans").select("id,name,monthly_credits,is_default").order("monthly_credits"),
      ]);
      if (usersError) throw usersError;
      if (plansError) throw plansError;
      return json({
        users: users || [],
        plans: plans || [],
        page,
        pageSize: limit,
        total: Number(users?.[0]?.total_count || 0),
      });
    }
    if (req.method === "POST") {
      const input = await body(req);
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
    const raw = error instanceof Error ? error.message : "ADMIN_REQUEST_FAILED";
    const message = raw.includes("ADMIN_REQUIRED") ? "ADMIN_REQUIRED" : raw;
    console.error("Admin request failed", message);
    return json({ error: message }, statusFor(message));
  }
});
