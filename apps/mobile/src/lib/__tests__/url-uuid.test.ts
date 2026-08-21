import { describe, expect, it } from "vitest";
import { uuid } from "../uuid";
import { isDoiLink, normalizeUrl } from "../url";

describe("uuid", () => {
  it("生成合法 v4 UUID 且不重复", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuid()));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

describe("normalizeUrl", () => {
  it("裸 DOI 转为 doi.org 链接", () => {
    expect(normalizeUrl("10.1038/s41586-024-00000-0")).toBe(
      "https://doi.org/10.1038/s41586-024-00000-0",
    );
  });

  it("缺少协议补 https", () => {
    expect(normalizeUrl("arxiv.org/abs/2403.09912")).toBe(
      "https://arxiv.org/abs/2403.09912",
    );
  });

  it("完整 URL 原样保留并去空白", () => {
    expect(normalizeUrl("  https://www.nature.com/articles/x  ")).toBe(
      "https://www.nature.com/articles/x",
    );
  });

  it("空输入返回空串", () => {
    expect(normalizeUrl("   ")).toBe("");
  });
});

describe("isDoiLink", () => {
  it("识别 doi.org 与 dx.doi.org 链接", () => {
    expect(isDoiLink("https://doi.org/10.1038/s41586-024-00000-0")).toBe(true);
    expect(isDoiLink("https://dx.doi.org/10.1038/x")).toBe(true);
  });

  it("非 DOI 链接返回 false", () => {
    expect(isDoiLink("https://arxiv.org/abs/2403.09912")).toBe(false);
    expect(isDoiLink("not a url")).toBe(false);
  });
});
