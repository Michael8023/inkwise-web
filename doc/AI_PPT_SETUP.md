# AI PPT 制作配置

工作台的“AI PPT 制作”使用 Apilio 已聚合的文多多（DocMee 官方格式）生成 PPT。浏览器不会保存或发送密钥；请求始终经过 Supabase Edge Function `ai-ppt`。

## 部署 Function

```bash
supabase functions deploy ai-ppt
```

## 配置密钥

无需提供新的文多多 API Key。该功能复用项目已有的 `APILIO_BASE_URL` 和 `APILIO_API_KEY`，与聊天、摘要功能一致。

如供应商的直接生成或 Markdown 生成路径与默认值不同，可额外设置：

```bash
supabase secrets set DOCMEE_DIRECT_GENERATE_PATH=/docmee/v1/api/ppt/directGeneratePptx
supabase secrets set DOCMEE_GENERATE_PPTX_PATH=/docmee/v1/api/ppt/generatePptx
```

默认路径会由 `APILIO_BASE_URL` 拼接为：

- `/docmee/v1/api/ppt/directGeneratePptx`：直接后台生成；
- `/docmee/v1/api/ppt/generateOutline`：流式生成大纲；
- `/docmee/v1/api/ppt/generateContent`：流式补全内容、异步生成 PPT；
- `/docmee/v1/api/ppt/asyncPptInfo`：查询异步任务；
- `/docmee/v1/api/ppt/generatePptx`：将 Markdown 转为 PPT。

若 Apilio 的文多多兼容路由要求不同的字段名称或路径，请只在 `supabase/functions/ai-ppt/index.ts` 中调整对应 action 的请求映射，勿把 API Key 放到 `VITE_*` 环境变量或前端代码中。
