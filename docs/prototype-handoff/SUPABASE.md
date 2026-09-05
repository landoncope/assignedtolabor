# Supabase

- **Project:** `wagepeace` — ref **`rmiwnhvabqhhcsixyvao`** — org **"Travis"** —
  region **us-west-2** — Postgres 17.
- Dashboard: https://supabase.com/dashboard/project/rmiwnhvabqhhcsixyvao
- Clients: `lib/supabase/server.ts` (SSR/route handlers, cookie session),
  `lib/supabase/client.ts` (browser). API routes/cron use the **service role** key via
  `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.

## Auth
- **Email/password** and **Google OAuth**. Google OAuth is **web-only** — it fails in an
  embedded WebView, so it's hidden inside the app (`.capacitor-native` CSS).
- **Anonymous sign-ins are ENABLED** (Authentication → Providers). This powers **Quick
  Upload**: an anonymous session is created lazily on submit; creating an account later
  calls `supabase.auth.updateUser({ email, password })` which *upgrades the same user id*
  so the already-uploaded video stays theirs.
- `public.users` mirrors `auth.users` via a `handle_new_user` trigger (tolerates null
  email for anonymous users).

## Storage buckets
| Bucket | Public? | Limits | Notes |
|---|---|---|---|
| `videos` | **private** | 500 MB, video mime allowlist | Uploaded at `{userId}/{timestamp}.{ext}`. Served only via **signed URLs** (`/api/videos/[id]/playback-url`). |
| `avatars` | **public** | 5 MB, `image/{png,jpeg,webp,gif}` | Profile photos at `{userId}/avatar`. RLS: own insert/update/delete + public read. |

Profile photos are resized+re-encoded to JPEG **client-side** before upload (iPhone
photos are often HEIC / >5 MB) — see `app/wagepeace/account/AccountSettings.tsx`
(`resizeToJpeg`). The account page renders avatars with a plain `<img>` (no image
domain is whitelisted for `next/image`).

## Key tables (public schema)
- **`users`** — app user mirror (role: user/manager/admin, profile bits).
- **`videos`** — one row per submission (`status`: pending/approved/rejected/posted,
  `storage_path`, `posted_at`, `rejected_at`, `file_purged_at`, demographic, etc.).
- **`video_channels`** — links a video to a channel (team). No link ⇒ admin-only review.
- **`channels`** / **`channel_members`** / **`channel_stats`** — teams, membership, and
  per-channel metrics.
- **`manager_applications`** — requests to lead/manage a channel (admin-reviewed).
- **`team_messages`** / **`team_message_reactions`** — per-team chat.
- **`user_journey`** / **`user_goals`** / **`user_badges`** / **`user_follows`** /
  **`user_reflections`** — gamified dashboard home (level/XP, weekly goals, badges,
  private reflections journal).
- **`user_profiles`**, **`email_optins`**, **`events`** — profiles, marketing opt-ins,
  events listing.

For exact columns/policies, use the Supabase dashboard (Table editor / SQL editor) —
that is the source of truth.

## Migrations
SQL files live in `supabase/` (e.g. `migration_video_lifecycle.sql`,
`migration_anonymous_quick_upload.sql`). They were applied by **pasting into the
Supabase SQL editor** — the automated migration path was gated for production. When you
add schema, keep a matching `.sql` file in `supabase/` and apply it via the SQL editor
(or wire up the Supabase CLI, a recommended improvement).

## The upload pipeline (reuse this — don't rebuild)
`lib/upload-video.ts` → `uploadVideo(supabase, userId, file, fields, channelId?, onProgress?)`:
validates (type, ≤500 MB), uploads to `videos`, inserts the `videos` row, optionally
links `video_channels`. Both the dashboard `UploadModal` and Quick Upload call this.
Playback everywhere goes through the signed-URL endpoint + a shared `<VideoPlayer>`.
