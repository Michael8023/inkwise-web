// pdf-extract-text
// 移动端本地 PDF 导入的配套函数：
// 1) 校验归属（storage_path 必须以 auth.uid() 开头，防越权读取他人文件）
// 2) 用服务端角色从私有桶下载 PDF 原始字节
// 3) 计算 SHA-256 hex（与网页端 WebCrypto crypto.subtle.digest 结果一致，用于 content_hash 去重）
// 4) 用 pdfjs-dist 抽取文本层（不渲染，轻量）
// 返回 { text, contentHash, pageCount }
// 错误：AUTH_REQUIRED / STORAGE_DOWNLOAD_FAILED / PDF_PARSE_FAILED / TEXT_EMPTY
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { admin, json, user } from "../_shared/core.ts";
import { getDocument, GlobalWorkerOptions } from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";

// Deno/无 DOM 环境兜底：pdfjs 文本抽取路径不使用 DOMMatrix，
// 这里仅防止个别构建在模块加载期引用未定义全局导致报错。
if (typeof (globalThis as Record<string, unknown>).DOMMatrix === "undefined") {
  (globalThis as Record<string, unknown>).DOMMatrix = class {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(init?: string | number[]) {
      if (typeof init === "string") {
        const v = init.split(",").map(Number);
        if (v.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = v;
      } else if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init.map(Number);
      }
    }
    multiply(other: { a: number; b: number; c: number; d: number; e: number; f: number }) {
      const { a, b, c, d, e, f } = other;
      return new (globalThis as Record<string, unknown>).DOMMatrix([
        this.a * a + this.c * b,
        this.b * a + this.d * b,
        this.a * c + this.c * d,
        this.b * c + this.d * d,
        this.a * e + this.c * f + this.e,
        this.b * e + this.d * f + this.f,
      ]);
    }
  } as unknown as typeof DOMMatrix;
}

// 显式关闭 worker，强制主线程 fake worker（与 Node 验证环境一致的路径）
GlobalWorkerOptions.workerSrc = "";

const MAX_PAGES = 200;

Deno.serve(async (req) => {
  const p = preflight(req);
  if (p) return p;
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const current = await user(req);
    const input = await req.json() as { storagePath?: unknown };
    const storagePath = String(input.storagePath || "");
    if (!storagePath) throw new Error("STORAGE_PATH_REQUIRED");

    // 归属校验：私有桶路径 {userId}/{file}，只允许读取自己的文件
    if (!storagePath.startsWith(`${current.id}/`)) throw new Error("STORAGE_PATH_FORBIDDEN");

    const db = admin();
    const { data: object, error: downloadError } = await db.storage
      .from("library-pdfs")
      .download(storagePath);
    if (downloadError || !object) throw new Error("STORAGE_DOWNLOAD_FAILED");

    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("PDF_PARSE_FAILED");
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("PDF_TOO_LARGE");

    // SHA-256（hex，与网页端 crypto.subtle.digest 一致）
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    // 抽取文本层
    let text = "";
    let pageCount = 0;
    try {
      const doc = await getDocument({
        data: bytes,
        isEvalSupported: false,
        useSystemFonts: true,
        useWorkerFetch: false,
      }).promise;
      pageCount = doc.numPages;
      const pagesToRead = Math.min(pageCount, MAX_PAGES);
      const parts: string[] = [];
      for (let i = 1; i <= pagesToRead; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: { str?: string }) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (pageText) parts.push(pageText);
        page.cleanup();
      }
      await doc.destroy();
      text = parts.join("\n");
    } catch (error) {
      console.error("pdfjs extraction failed", error);
      throw new Error("PDF_PARSE_FAILED");
    }

    const normalized = text.trim();
    if (!normalized) throw new Error("TEXT_EMPTY");

    return json({ text: normalized, contentHash, pageCount }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF_EXTRACT_FAILED";
    const status =
      message === "AUTH_REQUIRED" ? 401
      : message === "STORAGE_PATH_REQUIRED" || message === "STORAGE_PATH_FORBIDDEN" ? 400
      : message === "TEXT_EMPTY" ? 422
      : 500;
    console.error("pdf-extract-text failed", message);
    return json({ error: message }, status);
  }
});
