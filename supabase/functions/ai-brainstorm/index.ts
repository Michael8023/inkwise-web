import { preflight } from "../_shared/cors.ts";
import { body, json, refund, reserve, settle } from "../_shared/core.ts";
import { complete, modelOrDefault } from "../_shared/ai.ts";

type Source = { title: string; text: string };

function clean(value: unknown, limit: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req); if (preflightResponse) return preflightResponse;
  let requestId = "", reserved = false;
  try {
    const payload = await body(req);
    requestId = clean(payload.requestId, 100) || crypto.randomUUID();
    const researchOverview = clean(payload.researchOverview, 6000);
    const rawSources = Array.isArray(payload.sources) ? payload.sources.slice(0, 6) : [];
    const sources: Source[] = rawSources.map((item) => ({ title: clean(item?.title, 500), text: clean(item?.text, 30000) })).filter((item) => item.title && item.text);
    const totalChars = sources.reduce((sum, item) => sum + item.title.length + item.text.length, 0);
    if (!researchOverview || !sources.length || totalChars > 120000) throw new Error("CONTEXT_TOO_LARGE");
    const model = modelOrDefault(clean(payload.model, 200));
    const charge = await reserve(req, "brainstorm", model, Math.max(2, Math.ceil((totalChars + researchOverview.length) / 40000)), requestId, totalChars + researchOverview.length);
    reserved = true;
    const sourceContext = sources.map((source, index) => `【文献 ${index + 1}：${source.title}】\n${source.text}`).join("\n\n---\n\n");
    const prompt = `你是严谨而富有创造力的研究协作伙伴。你的任务不是复述论文，而是将论文证据转化为服务于用户研究主线的、可检验的启发。

用户的个人工作概述（这是本次分析的优先约束）：
${researchOverview}

输入文献（只能将这里的内容当作证据；每个判断都应标注文献编号）：
${sourceContext}

请用中文输出 Markdown，并严格使用以下结构：
## 研究主线对齐
用 2–4 条解释文献与用户目标的交集、张力或缺口；每条标注文献编号。

## 可借鉴的点
给出 4–7 条具体启发。每条包含：**借鉴点**、**为何相关**、**可如何迁移**、**证据**（文献编号和原文中的方法/发现）。不要把猜测写成论文结论。

## 跨文献连接
若有多篇文献，给出 2–4 个可以组合、对照或相互验证的连接；若只有一篇，则指出其与研究主线中的关键假设如何连接。

## 下一步实验 / 调研
按“低成本验证 → 关键实验 → 风险与替代方案”给出最多 3 条可执行动作，包含预期信号或判定标准。

## 值得追问
列出 2–3 个会改变研究决策的开放问题。

规则：优先具体、可执行和可证伪的建议；清晰区分论文直接证据与推断；信息不足时明确说“文献未提供”。`;
    const result = await complete(model, [{ role: "system", content: "你只依据用户提供的研究主线和文献文本作答，不杜撰文献内容或引用。" }, { role: "user", content: prompt }], 2200);
    await settle(requestId, result.length);
    return json({ text: result, model, creditsUsed: charge.credits, creditsRemaining: charge.remaining });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_BRAINSTORM_FAILED";
    if (reserved) await refund(requestId, message);
    return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : message === "QUOTA_EXCEEDED" ? 402 : 400);
  }
});
