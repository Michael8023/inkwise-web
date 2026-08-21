// SSE 帧解析（纯函数，无 RN 依赖，可单测）

/** 解析一条 SSE data 帧（ai-summary / ai-chat 等 Edge Function 的事件格式）。 */
export type SseFrame =
  | { type: "delta"; text: string }
  | { type: "done"; model?: string; creditsUsed?: number; creditsRemaining?: number }
  | { type: "error"; message: string }
  | null;

export function parseSseFrame(raw: unknown): SseFrame {
  if (typeof raw !== "string") return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof payload.delta === "string") {
    return { type: "delta", text: payload.delta };
  }
  if (payload.done) {
    return {
      type: "done",
      model: typeof payload.model === "string" ? payload.model : undefined,
      creditsUsed: typeof payload.creditsUsed === "number" ? payload.creditsUsed : undefined,
      creditsRemaining: typeof payload.creditsRemaining === "number" ? payload.creditsRemaining : undefined,
    };
  }
  if (typeof payload.error === "string") {
    return { type: "error", message: payload.error };
  }
  return null;
}

/** 从 HTTP 错误响应体（JSON {error}）提取错误码；非 JSON 返回 null */
export function extractErrorCode(body: string): string | null {
  try {
    const payload = JSON.parse(body) as { error?: unknown };
    return typeof payload.error === "string" && payload.error ? payload.error : null;
  } catch {
    return null;
  }
}
