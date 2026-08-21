import { describe, expect, it } from "vitest";
import { AppError, humanError, toAppError } from "../errors";

describe("humanError", () => {
  it("映射已知错误码为中文文案", () => {
    expect(humanError(new AppError("AUTH_REQUIRED"))).toBe("登录状态已失效，请重新登录");
    expect(humanError(new AppError("QUOTA_EXCEEDED"))).toBe("积分不足，请升级会员或等待下月额度恢复");
    expect(humanError(new AppError("RATE_LIMITED"))).toBe("操作过于频繁，请稍后再试");
    expect(humanError(new AppError("INVALID_CREDENTIALS"))).toBe("邮箱或密码错误");
  });

  it("带附加信息的错误码按冒号前部分匹配", () => {
    expect(humanError(new Error("DOI_PDF_NOT_AVAILABLE:https://sci-hub.mk/10.1234/x"))).toBe(
      "未能从该 DOI 获取 PDF，请确认链接是否正确",
    );
  });

  it("PDF_UPSTREAM_ 前缀回退通用文案", () => {
    expect(humanError(new Error("PDF_UPSTREAM_502"))).toContain("目标站点返回错误");
  });

  it("未知错误码回退通用文案", () => {
    expect(humanError(new AppError("SOMETHING_UNKNOWN"))).toContain("请稍后再试");
  });

  it("普通 Error 按 message 映射；无匹配则返回原文", () => {
    expect(humanError(new Error("AUTH_REQUIRED"))).toBe("登录状态已失效，请重新登录");
    expect(humanError(new Error("custom message"))).toBe("custom message");
  });

  it("非 Error 输入返回通用文案", () => {
    expect(humanError(null)).toContain("请稍后再试");
    expect(humanError("string error")).toContain("请稍后再试");
  });
});

describe("toAppError", () => {
  it("原样返回 AppError", () => {
    const err = new AppError("QUOTA_EXCEEDED", 402);
    expect(toAppError(err)).toBe(err);
  });

  it("已知 message 包装为对应 AppError；未知回退 fallback", () => {
    const mapped = toAppError(new Error("AUTH_REQUIRED"));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe("AUTH_REQUIRED");

    const fallback = toAppError(new Error("weird"), "CUSTOM_FALLBACK");
    expect(fallback.code).toBe("CUSTOM_FALLBACK");
  });
});
