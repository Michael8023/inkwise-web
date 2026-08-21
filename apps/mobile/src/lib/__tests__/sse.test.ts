import { describe, expect, it } from "vitest";
import { extractErrorCode, parseSseFrame } from "../sse";

describe("parseSseFrame", () => {
  it("解析 delta 帧", () => {
    expect(parseSseFrame('{"delta":"迁移学习"}')).toEqual({
      type: "delta",
      text: "迁移学习",
    });
  });

  it("解析 done 帧并携带额度信息", () => {
    expect(
      parseSseFrame('{"done":true,"model":"claude-3","creditsUsed":2,"creditsRemaining":98}'),
    ).toEqual({
      type: "done",
      model: "claude-3",
      creditsUsed: 2,
      creditsRemaining: 98,
    });
  });

  it("解析 error 帧", () => {
    expect(parseSseFrame('{"error":"QUOTA_EXCEEDED"}')).toEqual({
      type: "error",
      message: "QUOTA_EXCEEDED",
    });
  });

  it("非 JSON 或未知结构返回 null", () => {
    expect(parseSseFrame("[DONE]")).toBeNull();
    expect(parseSseFrame("plain text")).toBeNull();
    expect(parseSseFrame('{"foo":1}')).toBeNull();
    expect(parseSseFrame(undefined)).toBeNull();
    expect(parseSseFrame(42)).toBeNull();
  });

  it("delta 与 done 并存时优先 delta（服务端不会出现，防御性）", () => {
    expect(parseSseFrame('{"delta":"x","done":true}')).toEqual({
      type: "delta",
      text: "x",
    });
  });
});

describe("extractErrorCode", () => {
  it("提取 JSON 错误码", () => {
    expect(extractErrorCode('{"error":"QUOTA_EXCEEDED"}')).toBe("QUOTA_EXCEEDED");
  });

  it("非 JSON 或缺失 error 字段返回 null", () => {
    expect(extractErrorCode("not json")).toBeNull();
    expect(extractErrorCode('{"message":"oops"}')).toBeNull();
    expect(extractErrorCode('{"error":123}')).toBeNull();
  });
});
