# 🎯 Sci-Hub 镜像接入 - 快速参考

## ✅ 已完成的工作

### 1. 后端实现 (supabase/functions/pdf-fetch/index.ts)
- ✅ `getAvailableScihubMirrors()` - 从 sci-hub.shop 实时获取镜像列表
- ✅ `tryScihub(doi)` - 遍历镜像尝试下载 PDF
- ✅ 集成到主 DOI 解析流程（出版商 → Unpaywall → Sci-Hub）
- ✅ 完整的安全验证（DNS、地址过滤、文件验证）

### 2. 前端更新 (apps/extension/src/main.tsx)
- ✅ 更新错误提示，说明已尝试 Sci-Hub
- ✅ 更新导入对话框帮助文本

### 3. 文档
- ✅ `SCIHUB_INTEGRATION.md` - 完整技术文档
- ✅ `TEST_SCIHUB.md` - 测试指南
- ✅ `doc/scihub-feature-summary.md` - 功能总结
- ✅ `README.md` - 更新主文档

## 🚀 如何测试

### 方法 1：在应用中测试
```bash
# 1. 启动应用
npm run dev:extension

# 2. 打开浏览器，点击"导入论文链接"

# 3. 测试以下 DOI：
# 开放获取（应该从 Unpaywall 获取）
10.1371/journal.pone.0230430

# 付费论文（会使用 Sci-Hub）
10.1038/nature.2015.17120
```

### 方法 2：测试 Edge Function
```bash
# 如果使用 Supabase
supabase functions deploy pdf-fetch
supabase functions logs pdf-fetch --follow
```

## 📋 工作流程

```
用户输入: https://doi.org/10.xxxx/xxx
           或 10.xxxx/xxx
    ↓
① 尝试出版商官网
    ↓ 失败
② 查询 Unpaywall (合法 OA)
    ↓ 失败
③ 获取 Sci-Hub 镜像列表
    从 https://www.sci-hub.shop/
    ↓
④ 遍历镜像尝试下载
    sci-hub.se → sci-hub.st → sci-hub.ru → ...
    ↓
   ✅ 成功 → 打开 PDF
   ❌ 失败 → 提示用户手动下载
```

## 🔐 安全特性

- ✅ DNS 验证（防重绑定）
- ✅ 拒绝内网地址（localhost, 192.168.x.x, 10.x.x.x 等）
- ✅ 协议限制（仅 HTTP/HTTPS）
- ✅ PDF 文件头验证（%PDF）
- ✅ 文件大小限制（40MB）
- ✅ 超时控制（8-15秒）
- ✅ 速率限制

## 📊 预期性能

| 来源 | 响应时间 | 成功率 |
|------|----------|--------|
| 出版商 | 2-5秒 | 30-40% |
| Unpaywall | 3-8秒 | 40-50% |
| Sci-Hub | 5-15秒 | 70-80% |
| **总体** | **10-30秒** | **80%+** |

## 🎨 用户看到什么

### 导入对话框
```
┌──────────────────────────────────────┐
│  导入论文链接                         │
│                                      │
│  [输入框: doi.org/10.xxxx/...]       │
│                                      │
│  [在当前页面打开 →]                   │
│                                      │
│  💡 DOI 解析会先尝试出版商官方渠道，    │
│     再查询 Unpaywall 等开放获取资源，  │
│     最后尝试 Sci-Hub 实时镜像。        │
└──────────────────────────────────────┘
```

### 失败提示
```
❌ 该 DOI 对应的 PDF 暂时无法获取。
   我们已尝试出版商官方渠道、Unpaywall 
   开放获取资源以及 Sci-Hub 镜像，但均未成功。
   请尝试通过机构访问或手动下载后导入。
```

## 🔧 核心代码片段

### 获取镜像列表
```typescript
const response = await fetch("https://www.sci-hub.shop/");
const html = await response.text();
const linkPattern = /https?:\/\/sci-?hub\.[a-z]{2,}/gi;
const mirrors = [...new Set(html.match(linkPattern))];
```

### 从 Sci-Hub 下载
```typescript
for (const mirror of mirrors) {
  const scihubUrl = `${mirror}/${doi}`;
  const pageResponse = await fetch(scihubUrl);
  const html = await pageResponse.text();
  
  // 解析 PDF 链接 (iframe/link/button)
  const pdfPath = extractPdfPath(html);
  const pdfResponse = await fetch(pdfUrl);
  
  if (pdfResponse.ok && isPdf(pdfResponse)) {
    return pdfResponse; // 成功！
  }
}
```

## 📚 相关文档

- 📘 **技术细节**: [SCIHUB_INTEGRATION.md](./SCIHUB_INTEGRATION.md)
- 🧪 **测试指南**: [TEST_SCIHUB.md](./TEST_SCIHUB.md)
- 📊 **功能总结**: [doc/scihub-feature-summary.md](./doc/scihub-feature-summary.md)
- 📖 **项目说明**: [README.md](./README.md)

## ⚖️ 法律与合规

- ⚠️ Sci-Hub 在某些地区存在法律争议
- ✅ 系统优先使用合法渠道
- ✅ Sci-Hub 仅作最后备选
- ℹ️ 用户界面已明确告知使用来源

## 🎯 下一步建议

### 立即可做
1. 在本地测试几个 DOI
2. 查看 Edge Function 日志
3. 检查网络请求是否正常

### 短期优化
1. 添加镜像缓存（15-30分钟）
2. 记录各来源成功率
3. 优化超时时间

### 长期改进
1. 并行尝试多个镜像
2. 智能镜像排序
3. 添加更多论文来源

## 💡 提示

- 📱 建议优先测试开放获取的 DOI，确保基础流程正常
- 🔍 使用浏览器开发者工具查看网络请求
- 📊 监控 Edge Function 日志了解实际执行情况
- 🐛 如遇问题，查看 `TEST_SCIHUB.md` 的排查指南

---

**功能状态**: ✅ 已实现并可测试  
**最后更新**: 2026-08-15  
**需要帮助?** 查看详细文档或联系开发团队
