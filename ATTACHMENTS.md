# Task Attachments — Cloudinary Signed Direct Upload

Images and documents can be attached to tasks and are uploaded **directly from
the browser to Cloudinary** using short-lived, server-signed parameters. The
file bytes never pass through the Express backend. The pre-existing "paste a
URL" attachments continue to work unchanged.

## Architecture

```
Frontend                         Backend (Express)                 Cloudinary
   |  GET /api/uploads/config  →  limits + allowlists (source of truth)
   |  choose files, validate (UX only)
   |  POST /:taskId/attachments/signature → authz + validate + reserve
   |         ← { cloudName, apiKey, timestamp, signature, folder, publicId, ... }
   |  POST https://api.cloudinary.com/v1_1/{cloud}/{image|raw}/upload  →  (direct)
   |         ← { public_id, asset_id, secure_url, bytes, ... }
   |  POST /:taskId/attachments/complete → verify intent + inspect asset + save
   |         ← { attachment }
   |  refresh list + usage
```

The signature covers `folder + public_id + timestamp`, so the client can only
upload the authorized file into the task's folder under a server-generated UUID.

## Environment

Backend `.env` (see `.env.example`):

```
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=      # SERVER-ONLY — never exposed to the client
CLOUDINARY_UPLOAD_FOLDER=devpulse
```

If any of the three credentials is missing, the upload endpoints return `503`
and the feature is disabled; legacy URL attachments still work. The frontend
needs **no** Cloudinary variables — the cloud name comes from the signature
response.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/uploads/config` | Limits + allowlists (source of truth) |
| GET | `/api/tasks/:taskId/attachments/usage` | Live file count + bytes vs. limits |
| POST | `/api/tasks/:taskId/attachments/signature` | Authz + validate + reserve → signed params |
| POST | `/api/tasks/:taskId/attachments/complete` | Verify + inspect asset + persist |
| DELETE | `/api/tasks/:taskId/attachments/:attachmentId` | Delete (Cloudinary + DB) |
| POST | `/api/tasks/:id/attachments` | Legacy URL attachment (unchanged) |
| GET/POST | `/api/cron/attachment-cleanup` | Orphan sweep + failed-delete retry (CRON_SECRET) |

`signature`, `complete`, and `DELETE` are rate-limited per authenticated user
(30 requests / 10 min).

## Limits (backend is the single source of truth)

- Images (`image/jpeg|png|webp|gif`): max **5 MB**. SVG/BMP/TIFF are rejected.
- Documents (`pdf, txt, csv, doc(x), xls(x), ppt(x)`): max **10 MB**.
- Per task: **20 files** and **100 MB** total; **5 concurrent** uploads.

The frontend fetches these and only falls back to a local copy if the backend is
unreachable. Every rule is re-enforced server-side in both `signature` and
`complete`.

## Security controls

- **Signed uploads only** — no unsigned preset; the API secret never leaves the
  server (not in responses, logs, or errors).
- **Authorization** before issuing a signature: the task must exist and the user
  must be an assignee, a team manager/admin, or hold `TASK_ATTACHMENT_UPLOAD`.
- **UploadIntent** (one row per signature, unique `publicId`): `complete` must
  match a `PENDING`, unexpired intent owned by the same user + task, and it is
  consumed exactly once → replay / duplicate protection.
- **Admin-API inspection** on `complete`: real `bytes / folder / resource_type /
  format` are read from Cloudinary, defeating forged `fileSize / secureUrl /
  publicId / format`.
- **IDOR guards**: `publicId` must live in `devpulse/tasks/{taskId}`; delete
  verifies the attachment belongs to the task; `assetId` is unique.
- **Deletion**: removes the Cloudinary asset first; a failure does not report a
  clean success — the row is soft-deleted (`DELETE_FAILED`) and retried by the
  cleanup job. Errors are logged with `attachmentId + publicId` only.
- **Filenames** are never used as a Cloudinary public id (UUID instead) or a
  filesystem path; display names are length-bounded via Zod.

## Orphan cleanup

`runAttachmentCleanup()` runs in-process every 6 hours (armed at boot when
Cloudinary is configured) and can be triggered externally via
`POST /api/cron/attachment-cleanup` (gated by `CRON_SECRET`). It:

1. Deletes Cloudinary assets for **expired, unconfirmed** UploadIntents (never
   touching an asset that already has a `TaskAttachment`) and marks them EXPIRED.
2. Retries Cloudinary deletion for `DELETE_FAILED` attachments and removes the
   row on success.

## Data model (additive migration)

`migration.sql`: `20260719120000_task_attachment_cloudinary` extends
`TaskAttachment` with the Cloudinary columns (`source`, `kind`, `cloudinary*`,
`secureUrl`, `thumbnailUrl`, dimensions, `uploadedById`, `deleteStatus`,
`deletedAt`) — all nullable/defaulted so **existing URL attachments are
preserved** — and adds the `UploadIntent` table. `source` backfills to `URL`,
`kind` to `LINK` for existing rows.

Apply it with:

```bash
npm run migrate:deploy   # prisma migrate deploy
```

## Local development

1. `cp .env.example .env` and fill the `CLOUDINARY_*` values (free account).
2. `npm run migrate` (or `migrate:deploy`) to apply the migration.
3. `npm run dev` (backend) + the frontend `npm run dev`.
4. Open a task → drag/drop, click, or paste (Ctrl/Cmd+V) an image.

## Manual QA

- Upload an image → thumbnail appears → click opens the lightbox.
- Upload a PDF → download works.
- Cancel a mid-flight upload; retry a failed one.
- Delete an attachment → usage/remaining decrease.
- A non-assignee, non-manager cannot upload; a non-uploader cannot delete.
- Oversize / unsupported files are rejected client-side and server-side.
- A legacy URL attachment still renders and opens.

## Cloudinary quota monitoring

Watch storage + transformations in the Cloudinary dashboard (Usage). Thumbnails
use `c_fill,w_320,h_180,q_auto,f_auto`; lightbox previews `c_limit,w_1600,
q_auto,f_auto`. Board views load thumbnails only — never the originals.
