import { preflight } from "../_shared/cors.ts";
import { admin, json, user } from "../_shared/core.ts";

Deno.serve(async req => {
  const p = preflight(req); if (p) return p;
  try {
    const u = await user(req), db = admin();
    let { data: entitlement, error } = await db.from("user_entitlements")
      .select("credits_remaining,period_start,period_end,status,plan_id,plans(name)")
      .eq("user_id", u.id).single();
    if (error || !entitlement) throw new Error("ENTITLEMENT_NOT_FOUND");
    const planName = (entitlement as any).plans?.name || "free";
    const expiredPro = planName === "pro" && (entitlement as any).period_end && new Date((entitlement as any).period_end) <= new Date();
    if (expiredPro) {
      const { data: freePlan, error: freeError } = await db.from("plans").select("id,name").eq("name", "free").maybeSingle();
      if (freeError || !freePlan) throw new Error("PLAN_NOT_FOUND");
      const { data: updated, error: updateError } = await db.from("user_entitlements")
        .update({ plan_id: freePlan.id, status: "active", updated_at: new Date().toISOString() })
        .eq("user_id", u.id)
        .select("credits_remaining,period_start,period_end,status,plan_id,plans(name)").single();
      if (updateError || !updated) throw updateError || new Error("ENTITLEMENT_UPDATE_FAILED");
      entitlement = updated;
    }
    const { data: recent, error: recentError } = await db.from("usage_ledger")
      .select("feature,model,credits,status,created_at").eq("user_id", u.id)
      .order("created_at", { ascending: false }).limit(20);
    if (recentError) throw recentError;
    const activePlan = (entitlement as any).plans?.name || "free";
    return json({ plan: activePlan, creditsRemaining: entitlement.credits_remaining ?? 0, periodEnd: activePlan === "pro" ? entitlement.period_end : null, recentUsage: recent || [] });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "USAGE_FAILED" }, 401); }
});
