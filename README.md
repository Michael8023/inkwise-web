# 识谛 shidea

项目按应用边界拆分：`apps/extension` 是浏览器插件 UI，`apps/api` 是可独立部署的 Fastify 后端，`packages/contracts` 放置共享协议类型。

## 主要功能

- 📄 **PDF 阅读器** - 流畅的 PDF 阅读体验，支持划词、高亮、注释
- 🤖 **AI 理解** - 划词翻译、智能解释、文档问答、摘要生成
- 🔍 **智能导入** - 支持 DOI 自动解析，多源获取学术论文
- 🎨 **图表识别** - 框选图片、表格、公式，AI 自动解读
- 📑 **版面分析** - 智能识别文档结构（图片、表格、公式）
- 🧠 **研究工作流** - 文献工作台、个人研究主线与 Brainstorm 多文献研究启发

## 产品主页与插件安装

- 产品宣传页：`https://www.inkwise.site/about`
- 在线阅读器：`https://www.inkwise.site/`
- 插件安装包：`https://www.inkwise.site/downloads/shidea-edge-extension.zip`
- 历史版本：[GitHub Releases](https://github.com/Michael8023/inkwise-web/releases)

识谛目前支持 Microsoft Edge 和 Google Chrome：下载 ZIP 后解压，打开 `edge://extensions` 或 `chrome://extensions`，开启开发者/开发人员模式，选择“加载解压缩的扩展程序”并选择解压后的目录。加载完成后可在扩展菜单中固定识谛图标。

每次执行 `npm --workspace apps/extension run package:edge` 会重新打包插件，并将最新 ZIP 同步到官网静态下载路径；`npm --workspace apps/extension run deploy` 会先完成该同步再部署。

## 论文导入功能

识谛支持通过 DOI 号自动获取论文 PDF，系统会按以下顺序尝试：

1. **出版商官方渠道** - 首先从 DOI 解析到的出版商网站获取
2. **Unpaywall 开放获取** - 查询合法的 OA 资源（PubMed Central、预印本等）
3. **Sci-Hub 实时镜像** - 自动从 https://www.sci-hub.shop/ 获取最新可用镜像并尝试下载

详见 [SCIHUB_INTEGRATION.md](./SCIHUB_INTEGRATION.md)

## 开发

```bash
npm install
npm run dev:extension
npm run dev:api
```

扩展开发页默认地址为 `http://localhost:5173`。构建后，打开 Chrome `chrome://extensions`，开启开发者模式，选择 `apps/extension/dist` 加载已解压的扩展程序。

本地开发时 Vite 将 `/v1` 代理到 `localhost:8787`。部署时复制 `apps/extension/.env.example` 为 `.env`，将 `VITE_API_BASE_URL` 设置为新服务器的 HTTPS API 域名后重新构建插件。

## 当前边界

扩展不保存供应商密钥。后端迁移、API 状态和待完成功能见 [BACKEND_MIGRATION_GUIDE.md](./BACKEND_MIGRATION_GUIDE.md)。

## 百度翻译配置

复制 `apps/api/.env.example` 为 `apps/api/.env`，在其中填写百度 AI Platform 的 `BAIDU_TRANSLATE_API_KEY` 和 `BAIDU_TRANSLATE_SECRET_KEY`。API 会在服务端自动获取并缓存 `access_token`；不要将任何密钥写入扩展代码或提交到 Git。

## 测试

查看 [TEST_SCIHUB.md](./TEST_SCIHUB.md) 了解如何测试 DOI 导入和 Sci-Hub 集成功能。
