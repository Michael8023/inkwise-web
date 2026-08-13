# Inkwise Supabase deployment

The browser extension no longer requires the Fastify API in `apps/api` or the
`api.inkwise.site` domain. `apps/api` is retained only as migration reference.

## 1. Create and link a project

Install the Supabase CLI, authenticate, then run from the repository root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

In Authentication settings, enable email/password registration and email
confirmation. Configure the sender and redirect URLs in the Supabase dashboard.

## 2. Configure function secrets

```bash
supabase secrets set \
  APILIO_API_KEY='replace-me' \
  APILIO_BASE_URL='https://api.apilio.ai/v1' \
  APILIO_DEFAULT_MODEL='gemini-2.5-flash-lite' \
  APILIO_MODELS='gemini-2.5-flash-lite' \
  BAIDU_TRANSLATE_API_KEY='replace-me' \
  BAIDU_TRANSLATE_SECRET_KEY='replace-me'
```

Deploy all functions:

```bash
supabase functions deploy models
supabase functions deploy usage
supabase functions deploy ai-summary
supabase functions deploy ai-explain
supabase functions deploy ai-chat
supabase functions deploy translate
```

## 3. Configure and build the extension

Create `apps/extension/.env.production` using the public values from Project
Settings > API:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

Never put the service-role key or third-party API keys in the extension.

```bash
npm ci
npm run build:extension
```

Load `apps/extension/dist` as an unpacked Chromium extension. After deployment,
test registration, email confirmation, login, usage display, quota exhaustion,
AI failure refunds, model multipliers, and Chrome/Edge access.

## 4. Administer credits

Initial credits are granted by the new-user trigger. For manual top-ups, update
`public.user_entitlements.credits_remaining` in the Supabase dashboard. Configure
plans and model multipliers in `public.plans` and `public.model_catalog`.

Once production checks pass, stop the old systemd API service. No Nginx,
self-hosted PostgreSQL, Resend configuration, or API domain is required.
