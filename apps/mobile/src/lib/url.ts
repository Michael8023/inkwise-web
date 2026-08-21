// URL/DOI 规范化（纯函数，可单测）：与网页端 normalizePaperUrl 语义一致

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // 裸 DOI（10.xxxx/xxx）→ doi.org 链接
  if (/^10\.\d{4,9}\/\S+/i.test(trimmed)) return `https://doi.org/${trimmed}`;
  // 缺少协议 → 补 https
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function isDoiLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      ["doi.org", "dx.doi.org"].includes(parsed.hostname.toLowerCase()) &&
      /^\/10\.\d{4,9}\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
