// Edge Function 调用封装：JSON 请求 + SSE 流式请求。
// 行为与网页端 api.ts 一致：附带 apikey + Bearer 会话 token；401 自动刷新并重试一次。
import EventSource from "react-native-sse";
import { extractErrorCode, parseSseFrame } from "./sse";
import { requireSessionToken, supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone?: (meta: { model?: string; creditsUsed?: number; creditsRemaining?: number }) => void;
  onError?: (message: string) => void;
}

function headersFor(token: string, extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function edgeFetch(name: string, init: RequestInit = {}): Promise<Response> {
  let token = await requireSessionToken();
  const doFetch = async (accessToken: string) =>
    fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      ...init,
      headers: headersFor(accessToken),
    });
  let response = await doFetch(token);
  if (response.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data?.session) {
      token = data.session.access_token;
      response = await doFetch(token);
    }
  }
  return response;
}

export async function edgeJson<T>(name: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const response = await edgeFetch(name, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  if (!response.ok) {
    let code = "UNKNOWN";
    try {
      const payload = (await response.json()) as { error?: string };
      code = payload.error || code;
    } catch {
      /* non-json body */
    }
    throw new Error(code);
  }
  return (await response.json()) as T;
}

/** 流式调用（ai-summary / ai-chat / ai-brainstorm）。返回一个可取消的句柄。 */
export function streamEdge(
  name: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
): { close: () => void } {
  let es: EventSource | null = null;
  let closed = false;
  let attempts = 0;

  const connect = async () => {
    if (closed) return;
    let token: string;
    try {
      token = await requireSessionToken();
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error.message : "AUTH_REQUIRED");
      return;
    }
    if (closed) return;

    es = new EventSource(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify(body),
      pollingInterval: 0,
    });

    es.addEventListener("open", () => {
      attempts = 0;
    });

    es.addEventListener("message", (event) => {
      if (closed) return;
      const frame = parseSseFrame(event.data);
      if (!frame) return;
      if (frame.type === "delta") {
        handlers.onDelta(frame.text);
      } else if (frame.type === "done") {
        handlers.onDone?.({
          model: frame.model,
          creditsUsed: frame.creditsUsed,
          creditsRemaining: frame.creditsRemaining,
        });
        close();
      } else if (frame.type === "error") {
        handlers.onError?.(frame.message);
        close();
      }
    });

    es.addEventListener("error", (event) => {
      if (closed) return;
      // HTTP 错误（如 402 QUOTA_EXCEEDED）时响应体是 JSON {error}，从中提取真实错误码
      const rawEvent = event as unknown as { message?: string; xhrStatus?: number };
      const bodyMessage = typeof rawEvent.message === "string" ? rawEvent.message : "";
      const status = rawEvent.xhrStatus ?? 0;
      const bodyCode = bodyMessage ? extractErrorCode(bodyMessage) : null;
      if (bodyCode) {
        handlers.onError?.(bodyCode);
        close();
        return;
      }
      if (attempts === 0) {
        // 首次错误：尝试刷新会话后重连一次
        attempts += 1;
        es?.close();
        void supabase.auth.refreshSession().then(({ data }) => {
          if (data.session) connect();
          else handlers.onError?.("AUTH_REQUIRED");
        });
      } else {
        handlers.onError?.(status >= 400 && status < 500 ? "AUTH_REQUIRED" : "NETWORK_REQUEST_FAILED");
        close();
      }
    });
  };

  const close = () => {
    closed = true;
    es?.close();
  };

  void connect();
  return { close };
}
