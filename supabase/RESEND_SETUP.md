# Resend 注册验证码配置

Inkwise 使用 Resend 发送注册验证码，Supabase Edge Functions 校验验证码并创建已验证账号。Supabase 自带确认邮件不再参与注册流程。

## 1. 配置 Resend

1. 在 Resend 创建账号并进入 **Domains**。
2. 添加 `inkwise.site`，按页面提示将 SPF 和 DKIM 记录添加到 Cloudflare DNS。
3. 等待域名状态变为 **Verified**。
4. 在 **API Keys** 创建仅用于 Inkwise 发信的 Key。

## 2. 配置 Supabase Secrets

在仓库根目录执行：

```bash
npx supabase secrets set \
  RESEND_API_KEY='re_xxx' \
  RESEND_FROM_EMAIL='Inkwise <noreply@inkwise.site>' \
  SIGNUP_CODE_PEPPER='替换为至少32字节的随机字符串'
```

随机 pepper 可使用：

```bash
openssl rand -hex 32
```

这些值不能放入 `apps/extension/.env`、Git 或 Cloudflare 前端构建变量。

## 3. 推送数据库与函数

```bash
npx supabase db push
npx supabase functions deploy request-signup-code --no-verify-jwt
npx supabase functions deploy complete-signup --no-verify-jwt
```

## 4. 验证

打开网页注册新邮箱。预期流程：填写用户名、邮箱和密码，收到六位验证码，输入验证码后自动登录。验证码有效期 10 分钟，最多尝试 5 次，60 秒内不可重复发送，每小时最多发送 5 次。

