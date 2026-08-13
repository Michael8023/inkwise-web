# Backend Deployment

This API is designed to run on the dedicated backend server, not the current compute host.

1. Provision PostgreSQL and create an `inkwise` database.
2. Apply migrations in lexical order: `001_users_and_reader_data.sql`, `002_library_auth_v2.sql`, then `003_paper_state_and_sharing.sql`.
3. Copy `.env.example` to `.env`, then set `DATABASE_URL`, a 32+ character `JWT_SECRET`, `CORS_ORIGINS`, Resend, translation, and AI settings.
4. Copy this `apps/api` directory together with the root `package.json`, `package-lock.json`, and `tsconfig.json`, or deploy the complete repository. Run `npm ci`, then `npm --workspace apps/api run build` and `npm --workspace apps/api run start`.
5. Keep the API private on `127.0.0.1:8787`; expose it only through Nginx/Caddy HTTPS.

All library endpoints require `Authorization: Bearer <JWT>`. Data ownership is enforced in SQL by the authenticated user ID.

The browser extension is intentionally independent. Set `VITE_API_BASE_URL=https://api.your-domain.example` before building `apps/extension`; do not copy any backend `.env` values into the extension.
