# Supabase 邀请码门禁

这个版本使用 GitHub Pages 托管前端，Supabase 负责邀请码和访问日志。

## 1. 创建 Supabase 项目

在 Supabase 新建项目后，进入 Project Settings -> API，记下：

- Project URL
- anon public key

## 2. 初始化数据表

进入 Supabase 的 SQL Editor，把 `supabase/schema.sql` 的内容完整粘贴进去执行。

执行后会创建：

- `invite_codes`: 邀请码表
- `invite_sessions`: 访问会话表
- `visit_logs`: 访问日志表
- `claim_invite`: 校验邀请码并创建会话
- `log_visit_event`: 写入访问事件

SQL 会默认创建一个测试邀请码：

```text
DEMO2026
```

## 3. 添加自己的邀请码

在 SQL Editor 执行：

```sql
insert into public.invite_codes (
  code,
  label,
  owner_name,
  company,
  max_uses,
  expires_at,
  notes
)
values (
  'FRIEND001',
  '朋友评审',
  '张三',
  '某汽车公司',
  20,
  '2026-06-30 23:59:59+08',
  '第一批评审用户'
);
```

想停用某个邀请码：

```sql
update public.invite_codes
   set enabled = false
 where code = 'FRIEND001';
```

## 4. 本地启用门禁

复制 `.env.example` 为 `.env.local`，填入：

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

重启本地开发服务：

```powershell
npm run dev
```

打开页面后会先出现邀请码输入页。

## 5. GitHub Pages 启用门禁

进入 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions -> Variables
```

添加两个 Repository variables：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

之后重新 push，GitHub Actions 会用这两个变量打包，线上页面就会启用邀请码门禁。

## 6. 查看访问记录

在 Supabase Table Editor 里查看：

- `invite_sessions`: 谁通过邀请码进来
- `visit_logs`: 打开页面、切换车型、筛选条件等访问事件

当前记录的事件包括：

- `invite_accepted`
- `app_open`
- `view_changed`

## 7. 管理员生成邀请码

先在 Supabase SQL Editor 执行 `supabase/admin-invite.sql`。

执行前请把 SQL 里的默认口令改掉：

```sql
digest('CHANGE_ME_ADMIN_PASSWORD', 'sha256')
```

例如改成：

```sql
digest('your-real-admin-password', 'sha256')
```

线上管理员入口：

```text
https://mr-friedeggs.github.io/car-sales-map/?admin=1
```

本地管理员入口：

```text
http://127.0.0.1:5175/?admin=1
```

管理员页会生成 `max_uses = 1` 的一次性邀请码。用户第一次输入成功后，浏览器会保存 session；如果他把邀请码发给别人，别人再次输入会因为次数用完而失败。

## 注意

这个 MVP 会挡住普通访问入口，但静态 JSON 数据仍然公开放在 GitHub Pages 上。要做真正的数据保护，需要把销售数据也迁到后端或 Supabase Storage，并通过受保护接口读取。
