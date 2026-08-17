# AI PPT 制作配置

工作台的“AI PPT 制作”使用文多多官方 **UI iframe V2（Agent 精美设计）**。浏览器不会保存或发送密钥；Edge Function 仅为当前登录用户签发短期 Docmee token，随后由官方创作器完成大纲、模板选择、编辑与下载。

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

前端在进入创作器前会要求用户核验提取文本；它会把资料和“不得改写实验数据”的约束传给 V2 创作器。Docmee 对最终生成的 PPT 按其平台积分规则收费。
