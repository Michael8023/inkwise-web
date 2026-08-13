# 墨知 Inkwise

项目按应用边界拆分：`apps/extension` 是浏览器插件 UI，`apps/api` 是可独立部署的 Fastify 后端，`packages/contracts` 放置共享协议类型。

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
