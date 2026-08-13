import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { login, logout, refresh, register, verify, verifyEmail } from "./auth.js";
import { requireDatabase } from "./db.js";
import { translateWithBaidu } from "./baidu-translate.js";
import {
  chat,
  explainSelection,
  generateSummary,
  listModels,
  registerDocument,
} from "./apilio.js";
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const app = Fastify({ logger: true });
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: allowedOrigins.length ? allowedOrigins : true,
});
app.get("/health", async () => ({
  ok: true,
  service: "pdf-ai-reader-api",
  version: "0.1.0",
}));
app.get("/v1/models", async () => listModels());
const accountInput = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(10).max(200),
  username: z.string().trim().min(3).max(32).regex(/^[\p{L}\p{N}_]+$/u),
  displayName: z.string().trim().min(1).max(80).optional(),
});
function authenticatedUser(req: { headers: { authorization?: string } }) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("AUTH_REQUIRED");
  return verify(token);
}

app.post("/v1/auth/register", async (req, reply) => {
  const parsed = accountInput.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_ACCOUNT_INPUT" });
  try {
    return await register({ ...parsed.data, displayName: parsed.data.displayName || parsed.data.username });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGISTER_FAILED";
    return reply.code(message === "23505" ? 409 : 503).send({ error: message === "23505" ? "EMAIL_ALREADY_EXISTS" : message });
  }
});
app.post("/v1/auth/login", async (req, reply) => {
  const parsed = accountInput.pick({ email: true, password: true }).safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_LOGIN_INPUT" });
  try { return await login(parsed.data, { userAgent: req.headers["user-agent"], ip: req.ip }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "LOGIN_FAILED";
    return reply.code(message === "INVALID_CREDENTIALS" ? 401 : 503).send({ error: message });
  }
});
app.post("/v1/auth/refresh", async (req, reply) => {
  const body = z.object({ refreshToken: z.string().min(20) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "INVALID_REFRESH_REQUEST" });
  try { return await refresh(body.data.refreshToken, { userAgent: req.headers["user-agent"], ip: req.ip }); }
  catch { return reply.code(401).send({ error: "REFRESH_TOKEN_INVALID" }); }
});
app.post("/v1/auth/logout", async (req, reply) => {
  const body = z.object({ refreshToken: z.string().min(20) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "INVALID_LOGOUT_REQUEST" });
  await logout(body.data.refreshToken); return { ok: true };
});
app.post("/v1/auth/verify-email", async (req, reply) => {
  const body = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "INVALID_VERIFICATION_INPUT" });
  try { return await verifyEmail(body.data.email, body.data.code); }
  catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "VERIFICATION_FAILED" }); }
});
app.get("/v1/me/profile", async (req, reply) => {
  try {
    const user = authenticatedUser(req);
    const result = await requireDatabase().query(
      "SELECT id,email,username,display_name AS \"displayName\",avatar_url AS \"avatarUrl\",email_verified_at AS \"emailVerifiedAt\" FROM users WHERE id=$1",
      [user.id],
    );
    return { profile: result.rows[0] };
  } catch { return reply.code(401).send({ error: "AUTH_REQUIRED" }); }
});
app.patch("/v1/me/profile", async (req, reply) => {
  const body = z.object({ displayName: z.string().trim().min(1).max(80).optional(), avatarUrl: z.string().url().max(2048).optional() }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "INVALID_PROFILE_INPUT" });
  try {
    const user = authenticatedUser(req);
    const result = await requireDatabase().query(
      "UPDATE users SET display_name=COALESCE($2,display_name),avatar_url=COALESCE($3,avatar_url),updated_at=now() WHERE id=$1 RETURNING id,email,username,display_name AS \"displayName\",avatar_url AS \"avatarUrl\"",
      [user.id, body.data.displayName || null, body.data.avatarUrl || null],
    );
    return { profile: result.rows[0] };
  } catch { return reply.code(401).send({ error: "PROFILE_UPDATE_FAILED" }); }
});
const paperInput = z.object({
  title: z.string().trim().min(1).max(500),
  sourceType: z.enum(["local", "url"]),
  sourceUrl: z.string().url().optional(),
  extractedText: z.string().optional(),
  contentHash: z.string().max(128).optional(),
});
app.get("/v1/library/papers", async (req, reply) => {
  try { const user = authenticatedUser(req); const query = String((req.query as any)?.q || ""); const result = await requireDatabase().query("SELECT id,public_id AS \"publicId\",title,source_type AS \"sourceType\",source_url AS \"sourceUrl\",processing_status AS \"processingStatus\",last_opened_at AS \"lastOpenedAt\",updated_at AS \"updatedAt\" FROM papers WHERE user_id=$1 AND deleted_at IS NULL AND ($2='' OR title ILIKE '%'||$2||'%') ORDER BY COALESCE(last_opened_at,updated_at) DESC", [user.id, query]); return { papers: result.rows }; }
  catch (error) { return reply.code(401).send({ error: "AUTH_REQUIRED" }); }
});
app.post("/v1/library/papers", async (req, reply) => {
  const parsed = paperInput.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: "INVALID_PAPER_INPUT" });
  try { const user = authenticatedUser(req); const value = parsed.data; const result = await requireDatabase().query("INSERT INTO papers (user_id,title,source_type,source_url,extracted_text,content_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,public_id AS \"publicId\",title,source_type AS \"sourceType\",processing_status AS \"processingStatus\"", [user.id,value.title,value.sourceType,value.sourceUrl || null,value.extractedText || null,value.contentHash || null]); return { paper: result.rows[0] }; }
  catch (error) { return reply.code(401).send({ error: "PAPER_CREATE_FAILED" }); }
});
app.get("/v1/library/papers/:paperId", async (req, reply) => {
  try { const user = authenticatedUser(req); const id = (req.params as any).paperId; const result = await requireDatabase().query("SELECT id,public_id AS \"publicId\",title,source_type AS \"sourceType\",source_url AS \"sourceUrl\",extracted_text AS \"extractedText\",processing_status AS \"processingStatus\",last_opened_at AS \"lastOpenedAt\" FROM papers WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id,user.id]); if (!result.rowCount) return reply.code(404).send({ error: "PAPER_NOT_FOUND" }); return { paper: result.rows[0] }; }
  catch (error) { return reply.code(401).send({ error: "AUTH_REQUIRED" }); }
});
app.post("/v1/library/papers/:paperId/open", async (req, reply) => {
  try { const user = authenticatedUser(req); const id=(req.params as any).paperId; const body=req.body as any; await requireDatabase().query("INSERT INTO reading_sessions(user_id,paper_id,page_number,progress,scale) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,paper_id) DO UPDATE SET page_number=EXCLUDED.page_number,progress=EXCLUDED.progress,scale=EXCLUDED.scale,updated_at=now()", [user.id,id,body.pageNumber||1,body.progress||0,body.scale||1.2]); await requireDatabase().query("UPDATE papers SET last_opened_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2",[id,user.id]); return { ok:true }; }
  catch (error) { return reply.code(401).send({ error: "READING_STATE_SAVE_FAILED" }); }
});
app.delete("/v1/library/papers/:paperId", async (req, reply) => {
  try { const user=authenticatedUser(req); const result=await requireDatabase().query("UPDATE papers SET deleted_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2",[(req.params as any).paperId,user.id]); return { deleted: Boolean(result.rowCount) }; }
  catch (error) { return reply.code(401).send({ error: "PAPER_DELETE_FAILED" }); }
});
app.get("/v1/library/papers/:paperId/state", async (req, reply) => {
  try {
    const user = authenticatedUser(req);
    const paperId = (req.params as { paperId: string }).paperId;
    const db = requireDatabase();
    const paper = await db.query("SELECT id FROM papers WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [paperId, user.id]);
    if (!paper.rowCount) return reply.code(404).send({ error: "PAPER_NOT_FOUND" });
    const [reading, summaries, annotations, threads] = await Promise.all([
      db.query("SELECT page_number AS \"pageNumber\",progress,scale,updated_at AS \"updatedAt\" FROM reading_sessions WHERE user_id=$1 AND paper_id=$2", [user.id, paperId]),
      db.query("SELECT kind,content,updated_at AS \"updatedAt\" FROM paper_summaries WHERE paper_id=$1", [paperId]),
      db.query("SELECT id,page_number AS \"pageNumber\",selected_text AS text,context,color,geometry,translation,explanation FROM paper_annotations WHERE paper_id=$1 ORDER BY created_at", [paperId]),
      db.query("SELECT id,title,created_at AS \"createdAt\" FROM chat_threads WHERE user_id=$1 AND paper_id=$2 ORDER BY created_at DESC", [user.id, paperId]),
    ]);
    return { reading: reading.rows[0] || null, summaries: summaries.rows, annotations: annotations.rows, threads: threads.rows };
  } catch { return reply.code(401).send({ error: "STATE_LOAD_FAILED" }); }
});
app.post("/v1/library/papers/:paperId/share", async (req, reply) => {
  try {
    const user = authenticatedUser(req);
    const paperId = (req.params as { paperId: string }).paperId;
    const shareId = randomBytes(12).toString("base64url");
    const result = await requireDatabase().query(
      "UPDATE papers SET share_public_id=COALESCE(share_public_id,$3),share_enabled=true,updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING share_public_id AS \"publicId\"",
      [paperId, user.id, shareId],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "PAPER_NOT_FOUND" });
    return { publicId: result.rows[0].publicId };
  } catch { return reply.code(401).send({ error: "SHARE_ENABLE_FAILED" }); }
});
app.delete("/v1/library/papers/:paperId/share", async (req, reply) => {
  try { const user=authenticatedUser(req); await requireDatabase().query("UPDATE papers SET share_enabled=false,updated_at=now() WHERE id=$1 AND user_id=$2",[(req.params as { paperId: string }).paperId,user.id]); return { ok:true }; }
  catch { return reply.code(401).send({ error: "SHARE_DISABLE_FAILED" }); }
});
app.get("/v1/library/share/:publicId", async (req, reply) => {
  const result = await requireDatabase().query("SELECT public_id AS \"publicId\",title,source_type AS \"sourceType\" FROM papers WHERE share_public_id=$1 AND share_enabled=true AND deleted_at IS NULL", [(req.params as { publicId: string }).publicId]);
  if (!result.rowCount) return reply.code(404).send({ error: "SHARE_NOT_FOUND" });
  return { paper: result.rows[0] };
});
app.get("/v1/auth/me", async (req, reply) => {
  try { return { user: authenticatedUser(req) }; }
  catch (error) { return reply.code(401).send({ error: "AUTH_REQUIRED" }); }
});

const documentInput = z.object({ sourceKey: z.string().min(1).max(500), fileName: z.string().min(1).max(500), content: z.string().min(1) });
app.post("/v1/library/documents", async (req, reply) => {
  const parsed = documentInput.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_DOCUMENT_INPUT" });
  try {
    const user = authenticatedUser(req);
    const result = await requireDatabase().query(
      "INSERT INTO documents (user_id, source_key, file_name, content) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, source_key) DO UPDATE SET file_name = EXCLUDED.file_name, content = EXCLUDED.content, updated_at = now() RETURNING id, file_name AS \\\"fileName\\\"",
      [user.id, parsed.data.sourceKey, parsed.data.fileName, parsed.data.content],
    );
    return { document: result.rows[0] };
  } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "DOCUMENT_SAVE_FAILED" }); }
});
app.get("/v1/library/documents/:documentId/state", async (req, reply) => {
  try {
    const user = authenticatedUser(req);
    const id = (req.params as { documentId: string }).documentId;
    const db = requireDatabase();
    const document = await db.query("SELECT id FROM documents WHERE id = $1 AND user_id = $2", [id, user.id]);
    if (!document.rowCount) return reply.code(404).send({ error: "DOCUMENT_NOT_FOUND" });
    const [summaries, messages, annotations] = await Promise.all([
      db.query("SELECT kind, content FROM document_summaries WHERE document_id = $1", [id]),
      db.query("SELECT id, role, content, created_at AS \\\"createdAt\\\" FROM chat_messages WHERE document_id = $1 ORDER BY created_at", [id]),
      db.query("SELECT id, page_number AS \\\"pageNumber\\\", selected_text AS text, context, geometry, task FROM annotations WHERE document_id = $1 ORDER BY created_at", [id]),
    ]);
    return { summaries: summaries.rows, messages: messages.rows, annotations: annotations.rows };
  } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "STATE_LOAD_FAILED" }); }
});
app.put("/v1/library/documents/:documentId/summaries", async (req, reply) => {
  const body = req.body as any;
  try { const user = authenticatedUser(req); const id = (req.params as any).documentId; await requireDatabase().query("INSERT INTO document_summaries (document_id, kind, content) SELECT id, $2, $3 FROM documents WHERE id=$1 AND user_id=$4 ON CONFLICT (document_id, kind) DO UPDATE SET content=EXCLUDED.content, updated_at=now()", [id, body.kind, body.content, user.id]); return { ok: true }; }
  catch (error) { return reply.code(401).send({ error: "SUMMARY_SAVE_FAILED" }); }
});
app.post("/v1/library/documents/:documentId/messages", async (req, reply) => {
  const body = req.body as any;
  try { const user = authenticatedUser(req); const id = (req.params as any).documentId; for (const message of body.messages || []) await requireDatabase().query("INSERT INTO chat_messages (document_id, role, content) SELECT id, $2, $3 FROM documents WHERE id=$1 AND user_id=$4", [id, message.role, message.content, user.id]); return { ok: true }; }
  catch (error) { return reply.code(401).send({ error: "MESSAGE_SAVE_FAILED" }); }
});
const annotationInput = z.object({
  pageNumber: z.number().int().positive(), text: z.string().min(1), context: z.string(),
  geometry: z.unknown(), task: z.unknown().optional(),
});
app.post("/v1/library/documents/:documentId/annotations", async (req, reply) => {
  const parsed = annotationInput.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_ANNOTATION_INPUT" });
  try {
    const user = authenticatedUser(req);
    const id = (req.params as { documentId: string }).documentId;
    const result = await requireDatabase().query(
      "INSERT INTO annotations (document_id, page_number, selected_text, context, geometry, task) SELECT id, $2, $3, $4, $5::jsonb, $6::jsonb FROM documents WHERE id = $1 AND user_id = $7 RETURNING id",
      [id, parsed.data.pageNumber, parsed.data.text, parsed.data.context, JSON.stringify(parsed.data.geometry), JSON.stringify(parsed.data.task || null), user.id],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "DOCUMENT_NOT_FOUND" });
    return { annotationId: result.rows[0].id };
  } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "ANNOTATION_SAVE_FAILED" }); }
});
app.post("/v1/ai/documents", async (req, reply) => {
  const body = req.body as any;
  if (
    typeof body?.documentId !== "string" ||
    !body.documentId ||
    typeof body?.text !== "string" ||
    !body.text.trim()
  )
    return reply.code(400).send({ error: "INVALID_DOCUMENT_REQUEST" });
  registerDocument(body.documentId, body.text);
  return { documentId: body.documentId, ready: true };
});
const translateRequest = z.object({
  text: z.string().trim().min(1).max(5000),
  sourceLanguage: z.string().default("auto"),
  targetLanguage: z.string().default("zh"),
});
app.post("/v1/translate", async (req, reply) => {
  const parsed = translateRequest.safeParse(req.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({
        error: "INVALID_TRANSLATION_REQUEST",
        details: parsed.error.flatten(),
      });
  try {
    return await translateWithBaidu(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "TRANSLATION_FAILED";
    if (message === "BAIDU_TRANSLATE_NOT_CONFIGURED")
      return reply.code(503).send({ error: message });
    req.log.error({ err: error }, "Baidu translation request failed");
    return reply.code(502).send({ error: "BAIDU_TRANSLATION_UNAVAILABLE" });
  }
});
app.post("/v1/ai/summary", async (req, reply) => {
  const body = req.body as any;
  if (
    !body?.documentId ||
    !["short", "full"].includes(body.kind) ||
    !body.model
  )
    return reply.code(400).send({ error: "INVALID_SUMMARY_REQUEST" });
  try {
    return await generateSummary({
      documentId: body.documentId,
      kind: body.kind,
      model: body.model,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI_SUMMARY_FAILED";
    if (message === "AI_DOCUMENT_NOT_FOUND")
      return reply.code(409).send({ error: message });
    if (message === "APILIO_NOT_CONFIGURED")
      return reply.code(503).send({ error: message });
    req.log.error({ err: error }, "Apilio summary failed");
    return reply.code(502).send({ error: "AI_SUMMARY_UNAVAILABLE" });
  }
});
app.post("/v1/ai/explain", async (req, reply) => {
  const body = req.body as any;
  if (
    !body?.documentId ||
    !body?.text ||
    !body?.context ||
    !Number.isInteger(body?.pageNumber) ||
    !body?.model
  )
    return reply.code(400).send({ error: "INVALID_EXPLAIN_REQUEST" });
  try {
    return {
      text: await explainSelection({
        documentId: body.documentId,
        text: body.text,
        context: body.context,
        pageNumber: body.pageNumber,
        model: body.model,
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI_EXPLAIN_FAILED";
    if (message === "AI_DOCUMENT_NOT_FOUND")
      return reply.code(409).send({ error: message });
    if (message === "APILIO_NOT_CONFIGURED")
      return reply.code(503).send({ error: message });
    req.log.error({ err: error }, "Apilio explanation failed");
    return reply.code(502).send({ error: "AI_EXPLAIN_UNAVAILABLE" });
  }
});
app.post("/v1/ai/chat", async (req, reply) => {
  const body = req.body as any;
  if (!body?.sessionId || !body?.documentId || !body?.question || !body?.model)
    return reply.code(400).send({ error: "INVALID_CHAT_REQUEST" });
  try {
    return await chat({
      sessionId: body.sessionId,
      documentId: body.documentId,
      question: body.question,
      model: body.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_CHAT_FAILED";
    if (message === "AI_DOCUMENT_NOT_FOUND")
      return reply.code(409).send({ error: message });
    if (message === "APILIO_NOT_CONFIGURED")
      return reply.code(503).send({ error: message });
    req.log.error({ err: error }, "Apilio chat failed");
    return reply.code(502).send({ error: "AI_CHAT_UNAVAILABLE" });
  }
});
app
  .listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
