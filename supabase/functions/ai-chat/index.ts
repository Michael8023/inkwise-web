import { preflight, corsHeaders } from "../_shared/cors.ts";
import { body, json, refund, reserve, settle } from "../_shared/core.ts";
import { completionStream, modelOrDefault } from "../_shared/ai.ts";

const encoder = new TextEncoder();
const event = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

Deno.serve(async req => {
  const preflightResponse = preflight(req); if (preflightResponse) return preflightResponse;
  let requestId = "", reserved = false;
  try {
    const payload = await body(req), documentContext = String(payload.documentContext || ""), messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
    requestId = String(payload.requestId || crypto.randomUUID());
    if (!documentContext || documentContext.length > 120000 || messages.length > 12) throw new Error("CONTEXT_TOO_LARGE");
    const model = modelOrDefault(String(payload.model || ""));
    const charge = await reserve(req, "chat", model, Math.max(1, Math.ceil((documentContext.length + JSON.stringify(messages).length) / 60000)), requestId, documentContext.length);
    reserved = true;
    const upstream = await completionStream(model, [{ role: "system", content: `你是 PDF 文档问答助手，只能根据以下文档回答，无法确认时明确说明。公式必须使用标准 LaTeX：行内公式用 $...$，独立公式用 $$...$$ 并单独成行；绝不输出未包裹定界符的裸 LaTeX。\n\n文档：\n${documentContext}` }, ...messages], 1200);
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader(), decoder = new TextDecoder(); let buffer = "", answer = "";
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
            for (const line of lines) { if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue; try { const delta = JSON.parse(data).choices?.[0]?.delta?.content; if (delta) { answer += delta; controller.enqueue(event({ delta })); } } catch { /* ignore malformed upstream chunk */ } }
          }
          await settle(requestId, answer.length);
          controller.enqueue(event({ done: true, model, creditsUsed: charge.credits, creditsRemaining: charge.remaining })); controller.close();
        } catch (error) {
          await refund(requestId, error instanceof Error ? error.message : "AI_STREAM_FAILED");
          controller.enqueue(event({ error: error instanceof Error ? error.message : "AI_STREAM_FAILED" })); controller.close();
        }
      },
    });
    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_CHAT_FAILED";
    if (reserved) await refund(requestId, message);
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : message === "QUOTA_EXCEEDED" ? 402 : 400);
  }
});
