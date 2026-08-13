import { preflight } from "../_shared/cors.ts";
import { body, json, refund, reserve, settle } from "../_shared/core.ts";
import { completeVision, modelOrDefault } from "../_shared/ai.ts";

Deno.serve(async req => {
  const cors = preflight(req); if (cors) return cors;
  let requestId = "", reserved = false;
  try {
    const input = await body(req);
    const kind = String(input.kind || "explain");
    const imageDataUrl = String(input.imageDataUrl || "");
    const pageContext = String(input.pageContext || "").slice(0, 12000);
    const documentContext = String(input.documentContext || "").slice(0, 30000);
    const previousExplanation = String(input.previousExplanation || "").slice(0, 12000);
    const question = String(input.question || "").slice(0, 2000);
    requestId = String(input.requestId || crypto.randomUUID());
    if (!['explain','table'].includes(kind)) throw new Error("VISUAL_KIND_INVALID");
    if (!/^data:image\/(jpeg|png);base64,/.test(imageDataUrl) || imageDataUrl.length > 6_000_000) throw new Error("IMAGE_INVALID");
    const model = modelOrDefault(String(input.model || ""));
    const feature = kind === "table" ? "table_extract" : "figure_explain";
    const charge = await reserve(req, feature, model, kind === "table" ? 3 : 2, requestId, pageContext.length + documentContext.length);
    reserved = true;
    const task = question
      ? `用户正在追问你对该图表的上一轮解释。结合图像、论文语境和上一轮解释回答问题；如果图像或论文没有足够信息，请明确说明。\n\n上一轮解释：\n${previousExplanation}\n\n用户追问：\n${question}`
      : kind === "table"
      ? "识别框选区域中的表格。准确转写单元格，保留表头、层级、数值、单位和脚注；主要输出可复制的 Markdown 表格。无法辨认的单元格用 [?]，不要编造。表格后用两三句话概括关键趋势。"
      : "识别框选区域是图片、图表、流程图、公式、伪代码还是其他内容。先简述它展示了什么，再结合论文语境通俗解释坐标轴、图例、变量、关键趋势或步骤，以及它对论文论点的作用。不要仅做视觉描述，也不要编造不可见信息。";
    const prompt = `你是严谨的中文学术论文视觉阅读助手。无论论文、图中文字或用户问题使用什么语言，你的解释、分析、总结和追问回答都必须使用简体中文。专业术语首次出现时可以在中文后保留必要的英文原文，但不得整段使用英文回答。\n\n任务：\n${task}\n\n当前页文字：\n${pageContext}\n\n论文背景：\n${documentContext}\n\n再次强调：最终回答必须使用自然、通俗、准确的简体中文。`;
    const text = await completeVision(model, prompt, imageDataUrl, kind === "table" ? 2200 : 1600);
    await settle(requestId, text.length);
    return json({ text, model, creditsUsed: charge.credits, creditsRemaining: charge.remaining });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_VISUAL_FAILED";
    if (reserved) await refund(requestId, message);
    const status = message === "AUTH_REQUIRED" ? 401 : message === "QUOTA_EXCEEDED" ? 402 : 400;
    return json({ error: message }, status);
  }
});
