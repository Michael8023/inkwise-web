# AI PPT 制作配置

工作台的“AI PPT 制作”通过 Apilio 的 PPT 路由创建后台任务。浏览器不会保存或发送密钥；Supabase Edge Function 使用现有的 `APILIO_API_KEY` 请求生成服务，前端任务中心负责显示阶段、生成大纲和下载。

## 部署 Function

```bash
supabase functions deploy ai-ppt
```

## 配置密钥

需要配置 `APILIO_API_KEY`，以及可选的 `APILIO_BASE_URL`。不要将该值设置为 `VITE_*` 变量，也不要写入前端代码。

生成流程为：MinerU 版面分析 Markdown 中的表格、表题、图片替代文本和图例（优先）→ Apilio `generateOutline` → `generateContent` → 后台任务轮询 → 下载可编辑的 PPTX。

建议先对 PDF 运行“智能版面分析”。只有保存到 `layout_result.markdown` 的结果可完整保留表格结构；历史记录如没有该 Markdown，任务将回退使用 PDF 纯文本。
