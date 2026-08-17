# AI PPT 制作配置

工作台的“AI PPT 制作”通过文多多 API 一体化生成，不嵌入文多多 iframe。浏览器不会保存或发送密钥；Supabase Edge Function 只代表当前登录用户请求文多多，前端负责资料核验、模板选择和下载。

## 部署 Function

```bash
supabase functions deploy ai-ppt
```

## 配置密钥

在文多多开放平台创建 API Key 后设置为 Supabase secret：

```bash
supabase secrets set DOCMEE_API_KEY=你的文多多开放平台_API_KEY
```

不要将该值设置为 `VITE_*` 变量，也不要写入前端代码。函数会以 `pdf-ai-reader:<Supabase user id>` 作为 Docmee `uid`，从而隔离每位用户的作品与自定义模板。

生成流程为：MinerU 版面分析 Markdown（含表格、图注和流程）→ 用户核验与编辑 → 选择模板 → 文多多 `generatePptx` → `downloadPptx` 下载可编辑的 PPTX。前端会把“不得改写实验数据、每个 Markdown 表格保留为表格或图表、流程生成可编辑流程图”的约束一并发送。

建议先对 PDF 运行“智能版面分析”。只有保存到 `layout_result.markdown` 的结果可完整保留表格结构；历史记录如没有该 Markdown，需要重新分析一次。文多多按其平台积分规则对成功生成的 PPT 收费（通常为每份成品扣 1 积分，以其控制台当前规则为准）。
