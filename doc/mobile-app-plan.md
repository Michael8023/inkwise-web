# 识谛 shidea 手机端 App 开发计划与实现说明

> 状态：Phase 1-3 主体已实现（工程骨架 / 文献库 / 导入 / 论文详情 / 认证 / 我的），待真机联调（Phase 5）。
> 本文件沉淀计划、关键决策与后端契约，作为后续迭代的基准。

## 1. 目标

开发识谛配套手机 App（iOS + Android 双端，React Native + Expo），**完全兼容当前网页端（inkwise.site 识谛扩展）正在使用的 Supabase 生产后端**：同一项目 `znkrejbcjysnqopytdui.supabase.co`、同一批表与 RLS、同一批 Edge Functions、同一计费体系。界面以 `doc/shidea-mobile-prototype.html` 为蓝本。

## 2. 范围

**MVP（已实现主体）**：登录/注册（邮箱验证码）/找回密码 + 文献库（列表/搜索/筛选/文件夹/标签/收藏/归档/批量/重命名/移动/删除）+ 导入（本地 PDF 上传、DOI/URL）+ 论文详情（摘要生成与展示、笔记、PDF 阅读与进度同步）+ 我的（研究主线只读、额度、设置、反馈）。

**第二版（占位页）**：速览（AI 摘要流）、AI 研究（单篇/多篇/自由对话 + 会话历史）、系统分享导入、朗读、图表识别、AI PPT。

## 3. 技术栈

- Expo SDK 57（React 19.2 / RN 0.86 / expo-router 57），workspace `apps/mobile`。
- `@supabase/supabase-js`：会话持久化（AsyncStorage）+ 自动刷新 + 直连表（与网页端同构）。
- `react-native-sse`：Edge Function 的 SSE 流式读取（ai-summary / ai-chat 等）。
- `react-native-webview` + **内联 pdfjs-dist**：PDF 阅读器（零原生模块风险、Expo Go 可用、与网页端同版 pdfjs 4.10.38）。
- `expo-document-picker`（选 PDF）、`expo-file-system`（DOI 导入写临时文件）。
- `@tanstack/react-query` + `zustand`；组件库自建（`src/components/ui`），设计令牌对齐原型明暗双主题。

## 4. 后端兼容要点（已核实）

- 认证：`request-signup-code` → `complete-signup` → `supabase.auth.signInWithPassword`；找回密码走 `request-password-reset` / `reset-password`。
- 表（RLS 保护）：`library_papers`、`library_folders`、`library_tags`、`library_paper_tags`、`library_paper_states`、`research_profiles`、`user_feedback`、`user_entitlements`、`usage_ledger`、`paper_summaries`。
- 存储：私有桶 `library-pdfs`（50MB、仅 PDF），路径 `{userId}/{uuid}.pdf`；读取用签名 URL。
- Edge Functions：`ai-summary`（SSE）、`models`、`usage`、`pdf-fetch`（DOI/URL→PDF 二进制）、`pdf-extract-text`（**本工程新增**）。
- RPC：`save_library_paper_state(paper_id, reader_state, layout_result, updated_at)`（版本化防乱序）。

## 5. 关键决策

1. **内容哈希与文本抽取放服务端**：新增 `supabase/functions/pdf-extract-text`——服务端读存储对象，计算 SHA-256（与网页端 WebCrypto 结果一致，去重语义相同）并抽取文本层（pdfjs legacy，不渲染）。移动端无需原生加密模块。Phase 0 已用仓库内样例 PDF（28 页）在 Node 验证抽取算法；Deno 部署后需在真实 Supabase 环境冒烟（风险点：DOMMatrix polyfill 已内置兜底）。
2. **PDF 阅读器用 WebView + 内联 pdfjs**：`scripts/build-pdf-reader.mjs` 生成自包含 HTML（pdf.min.mjs + worker 内联），postMessage 桥接页码/缩放/搜索与进度保存。避开 `react-native-pdf`（依赖 react-native-blob-util，与 RN 0.86 兼容性存疑）。
3. **笔记存 `library_paper_states.reader_state.notes`**：后端 `paper_notes` 表（迁移 002）未启用 RLS（不安全且网页端未使用），因此 MVP 笔记写入 RLS 保护且带版本控制的 reader_state JSON，保证跨端同步与安全，零后端改动。
4. **文件大小**：`library_papers.file_size` 有 `>0` 约束，导入必须传真实字节数。
5. **错误映射**：`src/lib/errors.ts` 统一 Edge Function 错误码 → 中文文案（AUTH_REQUIRED/QUOTA_EXCEEDED/RATE_LIMITED 等）。

## 6. 代码结构（apps/mobile/src）

```
app/                     expo-router 路由（(tabs) 四 Tab / auth / paper/[id] / import）
components/ui/           组件库（core.tsx 原语 + overlay.tsx 弹层/Toast/顶栏/空态）
components/pdf/          WebView PDF 阅读器（pdfReaderHtml.generated.ts 由构建脚本生成）
components/auth/         AuthShell
lib/                     supabase.ts / edge.ts（SSE+401重试）/ library.ts / ai.ts / auth.ts / errors.ts / types.ts / uuid.ts
stores/                  session.ts / toast.ts
theme/                   tokens.ts（原型明暗令牌）/ ThemeProvider.tsx
scripts/                 build-pdf-reader.mjs
```

## 7. 开发命令

```bash
npm install                                  # 根目录安装全部 workspace
npm run dev:mobile                           # expo start（真机 Expo Go / dev build）
npm --workspace @pdf-ai-reader/mobile run typecheck   # TS 检查
npm --workspace @pdf-ai-reader/mobile run build:reader # 重新生成 PDF 阅读器 HTML
```

环境变量（apps/mobile/.env，不入库，已从生产值生成）：
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`。

## 8. 后端部署（唯一新增项）

```bash
supabase functions deploy pdf-extract-text
```

契约：`POST { storagePath }` → `{ text, contentHash, pageCount }`；错误码 `AUTH_REQUIRED` / `STORAGE_PATH_FORBIDDEN` / `STORAGE_DOWNLOAD_FAILED` / `PDF_PARSE_FAILED` / `TEXT_EMPTY`(422，扫描件) / `PDF_TOO_LARGE`。

## 9. 测试与验收

**已实现单元测试（vitest，`npm --workspace @pdf-ai-reader/mobile run test`，39 例全绿）**：
- `sse.test.ts`：SSE 帧解析（delta/done/error/非法帧）+ HTTP 错误体错误码提取。
- `edge.test.ts`（mock EventSource）：delta 累积与 done 元信息、error 帧、HTTP 错误体提取、401 刷新后重连一次、刷新失败报 AUTH_REQUIRED、close 语义。
- `errors.test.ts`：错误码→中文文案映射（含带附加信息码 `DOI_PDF_NOT_AVAILABLE:...` 的冒号截取、`PDF_UPSTREAM_*` 前缀回退）、toAppError 回退。
- `tokens.test.ts`：阅读进度计算、文件大小/相对时间/来源格式化（与网页端语义一致）。
- `url-uuid.test.ts`：UUID v4 合法性、DOI/URL 规范化与 DOI 链接识别。
- `status.test.ts`：阅读状态判定（待读/进行中/已读，含 markedRead 标记）。

**生产后端集成验证（真实调用）**：`pdf-fetch` 匿名抓取 arXiv PDF 成功（HTTP 200、application/pdf、5.5MB、9 页有效），确认移动端 DOI/URL 导入链路的核心外部依赖可用。

**阅读器构建验证**：`node --check` + Node DOM 桩运行时冒烟，确认内联 module 无标识符冲突、模块初始化无异常。

**改进记录**：
- `edge.ts` 流式错误路径读取 HTTP 错误响应体（`QUOTA_EXCEEDED` 等展示准确文案）；SSE 帧解析抽为纯函数 `src/lib/sse.ts`。
- 上传改为按 storage-js 官方 RN 指引直接传字节（`{uri,name,type}` 对象在 RN 下不可用）；重复导入/入库失败时清理已上传的存储对象。
- PDF 翻页进度保存与已有 `reader_state` 合并，避免覆盖 `notes`/`markedRead`。
- "标记为已读/待读"使用 `markedRead` 标记，无 `page_count` 的文献也能正确显示状态；`paperStatus` 抽为纯函数 `src/lib/status.ts`。
- WebView 阅读器仅在 `dataUrl` 变化时加载（初始页码 ref 捕获），避免进度更新导致滚动位置重置。
- 阅读器内联 JS 助手统一 `sd_` 前缀，规避 pdf.min.mjs 内部 `$` 标识符冲突。
- 错误文案扩充：登录（INVALID_CREDENTIALS / EMAIL_NOT_CONFIRMED）、DOI/PDF 抓取（URL_NOT_ALLOWED / NOT_A_PDF / DOI_PDF_NOT_AVAILABLE 等）、`PDF_UPSTREAM_*` 前缀回退；错误码带附加信息时按冒号前部分匹配。
- 详情页 PDF 加载加 ref 守卫，避免文献列表后台刷新触发重复下载与 WebView 重载。

**待真机执行的手工回归**：注册→验证码→登录→登出；登录态跨重启；网页端文献在手机端一致；阅读进度双向同步；收藏/归档/重命名/删除双向同步；上传新 PDF 网页端可见；DOI 导入；401/额度不足中文提示。

**兼容性**：不改动任何现有表结构与 RLS；回归网页端主流程确认互不破坏。
