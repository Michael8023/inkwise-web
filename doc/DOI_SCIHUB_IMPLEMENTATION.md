# DOI 与 Sci-Hub 自动获取 PDF 功能实现

## 功能概述

当用户通过 URL 输入 DOI 时，系统会自动尝试从多个来源获取 PDF：

1. **优先尝试出版商官方渠道** - 合法且尊重版权
2. **Fallback 到 Sci-Hub** - 当出版商无法访问时自动切换
3. **多镜像站支持** - 提高 PDF 获取成功率

## 实现细节

### 后端改动 (`supabase/functions/pdf-fetch/index.ts`)

#### 1. Sci-Hub 镜像站配置

```typescript
const SCIHUB_MIRRORS = [
  "https://sci-hub.se",
  "https://sci-hub.st",
  "https://sci-hub.ru",
  "https://sci-hub.ren",
  "https://sci-hub.wf",
];
```

#### 2. DOI 提取函数

```typescript
function extractDoi(url: URL): string | null {
  if (!isDoiUrl(url)) return null;
  const match = url.pathname.match(/^\/?(10\.\d{4,9}\/[\S]+)/i);
  return match ? match[1] : null;
}
```

#### 3. Sci-Hub 尝试函数

`tryScihub(doi: string)` 函数会：
- 遍历所有配置的镜像站
- 对每个镜像站设置 10 秒超时
- 尝试获取 HTML 页面并解析 PDF 链接
- 如果直接返回 PDF，则立即使用
- 验证 PDF 大小不超过 40MB
- 失败时自动尝试下一个镜像站

#### 4. 主逻辑改进

```typescript
// 对于 DOI URL：
if (resolveDoi && doi) {
  try {
    // 1. 先尝试出版商官方渠道
    // ...
  } catch (error) {
    publisherFailed = true;
  }

  // 2. 如果出版商失败，尝试 Sci-Hub
  if (publisherFailed) {
    response = await tryScihub(doi);
    if (!response) throw new Error("DOI_PDF_NOT_FOUND");
  }
}
```

### 前端改动 (`apps/extension/src/main.tsx`)

#### 1. 错误消息更新

新增友好的错误提示：

```typescript
const apiErrors: Record<string, string> = {
  // ...
  DOI_PDF_NOT_FOUND: "该 DOI 对应的 PDF 暂时无法获取，出版商和学术资源库均未能提供访问。请尝试手动下载后导入。",
  PDF_UPSTREAM_401: "该论文需要订阅权限，无法自动获取。请通过机构访问或手动下载后导入。",
  PDF_UPSTREAM_403: "该论文访问受限，无法自动获取。请通过机构访问或手动下载后导入。",
};
```

#### 2. UI 提示文字更新

URL 导入对话框的帮助文本：
```
"DOI 解析会先尝试出版商官方渠道，如不可访问则自动从 Sci-Hub 等学术资源库获取。"
```

## 使用方式

用户可以通过以下方式输入 DOI：

1. **完整的 DOI URL**
   ```
   https://doi.org/10.1038/nature12345
   ```

2. **纯 DOI**（系统会自动转换）
   ```
   10.1038/nature12345
   ```

系统会自动：
- 规范化 URL
- 验证 DOI 格式
- 先尝试出版商
- 失败时自动切换到 Sci-Hub
- 尝试多个 Sci-Hub 镜像站
- 返回获取到的 PDF

## 安全性考虑

1. **DNS 验证** - 所有请求都会验证 DNS，防止 SSRF 攻击
2. **大小限制** - PDF 文件限制在 40MB 以内
3. **超时控制** - 每个镜像站请求有独立的超时时间
4. **速率限制** - 通过现有的 rateLimit 机制防止滥用
5. **用户认证** - 需要登录才能使用 DOI 解析功能

## 错误处理

系统会优雅地处理以下情况：

- 出版商拒绝访问（401/403）→ 自动尝试 Sci-Hub
- Sci-Hub 镜像站不可用 → 自动尝试下一个
- 所有来源都失败 → 返回友好的错误消息
- 网络超时 → 自动跳过并尝试下一个来源

## 法律声明

本功能实现遵循以下原则：

1. **优先合法渠道** - 始终先尝试出版商官方 PDF
2. **用户主导** - 仅在用户明确请求时获取论文
3. **透明提示** - 向用户清楚说明获取来源
4. **无存储** - 不缓存或存储从 Sci-Hub 获取的内容

用户需要自行承担使用 Sci-Hub 的法律责任，本功能仅作为技术实现参考。

## 未来优化方向

1. **镜像站健康检查** - 定期检测可用的镜像站
2. **智能镜像选择** - 根据地理位置选择最快的镜像站
3. **缓存机制** - 缓存 DOI 到 PDF 的映射（仅出版商链接）
4. **更多来源** - 支持 arXiv、PubMed Central 等其他合法来源
5. **进度提示** - 向用户显示当前正在尝试的来源

## 测试建议

1. **测试开放访问的 DOI**
   ```
   10.1371/journal.pone.0123456 (PLOS ONE - 开放获取)
   ```

2. **测试受限的 DOI**
   ```
   10.1038/nature12345 (Nature - 需订阅)
   ```

3. **测试纯 DOI 输入**
   ```
   10.xxxx/xxxxx
   ```

4. **测试错误的 DOI**
   ```
   10.9999/invalid
   ```
