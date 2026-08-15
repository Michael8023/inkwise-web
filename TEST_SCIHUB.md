# Sci-Hub 集成测试指南

## 快速测试步骤

### 1. 启动开发环境

确保 Supabase 服务已启动：
```bash
cd /home/zqliu/Work-Space/pdf-ai-reader
supabase start
```

### 2. 部署 Edge Function

```bash
supabase functions deploy pdf-fetch
```

### 3. 测试 DOI 导入

在应用中测试以下 DOI：

#### 测试用例 1：开放获取论文（应该从 Unpaywall 获取）
```
DOI: 10.1371/journal.pone.0230430
预期：成功从 PubMed Central 或其他 OA 源获取
```

#### 测试用例 2：付费论文（会降级到 Sci-Hub）
```
DOI: 10.1038/nature.2015.17120
预期：从 Sci-Hub 镜像获取
```

#### 测试用例 3：新发表的论文
```
DOI: 10.1126/science.aaa1234
预期：尝试所有来源
```

### 4. 验证流程

打开浏览器开发者工具，观察网络请求：

1. 点击"导入论文链接"
2. 输入测试 DOI
3. 查看 Network 标签中的请求
4. 确认请求到了 `functions/v1/pdf-fetch`
5. 检查响应是否返回 PDF 数据

### 5. 检查日志

在 Supabase Dashboard 中查看 Edge Function 日志：
```bash
supabase functions logs pdf-fetch
```

## 手动测试 Sci-Hub 镜像获取

可以用以下脚本测试镜像获取功能：

```javascript
// 在浏览器控制台运行
async function testScihubMirrors() {
  const response = await fetch("https://www.sci-hub.shop/");
  const html = await response.text();
  const linkPattern = /https?:\/\/sci-?hub\.[a-z]{2,}/gi;
  const matches = html.match(linkPattern);
  const mirrors = [...new Set(matches)];
  console.log("找到的镜像:", mirrors);
  return mirrors;
}

testScihubMirrors();
```

## 测试结果验证

### 成功标志：
- ✅ PDF 文件成功加载
- ✅ 文件大小合理（> 100KB）
- ✅ PDF 内容可正常显示
- ✅ 控制台无错误信息

### 失败处理：
- ❌ 如果显示"DOI_PDF_NOT_FOUND"：检查 DOI 是否有效
- ❌ 如果超时：检查网络连接
- ❌ 如果 401/403：该论文可能真的无法获取

## 常见问题排查

### 问题 1：Sci-Hub 镜像列表获取失败
**症状**：所有 DOI 都无法通过 Sci-Hub 获取
**排查**：
```bash
# 测试是否能访问 sci-hub.shop
curl -I https://www.sci-hub.shop/
```

### 问题 2：PDF 下载超时
**症状**：请求时间过长，最终超时
**解决**：
- 检查 `AbortSignal.timeout` 设置是否合理
- 增加超时时间或优化镜像选择逻辑

### 问题 3：返回 HTML 而非 PDF
**症状**：下载的内容不是 PDF
**排查**：
- 检查 Content-Type 验证逻辑
- 检查 PDF 文件头验证（`%PDF`）

## 性能测试

### 测试各阶段耗时

使用以下 DOI 测试各来源的响应时间：

```bash
# 开放获取（快）
10.1371/journal.pone.0230430

# 付费论文（需要 Sci-Hub，较慢）
10.1038/nature.2015.17120

# 较新论文（可能需要遍历多个镜像）
10.1126/science.recent
```

预期耗时：
- 出版商官网：2-5秒
- Unpaywall：3-8秒
- Sci-Hub：5-15秒（取决于镜像数量和网络）

## 安全测试

### 测试恶意 URL 拒绝

确保以下输入会被正确拒绝：

```
❌ http://localhost/test.pdf
❌ http://192.168.1.1/test.pdf
❌ http://10.0.0.1/test.pdf
❌ http://127.0.0.1/test.pdf
❌ file:///etc/passwd
❌ ftp://example.com/test.pdf
```

### 测试文件大小限制

尝试下载超过 40MB 的 PDF，应该被拒绝。

## 集成测试清单

- [ ] DOI 解析正常
- [ ] 出版商渠道优先尝试
- [ ] Unpaywall 作为第二选择
- [ ] Sci-Hub 作为最后备选
- [ ] 镜像列表实时获取
- [ ] 多镜像自动切换
- [ ] PDF 内容验证
- [ ] 文件大小验证
- [ ] 超时控制正常
- [ ] 错误提示清晰
- [ ] 安全检查生效
- [ ] 日志记录完整

## 监控指标

建议监控以下指标：

1. **成功率**
   - 出版商渠道成功率
   - Unpaywall 成功率
   - Sci-Hub 成功率
   - 总体成功率

2. **性能**
   - 平均响应时间
   - P95/P99 响应时间
   - 超时率

3. **使用情况**
   - 每日 DOI 查询量
   - 各来源使用占比
   - 失败原因分布

## 反馈与改进

如果测试中发现问题，请记录：

1. 使用的 DOI
2. 错误信息
3. 网络请求详情
4. Edge Function 日志
5. 预期行为 vs 实际行为

将这些信息反馈给开发团队以持续改进。
