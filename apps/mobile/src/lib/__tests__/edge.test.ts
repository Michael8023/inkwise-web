import { beforeEach, describe, expect, it, vi } from "vitest";

// 可控的假 EventSource，用于驱动 streamEdge 的事件流
const fake = vi.hoisted(() => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners: Record<string, Array<(e?: unknown) => void>> = {};
    closed = false;
    constructor(
      public url: string,
      public options: Record<string, unknown>,
    ) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, cb: (e?: unknown) => void) {
      (this.listeners[type] ||= []).push(cb);
    }
    emit(type: string, data?: unknown) {
      (this.listeners[type] || []).forEach((cb) => cb(data));
    }
    close() {
      this.closed = true;
    }
  }
  return {
    FakeEventSource,
    token: { value: "tok1" },
    refreshCount: { value: 0 },
    refreshResult: { value: "tok2" },
  };
});

vi.mock("react-native-sse", () => ({ default: fake.FakeEventSource }));

vi.mock("@/lib/supabase", () => ({
  requireSessionToken: async () => fake.token.value,
  supabase: {
    auth: {
      refreshSession: async () => {
        fake.refreshCount.value += 1;
        return {
          data: {
            session: fake.refreshResult.value
              ? { access_token: fake.refreshResult.value }
              : null,
          },
        };
      },
    },
  },
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_URL: "https://x.supabase.co",
}));

import { streamEdge } from "../edge";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fake.FakeEventSource.instances = [];
  fake.token.value = "tok1";
  fake.refreshCount.value = 0;
  fake.refreshResult.value = "tok2";
});

describe("streamEdge", () => {
  it("delta 帧累积输出，done 携带额度元信息并关闭", async () => {
    const deltas: string[] = [];
    const done: Array<Record<string, unknown>> = [];
    streamEdge(
      "ai-summary",
      { kind: "short" },
      { onDelta: (t) => deltas.push(t), onDone: (m) => done.push(m as Record<string, unknown>) },
    );
    await tick();
    const es = fake.FakeEventSource.instances[0];
    expect(es).toBeDefined();
    expect(es.options.method).toBe("POST");
    es.emit("message", { data: JSON.stringify({ delta: "三" }) });
    es.emit("message", { data: JSON.stringify({ delta: "条要点" }) });
    es.emit("message", {
      data: JSON.stringify({ done: true, model: "m1", creditsUsed: 2, creditsRemaining: 98 }),
    });
    expect(deltas.join("")).toBe("三条要点");
    expect(done[0]).toEqual({ model: "m1", creditsUsed: 2, creditsRemaining: 98 });
    expect(es.closed).toBe(true);
  });

  it("error 帧回调错误码", async () => {
    const errors: string[] = [];
    streamEdge("ai-chat", {}, { onDelta: () => {}, onError: (m) => errors.push(m) });
    await tick();
    fake.FakeEventSource.instances[0].emit("message", {
      data: JSON.stringify({ error: "QUOTA_EXCEEDED" }),
    });
    expect(errors).toEqual(["QUOTA_EXCEEDED"]);
  });

  it("HTTP 错误响应体提取真实错误码（不触发刷新重连）", async () => {
    const errors: string[] = [];
    streamEdge("ai-summary", {}, { onDelta: () => {}, onError: (m) => errors.push(m) });
    await tick();
    fake.FakeEventSource.instances[0].emit("error", {
      message: JSON.stringify({ error: "RATE_LIMITED" }),
      xhrStatus: 429,
    });
    expect(errors).toEqual(["RATE_LIMITED"]);
    expect(fake.refreshCount.value).toBe(0);
  });

  it("无响应体的错误：刷新会话后重连一次，再次失败报网络错误", async () => {
    const errors: string[] = [];
    streamEdge("ai-summary", {}, { onDelta: () => {}, onError: (m) => errors.push(m) });
    await tick();
    fake.FakeEventSource.instances[0].emit("error", { message: "", xhrStatus: 0 });
    await tick();
    expect(fake.refreshCount.value).toBe(1);
    expect(fake.FakeEventSource.instances.length).toBe(2);
    fake.FakeEventSource.instances[1].emit("error", { message: "", xhrStatus: 0 });
    await tick();
    expect(errors).toEqual(["NETWORK_REQUEST_FAILED"]);
  });

  it("会话刷新失败时报 AUTH_REQUIRED", async () => {
    const errors: string[] = [];
    fake.refreshResult.value = "";
    streamEdge("ai-summary", {}, { onDelta: () => {}, onError: (m) => errors.push(m) });
    await tick();
    fake.FakeEventSource.instances[0].emit("error", { message: "", xhrStatus: 401 });
    await tick();
    expect(errors).toEqual(["AUTH_REQUIRED"]);
  });

  it("close() 后忽略后续事件", async () => {
    const deltas: string[] = [];
    const handle = streamEdge("x", {}, { onDelta: (t) => deltas.push(t) });
    await tick();
    handle.close();
    fake.FakeEventSource.instances[0].emit("message", { data: JSON.stringify({ delta: "no" }) });
    expect(deltas).toEqual([]);
  });
});
