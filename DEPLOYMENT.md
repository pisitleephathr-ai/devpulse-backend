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

## 4. Seed the deployed database (once)

Run the seed locally, pointed at the Railway database:

```bash
# grab the public DATABASE_URL from Railway → Postgres → Connect
DATABASE_URL="postgresql://…railway…" npm run seed
```

or, with the Railway CLI: `railway run npm run seed`.

Seeded accounts use password **`password123`** (e.g. `lena@devpulse.io`).

## 5. Verify online

```bash
BASE=https://<your-backend>.up.railway.app
curl $BASE/api/health
curl -s -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"lena@devpulse.io","password":"password123"}'   # -> { token, user }
```
