# Deploying the DevPulse Backend to Railway

The backend is deploy-ready: `railway.json` builds with Nixpacks, runs
`prisma migrate deploy` on every release, and serves a `/api/health` check.
`prisma` is a runtime dependency and `postinstall` regenerates the client, so
nothing extra is needed after `npm install` on Railway.

## 1. Create the project + database

1. Push this repo to GitHub (already done: `pisitleephathr-ai/devpulse-backend`).
2. In Railway: **New Project → Deploy from GitHub repo → devpulse-backend**.
3. Add a database: **New → Database → PostgreSQL**. Railway creates it and
   exposes a `DATABASE_URL` variable.

## 2. Environment variables (Service → Variables)

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Reference the Postgres plugin: `${{ Postgres.DATABASE_URL }}` |
| `JWT_SECRET` | A long random string (≥ 16 chars) |
| `JWT_EXPIRES_IN` | `7d` |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | Your Vercel URL, e.g. `https://devpulse-frontend.vercel.app` |
| `PORT` | *(leave unset — Railway injects it)* |

## 3. Deploy

Railway runs, per `railway.json`:

- **Build:** `npm run build` (`prisma generate` + `tsc` → `dist/`)
- **Start:** `npm run start:migrate` → `prisma migrate deploy && node dist/index.js`

The first deploy creates all tables automatically — the initial migration is
committed at `prisma/migrations/20260710000000_init/`. Verify:

```bash
curl https://<your-backend>.up.railway.app/api/health      # {"status":"ok",...}
```

## 4. Bootstrap the deployed database (once)

> ⚠️ **Do NOT run `npm run seed` against production.** The seed **wipes every
> table** and creates demo accounts with the shared password `password123` — it
> is for local/demo only and now refuses to run when `NODE_ENV=production`
> (override with `ALLOW_PROD_SEED=1` only for an intentional reset).

For a real deployment, bootstrap production without the demo fixtures:

1. Seed the role rows: `railway run npm run seed:roles`.
2. Create the first admin with a strong, unique password (either a one-off
   script using `POST /api/users` semantics, or a guarded admin-provisioning
   step). Never reuse `password123`.
3. Importing a real team? Use `IMPORT_DEFAULT_PASSWORD=<strong-value> railway run
   npm run import:daily-meet` and have each user change it on first login.

Local/demo only:

```bash
# local database — creates demo users with password123
npm run seed
```

## 5. Verify online

```bash
BASE=https://<your-backend>.up.railway.app
curl $BASE/api/health
# log in with a real admin account you provisioned above:
curl -s -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin-email>","password":"<admin-password>"}'   # -> { token, user }
```
