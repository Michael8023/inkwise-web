import { describe, expect, it } from "vitest";
import { formatBytes, paperProgress, relativeTime, sourceName } from "@/theme/tokens";

describe("paperProgress", () => {
  it("正常计算百分比", () => {
    expect(paperProgress(3, 12)).toBe(25);
    expect(paperProgress(12, 12)).toBe(100);
  });

  it("无页数或页码返回 0", () => {
    expect(paperProgress(null, 12)).toBe(0);
    expect(paperProgress(3, null)).toBe(0);
    expect(paperProgress(undefined, undefined)).toBe(0);
  });

  it("超过 100 封顶", () => {
    expect(paperProgress(50, 10)).toBe(100);
  });
});

describe("formatBytes", () => {
  it("KB 与 MB 展示（与网页端一致：不足 1KB 按 1KB 计）", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("relativeTime", () => {
  it("各时间跨度", () => {
    expect(relativeTime(new Date().toISOString())).toBe("刚刚");
    expect(relativeTime(new Date(Date.now() - 5 * 60000).toISOString())).toBe("5 分钟前");
    expect(relativeTime(new Date(Date.now() - 3 * 3600000).toISOString())).toBe("3 小时前");
    expect(relativeTime(new Date(Date.now() - 2 * 86400000).toISOString())).toMatch(/天前|月\d+日/);
  });
});

describe("sourceName", () => {
  it("提取主机名并去 www", () => {
    expect(sourceName("https://www.nature.com/articles/x")).toBe("nature.com");
    expect(sourceName("https://doi.org/10.1234/abc")).toBe("doi.org");
  });

  it("无来源或非法 URL 显示本地 PDF", () => {
    expect(sourceName(null)).toBe("本地 PDF");
    expect(sourceName("not a url")).toBe("本地 PDF");
  });
});
