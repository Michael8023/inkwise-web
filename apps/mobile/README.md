# 识谛 shidea · 移动端 App（apps/mobile）

React Native + Expo（SDK 57）实现的识谛配套手机应用，兼容网页端（inkwise.site 扩展）正在使用的 **Supabase 生产后端**：同一项目、同一批表与 RLS、同一批 Edge Functions、同一计费体系。

## 功能（MVP）

- 登录 / 注册（邮箱 6 位验证码）/ 找回密码
- 文献库：列表、搜索、筛选（待读/进行中/收藏/已归档）、文件夹、标签、收藏、归档、批量操作、重命名、移动、删除
- 导入：本地 PDF 上传、DOI / 论文链接（服务端 pdf-fetch 抓取）
- 论文详情：AI 摘要（SSE 流式生成）、笔记（跨端同步）、PDF 阅读（WebView + pdfjs，页码/缩放/搜索 + 进度双向同步）
- 我的：额度（usage 接口）、主题（浅/深）、字号、通知、反馈、退出登录

第二版：速览、AI 研究对话（单篇/多篇/自由）、系统分享导入（当前为占位页）。

## 开发

```bash
npm install                                   # 根目录安装（monorepo）
npm run dev:mobile                            # expo start（真机 Expo Go / dev build）
npm --workspace @pdf-ai-reader/mobile run typecheck
npm --workspace @pdf-ai-reader/mobile run test   # vitest 单元测试
npm --workspace @pdf-ai-reader/mobile run build:reader  # 重新生成 PDF 阅读器 HTML
```

环境变量（`apps/mobile/.env`，不入库，复制自 `.env.example`）：

```
EXPO_PUBLIC_SUPABASE_URL=https://znkrejbcjysnqopytdui.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

## 后端部署（唯一新增项）

```bash
supabase functions deploy pdf-extract-text
```

移动端本地 PDF 导入依赖该函数抽取文本与计算内容哈希（`POST {storagePath}` → `{text, contentHash, pageCount}`）；部署后请用真实 PDF 冒烟。

## 结构速览

```
src/app/            expo-router 路由（(tabs) / auth / paper/[id] / import）
src/components/ui/  组件库（core 原语 + overlay 弹层/Toast/顶栏/空态）
src/components/pdf/ WebView PDF 阅读器（html 由 scripts/build-pdf-reader.mjs 生成）
src/lib/            supabase / edge(SSE) / library / ai / auth / sse / url / errors / types
src/theme/          原型明暗主题令牌 + 设置持久化
scripts/            build-pdf-reader.mjs
```

详见 `doc/mobile-app-plan.md`。
