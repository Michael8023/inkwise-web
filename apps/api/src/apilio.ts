import { createHash } from "node:crypto";

const cache = new Map<string, string>();
const sessions = new Map<string, Array<{ role: string; content: string }>>();
const documents = new Map<string, string>();

export function registerDocument(documentId: string, text: string) {
  documents.set(documentId, text);
  sessions.delete(documentId);
}

function documentText(documentId: string) {
  const text = documents.get(documentId);
  if (!text) throw new Error("AI_DOCUMENT_NOT_FOUND");
  return text;
}

function config() {
  return {
    key: process.env.APILIO_API_KEY,
    baseUrl: (
      process.env.APILIO_BASE_URL || "https://api.apilio.ai/v1"
    ).replace(/\/$/, ""),
    models: (process.env.APILIO_MODELS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    defaultModel: process.env.APILIO_DEFAULT_MODEL || "",
  };
}

export function listModels() {
  const value = config();
  const defaultModel =
    value.models.find(
      (id) => id.toLowerCase() === value.defaultModel.toLowerCase(),
    ) || value.defaultModel;
  return { models: value.models.map((id) => ({ id, name: id })), defaultModel };
}

async function complete(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1200,
) {
  const value = config();
  if (!value.key) throw new Error("APILIO_NOT_CONFIGURED");
  if (!model) throw new Error("APILIO_MODEL_REQUIRED");
  const response = await fetch(`${value.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${value.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.choices?.[0]?.message?.content)
    throw new Error(
      payload.error?.message || `APILIO_REQUEST_FAILED_${response.status}`,
    );
  return payload.choices[0].message.content;
}

export async function generateSummary(input: {
  documentId: string;
  kind: "short" | "full";
  model: string;
}) {
  const text = documentText(input.documentId);
  const key = createHash("sha256")
    .update(`${input.documentId}:${input.kind}:${input.model}:${text}`)
    .digest("hex");
  const cached = cache.get(key);
  if (cached) return { text: cached, cached: true };
  const instruction =
    input.kind === "short"
      ? "请用中文输出严格三条要点，每条一句话，概括文档的研究问题、方法和主要结论。不要添加文档中没有的信息。"
      : "请用中文生成结构化全文摘要，覆盖研究问题、背景、方法、实验/论证、结果、局限性和结论。使用清晰的小标题。";
  const result = await complete(
    input.model,
    [
      {
        role: "system",
        content: "你是严谨的学术论文阅读助手。只根据用户提供的文档内容回答。",
      },
      {
        role: "user",
        content: `${instruction}\n\n文档内容：\n${text.slice(0, 120000)}`,
      },
    ],
    input.kind === "short" ? 500 : 1800,
  );
  cache.set(key, result);
  return { text: result, cached: false };
}

export async function explainSelection(input: {
  documentId: string;
  text: string;
  context: string;
  pageNumber: number;
  model: string;
}) {
  const text = documentText(input.documentId);
  return complete(
    input.model,
    [
      {
        role: "system",
        content:
          "你是帮助读者理解论文的阅读伙伴。你的首要任务是用通俗、自然的简体中文说明选中句子在本文语境中究竟想表达什么，而不是逐词翻译或讲语法。先结合全文判断文章主题、作者的核心观点和当前段落的讨论对象，再结合选区附近上下文解释该句的含义、关键术语或指代、以及它对当前论证的作用。除非用户明确询问，否则不要做主谓宾、时态等语法分析。不要编造文档中没有的信息。用简短 Markdown 输出，可按“通俗解释”“放回上下文看”组织，避免复述原句。",
      },
      {
        role: "user",
        content: `全文内容（用于把握文章主题；可能被截断）：\n${text.slice(0, 120000)}\n\n页码：${input.pageNumber}\n\n选区附近上下文（优先依据这一部分）：\n${input.context}\n\n需要解释的句子：\n${input.text}`,
      },
    ],
    900,
  );
}

export async function chat(input: {
  sessionId: string;
  documentId: string;
  question: string;
  model: string;
}) {
  const text = documentText(input.documentId);
  const history = sessions.get(input.sessionId) || [];
  const messages = [
    {
      role: "system",
      content: `你是 PDF 文档问答助手。只能根据以下文档内容回答，无法验证时明确说明。\n\n文档内容：\n${text.slice(0, 120000)}`,
    },
    ...history.slice(-8),
    { role: "user" as const, content: input.question },
  ];
  const answer = await complete(input.model, messages, 1200);
  sessions.set(
    input.sessionId,
    [
      ...history,
      { role: "user", content: input.question },
      { role: "assistant", content: answer },
    ].slice(-12),
  );
  return { answer, sessionId: input.sessionId };
}
