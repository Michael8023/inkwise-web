# 🐛 插件 DOI 导入功能调试报告

## 问题描述

用户反馈：插件在导入 DOI 链接时报错 **"无法读取该 PDF 链接"**，但网站版本可以正常使用 Sci-Hub 镜像功能。

## 根本原因

经过调试发现，问题的核心是 **认证机制**：

### Edge Function 认证要求

在 `supabase/functions/_shared/core.ts` 中，`user()` 函数强制要求用户必须登录：

```typescript
export async function user(req: Request) { 
  const { data, error } = await client(req).auth.getUser(); 
  if (error || !data.user) throw new Error("AUTH_REQUIRED"); 
  return data.user; 
}
```

所有调用 `pdf-fetch` Edge Function 的请求都会经过这个认证检查（`pdf-fetch/index.ts` 第 319 行）。

### 插件中的问题

1. **前端已有登录检查**（`main.tsx` 第 1717 行）：
   ```typescript
   if (isDoiLink(parsed)) {
     if (!session) throw new Error("解析 DOI 需登录后通过安全代理访问出版商页面。");
     // ...
   }
   ```

2. **但可能存在以下情况导致 401 错误**：
   - Session token 已过期
   - Session token 未正确传递到 Edge Function
   - 用户在另一个设备上登出，导致当前 session 失效
   - 本地存储的 session 与服务器不同步

3. **错误处理不够清晰**：
   当返回 401 错误时，用户看到的是通用错误 "无法读取该 PDF 链接"，而不是 "请重新登录"。

## 测试结果

### 使用匿名 token 测试 Edge Function

```bash
curl -X POST https://znkrejbcjysnqopytdui.supabase.co/functions/v1/pdf-fetch \
  -H 'Content-Type: application/json' \
  -H 'apikey: <ANON_KEY>' \
  -H 'Authorization: Bearer <ANON_KEY>' \
  -d '{"url":"https://doi.org/10.1371/journal.pone.0230430","resolveDoi":true}'

# 返回: {"error":"AUTH_REQUIRED"}
# HTTP 状态码: 401
```

这证实了 Edge Function 确实需要**真实的用户 session token**，而不仅仅是 anon key。

## 解决方案

### 方案 1: 改进错误提示（推荐 - 快速实施）

修改 `main.tsx`，在错误处理中特别处理 `AUTH_REQUIRED` 错误：

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

然后在 `apiErrors` 对象中添加：

```typescript
SESSION_EXPIRED: "您的登录已过期，请重新登录后再试。",
AUTH_REQUIRED: "请先登录后使用此功能。",
```

### 方案 2: 自动刷新 token（中期优化）

在 `api.ts` 的 `functionRequest` 函数中添加 token 刷新逻辑：

```typescript
export async function functionRequest(
  functionName: string,
  init: RequestInit = {},
) {
  if (!supabaseConfigured) throw new Error("SUPABASE_NOT_CONFIGURED");
  
  // 尝试刷新 session
  const { data, error } = await supabase.auth.getSession();
  
  if (error || !data.session) {
    throw new Error("AUTH_REQUIRED");
  }
  
  const headers = new Headers(init.headers);
  headers.set("apikey", supabaseAnonKey);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      ...init,
      headers,
    });
    
    // 如果返回 401，尝试刷新 token 并重试一次
    if (response.status === 401) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) {
        headers.set("Authorization", `Bearer ${refreshed.session.access_token}`);
        return await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
          ...init,
          headers,
        });
      }
    }
    
    return response;
  } catch (error) {
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error("NETWORK_REQUEST_FAILED");
    }
    throw error;
  }
}
```

### 方案 3: 允许匿名访问 PDF 获取（需要后端改动）

如果 PDF 获取功能不涉及用户数据，可以考虑允许匿名访问。修改 `pdf-fetch/index.ts`：

```typescript
Deno.serve(async (req) => {
  const p = preflight(req); if (p) return p;
  try {
    if (req.method !== "POST") throw new Error("METHOD_NOT_ALLOWED");
    
    // 尝试获取用户，但允许匿名访问
    let userId: string;
    try {
      const account = await user(req);
      userId = account.id;
    } catch {
      // 匿名用户使用 IP 作为标识
      userId = req.headers.get("x-forwarded-for") || "anonymous";
    }
    
    await rateLimit(userId, "pdf_fetch", 8);
    // ... 其余逻辑
  }
  // ...
});
```

**⚠️ 注意**：方案 3 会降低安全性，需要更严格的速率限制来防止滥用。

## 建议的实施步骤

1. **立即实施方案 1**：
   - 添加 `SESSION_EXPIRED` 错误处理
   - 更新错误提示文案
   - 重新构建插件
   
2. **测试步骤**：
   - 用户登录后测试 DOI 导入（应该成功）
   - 手动清除 localStorage 中的 session 后测试（应显示清晰的登录提示）
   - 测试各种 DOI：开放获取、付费论文、无效 DOI

3. **后续优化**（方案 2）：
   - 实施自动 token 刷新
   - 减少用户手动重新登录的频率

## 用户使用说明

### 当前解决方法

1. 确保已登录墨知账户
2. 如果看到 "无法读取该 PDF 链接" 错误：
   - 尝试退出并重新登录
   - 检查网络连接
   - 确认输入的 DOI 格式正确

### 实施修复后

用户会看到更清晰的错误提示：
- ✅ "请先登录后使用此功能" - 如果未登录
- ✅ "您的登录已过期，请重新登录后再试" - 如果 session 过期
- ✅ "该 DOI 对应的 PDF 暂时无法获取..." - 如果真的找不到 PDF

## 技术细节

### 当前认证流程

```
用户操作
  ↓
前端检查 session
  ↓ (session 存在)
调用 functionRequest("pdf-fetch")
  ↓
携带 session token 发送请求
  ↓
Edge Function 验证 token
  ↓
- 有效: 执行 PDF 获取逻辑
- 无效/过期: 返回 401 AUTH_REQUIRED
```

### 问题点

- 前端 `session` 状态可能过期但未刷新
- 错误响应没有明确区分认证问题和其他问题
- 用户体验：看不出是登录问题还是 PDF 真的找不到

### 修复后的流程

```
用户操作
  ↓
前端检查 session
  ↓ (session 存在)
调用 functionRequest (带 token 刷新)
  ↓
如果返回 401 → 尝试刷新 token → 重试
  ↓
如果仍然 401 → 清晰提示 "请重新登录"
  ↓
其他错误 → 具体错误提示
```

## 相关文件

- `apps/extension/src/main.tsx` - 前端逻辑（第 1709-1764 行）
- `apps/extension/src/api.ts` - API 请求封装
- `supabase/functions/pdf-fetch/index.ts` - Edge Function
- `supabase/functions/_shared/core.ts` - 认证逻辑

## 监控建议

部署修复后，建议监控以下指标：
- 401 错误率（应该降低）
- PDF 导入成功率（应该提升）
- 用户重新登录频率
- "SESSION_EXPIRED" 错误出现频率（如果频繁出现，说明需要调整 token 过期时间）

---

**报告生成时间**: 2026-08-15 06:10 UTC  
**调试工具**: Claude Code  
**状态**: 已确认根本原因，方案 1 可立即实施
