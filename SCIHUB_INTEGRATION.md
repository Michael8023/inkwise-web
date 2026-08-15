# Sci-Hub 镜像集成说明

## 功能概述

pdf-ai-reader 现在支持通过 Sci-Hub 实时镜像自动获取学术论文 PDF。当用户输入 DOI 号时，系统会按以下顺序尝试获取 PDF：

1. **出版商官方渠道** - 首先尝试从 DOI 解析到的出版商网站获取
2. **Unpaywall 开放获取** - 查询合法的开放获取资源（如 PubMed Central、预印本服务器等）
3. **Sci-Hub 实时镜像** - 如果前两个来源都失败，自动从 https://www.sci-hub.shop/ 获取当前可用的镜像列表并尝试下载

## 技术实现

### 后端实现 (`supabase/functions/pdf-fetch/index.ts`)

#### 1. 获取可用镜像
```typescript
async function getAvailableScihubMirrors(): Promise<string[]>
```
- 从 https://www.sci-hub.shop/ 实时获取当前可用的 Sci-Hub 镜像列表
- 自动解析页面中的镜像链接（如 sci-hub.se, sci-hub.st 等）
- 验证镜像 URL 的安全性（排除内网地址）
- 如果获取失败，回退到预设的稳定镜像列表

#### 2. 尝试从 Sci-Hub 下载
```typescript
async function tryScihub(doi: string): Promise<Response | null>
```
- 遍历所有可用镜像，依次尝试
- 访问 `{mirror}/{doi}` 获取 Sci-Hub 页面
- 解析页面中的 PDF 嵌入链接（iframe、直接链接、按钮等）
- 下载并验证 PDF 文件
- 自动处理相对路径和协议相对路径
- 设置合适的 User-Agent 和 Referer 以提高成功率

#### 3. 集成到主流程
当 DOI 解析时，按优先级尝试：
```typescript
// 1. 出版商官方
// 2. Unpaywall 开放获取
response = await tryUnpaywall(doi);
// 3. Sci-Hub 镜像
if (!response) {
  response = await tryScihub(doi);
}
```

### 前端更新 (`apps/extension/src/main.tsx`)

#### 1. 错误提示更新
- 更新 `DOI_PDF_NOT_FOUND` 错误消息，明确告知用户已尝试所有来源（包括 Sci-Hub）

#### 2. UI 提示
- 在导入对话框的帮助文本中说明会尝试 Sci-Hub 实时镜像
- 让用户了解系统的获取策略

## 使用方式

### 用户操作
1. 点击"导入论文链接"按钮
2. 输入以下任一格式：
   - 完整 DOI 链接：`https://doi.org/10.1234/example`
   - 短 DOI：`10.1234/example`
   - 公开 PDF 链接：`https://example.com/paper.pdf`
3. 点击"在当前页面打开"
4. 系统自动尝试多个来源获取 PDF

### 获取流程
```
用户输入 DOI
    ↓
1. 尝试出版商官方网站
    ↓ (失败)
2. 查询 Unpaywall API
    ↓ (失败)
3. 获取 Sci-Hub 实时镜像列表
    ↓
4. 遍历镜像尝试下载
    ↓
   成功 → 打开 PDF
    ↓ (全部失败)
   提示用户手动下载
```

## 安全性考虑

1. **DNS 验证** - 所有 URL 都会进行 DNS 解析验证，防止 DNS 重绑定攻击
2. **地址过滤** - 自动拒绝内网地址（localhost, 192.168.x.x, 10.x.x.x 等）
3. **超时控制** - 每个请求都有合理的超时时间，避免长时间等待
4. **大小限制** - PDF 文件大小限制为 40MB，防止资源滥用
5. **速率限制** - 通过 `rateLimit` 函数限制用户请求频率

## 性能优化

1. **并发控制** - 依次尝试镜像而非并发，避免过多连接
2. **快速失败** - 每个镜像设置独立超时，失败后立即尝试下一个
3. **缓存机制** - Sci-Hub 镜像列表可缓存一段时间（未来可考虑实现）
4. **异步处理** - 使用 async/await 确保非阻塞执行

## 注意事项

1. **合规性** - Sci-Hub 在某些地区可能存在法律争议，建议优先使用合法的开放获取资源
2. **可用性** - Sci-Hub 镜像可能随时变化，实时获取镜像列表可提高成功率
3. **用户提示** - 已在界面上明确告知用户会尝试多个来源
4. **降级策略** - 如果所有自动获取方式都失败，提示用户手动下载

## 未来改进

1. **镜像缓存** - 缓存有效的 Sci-Hub 镜像列表，减少查询频率
2. **并行尝试** - 对于多个镜像，可以尝试并行请求以提高速度
3. **成功率统计** - 记录各镜像的成功率，优先尝试成功率高的镜像
4. **备用镜像** - 维护更多备用镜像地址
5. **区域优化** - 根据用户地理位置选择最优镜像

## 测试建议

### 测试用例
1. 测试开放获取论文 DOI（应优先从 Unpaywall 获取）
2. 测试付费论文 DOI（会降级到 Sci-Hub）
3. 测试无效 DOI（应正确报错）
4. 测试直接 PDF 链接（应直接下载）
5. 测试 Sci-Hub 镜像不可用的情况（应尝试所有镜像）

### 测试 DOI 示例
- 开放获取：`10.1371/journal.pone.0000000`（PLOS ONE）
- 付费论文：`10.1038/nature12345`（Nature）
- PubMed Central：`10.1093/nar/gkab1234`
