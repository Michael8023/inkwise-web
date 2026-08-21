// AI 相关 Edge Function 调用。MVP：models / usage / ai-summary（SSE）/ pdf-extract-text。
import { edgeJson, streamEdge } from "./edge";
import { uuid } from "./uuid";
import type { ExtractResult, ModelsResponse, UsageResponse } from "./types";

export async function fetchModels(): Promise<ModelsResponse> {
  return edgeJson<ModelsResponse>("models");
}

// 模型列表缓存：取 defaultModel 供摘要生成使用（与网页端一致，避免传无效模型 ID）
let defaultModelPromise: Promise<string> | null = null;
export function getDefaultModel(): Promise<string> {
  if (!defaultModelPromise) {
    defaultModelPromise = fetchModels()
      .then((result) => result.defaultModel)
      .catch(() => "");
  }
  return defaultModelPromise;
}

export async function fetchUsage(): Promise<UsageResponse> {
  return edgeJson<UsageResponse>("usage");
}

export interface SummaryHandlers {
  onDelta: (text: string) => void;
  onDone?: (full: string) => void;
  onError?: (message: string) => void;
}

/** 生成论文摘要（SSE）。documentText 最大 120k 字符，与网页端一致。 */
export function generatePaperSummary(
  kind: "short" | "full",
  documentText: string,
  model: string,
  handlers: SummaryHandlers,
): { close: () => void } {
  const requestId = uuid();
  let full = "";
  const handle = streamEdge(
    "ai-summary",
    { kind, documentText: documentText.slice(0, 120000), model, requestId },
    {
      onDelta: (delta) => {
        full += delta;
        handlers.onDelta(delta);
      },
      onDone: () => handlers.onDone?.(full),
      onError: (message) => handlers.onError?.(message),
    },
  );
  return handle;
}

/**
 * 本地 PDF 导入：服务端 Edge Function 读取存储对象，
 * 抽取文本层并计算 SHA-256（与网页端 WebCrypto 结果一致，用于去重）。
 */
export async function extractPdfText(storagePath: string): Promise<ExtractResult> {
  return edgeJson<ExtractResult>("pdf-extract-text", { storagePath });
}

/** 生成文档上下文：优先用已入库 document_text，否则回退空串（阅读不受影响） */
export function documentContext(paper: { document_text?: string | null }): string {
  return paper.document_text || "";
}
