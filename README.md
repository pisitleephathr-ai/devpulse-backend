# DevPulse Backend

REST API for the DevPulse team-management app.
**Express · TypeScript · PostgreSQL · Prisma · JWT · Zod · bcryptjs**

## Requirements

- Node.js 18+ (tested on 24)
- A PostgreSQL database (local, Docker, or Railway)

## Setup

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL + JWT_SECRET
```

Point `DATABASE_URL` at your Postgres instance. Options:

- **Local Postgres:** `postgresql://postgres:postgres@localhost:5432/devpulse?schema=public`
- **Docker:** `docker run --name devpulse-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=devpulse -p 5432:5432 -d postgres:16`
- **Railway:** add a PostgreSQL plugin and copy its `DATABASE_URL`.

## Migrate & seed

```bash
npm run migrate      # create tables (prisma migrate dev)
npm run seed         # load the realistic Thai team sample data
# or reset everything:  npm run db:reset
```

Seeded accounts all use the password **`password123`** — e.g. `lena@devpulse.io`
(MANAGER), `dana@devpulse.io` (ADMIN), `maya@devpulse.io` (DEVELOPER).

## Run

```bash
npm run dev          # tsx watch, http://localhost:4000
npm run build && npm start   # production build
```

Health check: `GET http://localhost:4000/api/health`

## API overview

All `/api/*` routes except auth require `Authorization: Bearer <token>`.

| Group | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Users | `GET /api/users`, `GET /api/users/:id`, `POST /api/users`*, `PATCH /api/users/:id`*, `PATCH /api/users/:id/active`*, `DELETE /api/users/:id`† |
| Projects | `GET /api/projects`, `GET /api/projects/:id`, `POST /api/projects`*, `PATCH /api/projects/:id`*, `DELETE /api/projects/:id`† |
| Reports | `GET /api/reports` (filters: `authorId,projectId,status`), `GET /api/reports/:id`, `POST /api/reports`, `PATCH /api/reports/:id`, `DELETE /api/reports/:id` |
| Tasks | `GET /api/tasks` (filters: `projectId,assigneeId,status`), `GET /api/tasks/:id`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `PATCH /api/tasks/:id/status`, `DELETE /api/tasks/:id` |
| Leaves | `GET /api/leaves` (filters: `userId,type,status`), `GET /api/leaves/:id`, `POST /api/leaves`, `PATCH /api/leaves/:id/approve`*, `PATCH /api/leaves/:id/reject`*, `DELETE /api/leaves/:id` (owner while pending, or manager/admin) |
| Dashboard | `GET /api/dashboard/summary`, `GET /api/dashboard/activity?limit=` |
| Attachments | `GET /api/uploads/config`, `GET /api/tasks/:taskId/attachments/usage`, `POST /api/tasks/:taskId/attachments/signature`, `POST /api/tasks/:taskId/attachments/complete`, `DELETE /api/tasks/:taskId/attachments/:attachmentId` — see [ATTACHMENTS.md](ATTACHMENTS.md) |

`*` = MANAGER or ADMIN only · `†` = ADMIN only.
Report/Task edits are allowed for the owner or a manager/admin.

## Notes

- Passwords hashed with bcryptjs; JWT in the `Authorization` header.
- Every important action (create report/task/leave, approve/reject, user
  changes) writes an `ActivityLog` row shown on the dashboard feed.
- All request bodies/queries validated with Zod; consistent JSON errors.
