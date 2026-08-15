# 📋 插件 DOI 导入功能 Debug 总结

## 🎯 问题

用户反馈：**插件在导入 DOI 链接时报错"无法读取该 PDF 链接"**，但网站版本可以正常使用 Sci-Hub 镜像功能。

## 🔍 根本原因

Edge Function (`pdf-fetch`) 要求用户必须登录，但插件的错误处理存在以下问题：

1. **Session token 过期时显示通用错误** - 用户看到 "无法读取该 PDF 链接"，无法判断是认证问题还是 PDF 真的不可用
2. **没有自动刷新机制** - Token 过期后需要用户手动退出重新登录
3. **错误提示不够明确** - 所有失败都归结为一个通用错误消息

## ✅ 实施的修复

### 1. 改进错误提示 (`main.tsx`)

**新增错误消息**：
```typescript
SESSION_EXPIRED: "您的登录已过期，请重新登录后再试。",
DOI_RESOLVE_FAILED: "DOI 解析失败，请检查链接是否正确。",
PDF_URL_FETCH_FAILED: "PDF 获取失败，请检查链接或稍后重试。",
```

**增强错误检测**：
```typescript
if (!response.ok) {
  const result = await response.json().catch(() => ({}));
  const errorCode = result.error || "DOI_RESOLVE_FAILED";
  
  // 特别处理认证错误
  if (errorCode === "AUTH_REQUIRED" || response.status === 401) {
    throw new Error("SESSION_EXPIRED");
  }
  
  throw new Error(errorCode);
}
```

### 2. 自动 Token 刷新 (`api.ts`)

```typescript
export async function functionRequest(functionName: string, init: RequestInit = {}) {
  // 获取当前 session
  const { data, error: sessionError } = await supabase.auth.getSession();
  
  if (sessionError || !data.session) {
    throw new Error("AUTH_REQUIRED");
  }
  
  const response = await fetch(...);
  
  // 🆕 如果收到 401，自动刷新 token 并重试一次
  if (response.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    
    if (refreshed.session) {
      // 使用新 token 重试
      headers.set("Authorization", `Bearer ${refreshed.session.access_token}`);
      return await fetch(...);
    }
    
    throw new Error("AUTH_REQUIRED");
  }
  
  return response;
}
```

### 3. 版本更新

- 插件版本: `0.1.7` → `0.1.8`
- 重新构建完成

## 📁 修改的文件

| 文件 | 修改内容 | 行数 |
|------|----------|------|
| `apps/extension/src/main.tsx` | 新增错误消息 | 334-341 |
| `apps/extension/src/main.tsx` | DOI 解析错误处理 | 1716-1730 |
| `apps/extension/src/main.tsx` | PDF URL 错误处理 | 1734-1749 |
| `apps/extension/src/api.ts` | 自动 token 刷新 | 整个函数 |
| `apps/extension/public/manifest.json` | 版本号更新 | 3 |

## 📊 预期改进

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 错误提示清晰度 | ❌ 通用错误 | ✅ 具体错误类型 |
| Session 过期处理 | ❌ 需手动重新登录 | ✅ 自动刷新 + 清晰提示 |
| 用户体验 | ⭐⭐ | ⭐⭐⭐⭐ |
| 问题排查难度 | 🔴 困难 | 🟢 简单 |

## 🧪 测试指南

详细测试步骤请参考：
- **[test-instructions.md](./test-instructions.md)** - 5分钟快速测试指南

### 快速测试清单

- [ ] 未登录时提示 "需登录"
- [ ] 登录后能成功导入开放获取论文 (10.1371/journal.pone.0230430)
- [ ] Session 过期时提示 "登录已过期" 而非通用错误
- [ ] 付费论文尝试 Sci-Hub 镜像 (10.1038/nature.2015.17120)
- [ ] 无效 DOI 显示有意义的错误

## 📚 相关文档

| 文档 | 用途 |
|------|------|
| [EXTENSION_FIX_GUIDE.md](./EXTENSION_FIX_GUIDE.md) | 完整的修复说明和技术细节 |
| [EXTENSION_DEBUG_REPORT.md](../EXTENSION_DEBUG_REPORT.md) | 问题诊断和解决方案分析 |
| [test-instructions.md](./test-instructions.md) | 测试验证步骤 |
| [DEPLOYMENT_COMPLETE.md](../DEPLOYMENT_COMPLETE.md) | Sci-Hub 功能部署记录 |

## 🚀 部署清单

- [x] 修改 `main.tsx` 错误处理
- [x] 修改 `api.ts` 添加自动刷新
- [x] 更新版本号到 0.1.8
- [x] 重新构建插件
- [x] 创建测试文档
- [ ] **用户测试验证**
- [ ] 部署到 Chrome Web Store（可选）

## 🎯 下一步

### 立即执行

1. **加载插件到 Chrome 进行测试**
   ```bash
   # 访问 chrome://extensions/
   # 加载目录: /home/zqliu/Work-Space/pdf-ai-reader/apps/extension/dist
   ```

2. **按照 test-instructions.md 进行测试**
   - 测试登录检查
   - 测试 DOI 导入
   - 测试错误提示

3. **验证修复效果**
   - 确认错误提示清晰
   - 确认自动刷新生效
   - 确认 Sci-Hub 功能正常

### 短期优化

- 监控 `SESSION_EXPIRED` 错误频率
- 收集用户反馈
- 优化 token 刷新策略

### 中长期改进

- 添加离线缓存
- 优化 Sci-Hub 镜像选择
- 支持更多论文来源

## 💡 技术要点

### 认证流程

```
用户导入 DOI
    ↓
检查 session 存在
    ↓
调用 pdf-fetch Edge Function
    ↓
收到 401 响应
    ↓
🆕 自动刷新 session token
    ↓
使用新 token 重试
    ↓
成功 → 返回 PDF
失败 → 提示 "登录已过期"
```

### 错误层级

1. **前端检查**: 确保 session 存在才调用 API
2. **API 自动刷新**: 收到 401 时尝试刷新 token
3. **明确错误提示**: 区分认证错误、DOI 错误、网络错误等

## ⚠️ 注意事项

1. **仍需登录**: DOI 导入功能必须登录后使用（这是设计要求）
2. **Token 生命周期**: 默认 1 小时，刷新后延长
3. **刷新重试次数**: 只尝试一次自动刷新，避免无限循环
4. **错误消息**: 确保对用户友好且可操作

## 📈 监控指标

部署后建议关注：

- 401 错误率（应该降低）
- `SESSION_EXPIRED` 错误频率
- PDF 导入成功率
- 用户反馈和支持工单数量

## ✨ 总结

**问题**: 插件导入 DOI 时显示通用错误，无法判断是认证问题还是 PDF 不可用  
**根因**: 缺少认证错误检测和自动刷新机制  
**修复**: 添加明确的错误类型检测 + 自动 token 刷新  
**状态**: ✅ 代码已修复并重新构建，待用户测试验证

---

**修复完成时间**: 2026-08-15 06:20 UTC  
**修复版本**: v0.1.8  
**下一步**: 用户测试验证
