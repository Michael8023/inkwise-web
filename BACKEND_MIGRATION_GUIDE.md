# 墨知 Inkwise 后端迁移与接口手册

本文用于把当前项目迁移到新的正式 Linux 后端服务器。当前代码仍在开发阶段，文档明确区分已实现接口和待实现接口。

## 1. 当前架构

```text
浏览器扩展 / Vite 前端
        | HTTPS /v1
Nginx 或 Caddy
        |
Node.js Fastify API :8787
        |
PostgreSQL
        |
Resend + 百度翻译 + Apilio + S3/OSS（待接入）
```

PDF 原文目前由 PDF.js 在浏览器端提取。当前 AI 上下文仍使用 API 进程内存缓存；正式迁移后必须改为数据库或对象存储中的 `papers.extracted_text`，否则 API 重启会丢失上下文。

## 2. 已完成接口

所有接口前缀均为 `/v1`。除特别说明外，成功响应为 JSON，失败响应格式为：

```json
{ "error": "ERROR_CODE" }
```

### 系统

#### `GET /health`

无需认证。用于部署检查。

成功响应：

```json
{ "ok": true, "service": "pdf-ai-reader-api", "version": "0.1.0" }
```

#### `GET /models`

无需认证。返回 `.env` 中配置的 Apilio 模型和默认模型。

### 认证

#### `POST /auth/register`

当前实现会创建待验证用户并发送验证码。请求：

```json
{
  "email": "user@example.com",
  "username": "inkreader",
  "displayName": "墨知用户",
  "password": "至少 10 位的密码"
}
```

成功响应：

```json
{ "pendingVerification": true, "email": "user@example.com" }
```

当前用户名会写入 `users.username`，邮箱和用户名均应唯一。验证码发送依赖 `RESEND_API_KEY` 和 `RESEND_FROM_EMAIL`。

#### `POST /auth/verify-email`

请求：

```json
{ "email": "user@example.com", "code": "123456" }
```

验证码有效期 10 分钟，最多尝试 5 次。成功响应：

```json
{ "ok": true }
```

#### `POST /auth/login`

请求：

```json
{ "email": "user@example.com", "password": "用户密码" }
```

只有邮箱已验证且用户状态为 `active` 时允许登录。当前实现返回 JWT；正式版本需要改为短时 access token + 可撤销 refresh token。

#### `GET /auth/me`

请求头：

```text
Authorization: Bearer <access-token>
```

返回当前用户身份。未登录返回 `401 AUTH_REQUIRED`。

### 论文库基础接口

以下接口必须携带 Bearer token，且所有 SQL 查询必须使用 token 中的用户 ID 做权限过滤。

#### `GET /library/papers?q=关键词`

返回当前用户未删除的论文，按最近打开时间排序。

#### `POST /library/papers`

当前用于创建论文元数据，尚未上传对象存储文件。请求：

```json
{
  "title": "论文标题",
  "sourceType": "local",
  "sourceUrl": null,
  "extractedText": "可选的 PDF 文本",
  "contentHash": "可选 SHA-256"
}
```

`sourceType` 只允许 `local` 或 `url`。

#### `GET /library/papers/:paperId`

返回当前用户拥有的论文详情。其他用户的论文必须返回 `404 PAPER_NOT_FOUND`，不能泄露其存在。

#### `POST /library/papers/:paperId/open`

保存阅读进度：

```json
{ "pageNumber": 4, "progress": 0.32, "scale": 1.2 }
```

#### `DELETE /library/papers/:paperId`

当前执行软删除，后续需要增加 30 天恢复和最终清理任务。

### 当前临时 AI 接口

#### `POST /ai/documents`

请求：

```json
{ "documentId": "文档 ID", "text": "全文文本" }
```

当前只写入进程内存，是迁移前的临时接口。正式版本必须改为 `paperId` 并从数据库加载全文。

#### `POST /ai/summary`

```json
{ "documentId": "文档 ID", "kind": "short", "model": "模型 ID" }
```

`kind` 为 `short` 或 `full`。当前摘要结果还没有由 AI 路由自动写入 `paper_summaries`，前端临时调用保存接口。

#### `POST /ai/explain`

```json
{
  "documentId": "文档 ID",
  "text": "选中的句子",
  "context": "附近上下文",
  "pageNumber": 3,
  "model": "模型 ID"
}
```

#### `POST /ai/chat`

```json
{
  "sessionId": "聊天会话 ID",
  "documentId": "文档 ID",
  "question": "用户问题",
  "model": "模型 ID"
}
```

当前聊天历史仍在内存中，正式迁移需要改为 `chat_threads` 和 `chat_thread_messages`。

#### `POST /translate`

```json
{
  "text": "原文",
  "sourceLanguage": "auto",
  "targetLanguage": "zh"
}
```

只调用百度翻译，不经过 Apilio。

## 3. 待完成接口

### 认证与用户

- `POST /auth/refresh`：刷新并轮换 refresh token。
- `POST /auth/logout`：撤销当前 session。
- `POST /auth/resend-verification`：重新发送验证码，并限制频率。
- `POST /auth/forgot-password`、`POST /auth/reset-password`。
- `GET/PATCH /me/profile`：用户名、显示名、头像。
- `POST /me/avatar`：上传头像到对象存储。
- `GET /me/sessions`、`DELETE /me/sessions/:id`。

### Library

- `POST /library/papers/:paperId/upload`：生成 S3/OSS 预签名上传地址。
- `POST /library/papers/:paperId/ingest-url`：安全抓取 URL 并异步解析。
- `GET /library/papers/:paperId/content`：鉴权后返回文本或分页文本。
- `PATCH /library/papers/:paperId`：标题、标签、笔记。
- `POST/DELETE /library/papers/:paperId/share`：生成或撤销私有分享链接。
- `GET /library/share/:publicId`：仅分享开启时返回论文公开元数据。
- `GET /library/papers/:paperId/state`：统一恢复阅读进度、摘要、聊天、高亮。

### AI 持久化

- 摘要生成成功后由后端事务写入 `paper_summaries`。
- 每次对话写入独立 `chat_thread_messages`，不与划词解释共享历史。
- 明确选择高亮颜色后写入 `paper_annotations`；普通划词不写入。
- 解释/翻译完成后更新对应标注记录。

## 4. 新服务器迁移步骤

### 安装系统依赖

在新服务器执行：

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib nginx ufw
```

Node.js 使用 Node 22 LTS，建议通过 nvm 安装。应用不要使用 root 运行。

### 创建数据库

```bash
sudo -u postgres createuser --pwprompt inkwise
sudo -u postgres createdb -O inkwise inkwise
psql "$DATABASE_URL" -f apps/api/db/migrations/001_users_and_reader_data.sql
psql "$DATABASE_URL" -f apps/api/db/migrations/002_library_auth_v2.sql
psql "$DATABASE_URL" -f apps/api/db/migrations/003_paper_state_and_sharing.sql
```

迁移必须按顺序执行。正式部署前需修订迁移脚本，使新库和已有旧库都能幂等执行。

### 环境变量

复制 `apps/api/.env.example` 为 `apps/api/.env`，填写：

```env
PORT=8787
DATABASE_URL=postgresql://inkwise:<password>@127.0.0.1:5432/inkwise
JWT_SECRET=<至少 32 位随机值>
RESEND_API_KEY=<Resend Key>
RESEND_FROM_EMAIL=Inkwise <noreply@你的域名>
BAIDU_TRANSLATE_API_KEY=
BAIDU_TRANSLATE_SECRET_KEY=
APILIO_API_KEY=
APILIO_BASE_URL=https://api.apilio.ai/v1
APILIO_DEFAULT_MODEL=
APILIO_MODELS=
```

`.env` 不得提交 Git，不得出现在前端构建产物中。

### 启动验证

```bash
npm ci
npm --workspace apps/api run build
npm --workspace apps/api run dev
curl http://127.0.0.1:8787/health
```

生产环境使用 systemd，配置 `Restart=always`，并让 Nginx/Caddy 将 HTTPS 域名反向代理到 `127.0.0.1:8787`。只开放 `22`、`80`、`443`，数据库端口不对公网开放。

### 前端切换

开发环境继续使用 Vite `/v1` 代理。生产环境新增 `VITE_API_BASE_URL=https://api.你的域名`，所有请求通过统一 API client 发送，并自动附加 access token。不要把数据库、Resend、百度或 Apilio 密钥放入 `apps/extension`。

## 5. 验收清单

- 未验证邮箱不能登录。
- 同一邮箱和用户名不能重复。
- 用户 A 无法读取用户 B 的论文、摘要、聊天、高亮或阅读记录。
- 本地 PDF 和 URL 论文都能创建 Library 记录。
- 重复添加同一内容按内容哈希去重。
- 论文删除后相关 AI 数据按外键级联或进入软删除恢复区。
- 普通划词不会生成持久标注。
- 显式高亮可在刷新、重新登录和跨设备恢复。
- 摘要、聊天和阅读进度可自动恢复。
- 私有分享关闭后旧链接立即失效。
- URL 抓取无法访问内网、回环地址和云元数据地址。
- 验证码、密码、JWT 和 API Key 不写入日志。
- 数据库备份可以恢复用户论文库和阅读历史。

## 6. 当前明确缺口

当前仓库已经有基础认证、数据库迁移、论文 CRUD 和临时 AI 接口，但以下内容仍未完成：Resend 生产配置验证、refresh token、对象存储、URL 抓取、完整分享路由、Library 前端页面、AI 路由直接持久化、统一 paperId 迁移、Redis、限流、备份和生产 HTTPS。迁移服务器前不要把当前接口直接当作生产 API 合约。
