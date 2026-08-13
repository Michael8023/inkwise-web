# Inkwise 后台管理部署

后台地址：`https://inkwise.site/admin`

## 1. 推送数据库迁移

```bash
cd /home/zqliu/Work-Space/pdf-ai-reader
npx supabase db push
```

## 2. 授权首位管理员

先使用正常注册流程创建管理员账号，然后在 Supabase Dashboard 的 **SQL Editor** 执行以下 SQL。将邮箱替换为管理员邮箱：

```sql
insert into public.admin_users(user_id)
select id from auth.users where email = '你的管理员邮箱'
on conflict (user_id) do nothing;
```

确认授权成功：

```sql
select a.user_id, u.email, a.created_at
from public.admin_users a
join auth.users u on u.id = a.user_id;
```

撤销管理员权限：

```sql
delete from public.admin_users
where user_id = (select id from auth.users where email = '需要撤权的邮箱');
```

## 3. 部署管理函数

```bash
npx supabase functions deploy admin-users
```

该函数要求有效的 Supabase JWT，并会再次查询 `admin_users` 白名单。不要使用 `--no-verify-jwt`。

## 4. 发布网页

代码推送到 Git 后由 Cloudflare 自动构建；也可以手动发布：

```bash
cd apps/extension
npm run build
npm run deploy
```

## 5. 验收

1. 使用管理员账号访问 `/admin` 并登录。
2. 搜索普通用户，增加 100 分并填写备注。
3. 普通用户重新打开账户中心，应看到新余额。
4. 后台用户详情应显示人工调整记录。
5. 使用普通账号访问 `/admin`，应显示无管理权限，且不能读取用户列表。

所有额度调整通过数据库事务完成，并记录管理员、调整前后额度、操作类型和备注。前端不包含 `SUPABASE_SERVICE_ROLE_KEY`。

