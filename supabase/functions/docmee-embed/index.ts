import { corsHeaders, preflight } from "../_shared/cors.ts";
import { admin, body, env, json, user } from "../_shared/core.ts";

function clean(value: unknown, limit: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
}

async function createDocmeeToken(uid: string, limit: number) {
  const response = await fetch("https://docmee.cn/api/user/createApiToken", {
    method: "POST",
    headers: { "Api-Key": env("DOCMEE_API_KEY"), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ uid, limit }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`DOCMEE_TOKEN_${response.status}`);
  const token = payload?.data?.token || payload?.token;
  if (!token) throw new Error("DOCMEE_TOKEN_MISSING");
  return String(token);
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req); if (preflightResponse) return preflightResponse;
  try {
    const currentUser = await user(req);
    const input = await body(req);
    const action = clean(input.action || "session", 30);
    const db = admin();
    const uid = `shidea:${currentUser.id}`;

    if (action === "session") {
      const paperId = clean(input.paperId, 100);
      if (!paperId) throw new Error("PPT_PAPER_REQUIRED");
      const { data: paper, error: paperError } = await db.from("library_papers")
        .select("id,title,user_id,document_text").eq("id", paperId).eq("user_id", currentUser.id).maybeSingle();
      if (paperError || !paper) throw new Error("PPT_PAPER_NOT_FOUND");
      const prompt = clean(input.prompt, 2000);
      const { data: project, error: projectError } = await db.from("ppt_projects").insert({
        user_id: currentUser.id, paper_id: paper.id, docmee_uid: uid,
        title: paper.title, prompt, status: "created",
      }).select("id,paper_id,title,prompt,status,docmee_ppt_id,created_at,updated_at").single();
      if (projectError) throw projectError;
      const token = await createDocmeeToken(uid, 20);
      // Docmee Creator V2 accepts pasted content. Supplying extracted text here
      // lets a selected private library PDF start in the outline workflow
      // without making the private Storage object public. When text has not
      // been extracted yet, the iframe still exposes Docmee's file uploader.
      return json({ project, token, docmeeUid: uid, sourceContent: clean(input.sourceContent || paper.document_text, 60_000) });
    }

    if (action === "list") {
      const { data, error } = await db.from("ppt_projects").select("id,paper_id,title,prompt,status,docmee_ppt_id,last_event,created_at,updated_at").eq("user_id", currentUser.id).order("updated_at", { ascending: false });
      if (error) throw error;
      return json({ projects: data || [] });
    }

    if (action === "update") {
      const projectId = clean(input.projectId, 100);
      const patch: Record<string, unknown> = {};
      if (input.docmeePptId) patch.docmee_ppt_id = clean(input.docmeePptId, 300);
      if (input.status) patch.status = clean(input.status, 30);
      if (input.event && typeof input.event === "object") patch.last_event = input.event;
      if (!projectId || !Object.keys(patch).length) throw new Error("PPT_UPDATE_INVALID");
      const { data, error } = await db.from("ppt_projects").update(patch).eq("id", projectId).eq("user_id", currentUser.id).select("id,paper_id,title,prompt,status,docmee_ppt_id,last_event,created_at,updated_at").single();
      if (error) throw error;
      return json({ project: data });
    }

    if (action === "delete") {
      const projectId = clean(input.projectId, 100);
      if (!projectId) throw new Error("PPT_PROJECT_REQUIRED");
      const { error } = await db.from("ppt_projects").delete().eq("id", projectId).eq("user_id", currentUser.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "refresh-token") {
      const token = await createDocmeeToken(uid, 20);
      return json({ token, docmeeUid: uid });
    }
    throw new Error("PPT_ACTION_INVALID");
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCMEE_EMBED_FAILED";
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 400);
  }
});
