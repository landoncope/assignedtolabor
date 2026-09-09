# Handoff Notes — `wagepeace` source package

This file was generated when the source was packaged for handoff. It documents the
package contents, environment variables, and database migrations. For the full project
brief, see the **`HANDOFF/`** folder (README, ARCHITECTURE, SUPABASE, GOTCHAS, etc.).

## Database schema
An attempt to export the live schema with
`npx supabase db dump --linked --schema public,storage -f supabase/SCHEMA-DUMP.sql`
**failed** — the project is not linked to the Supabase CLI on this machine, and linking
requires the database password (not available during packaging). So there is **no
`SCHEMA-DUMP.sql`** in this package.

**Fallback (sufficient):** the SQL files already in `supabase/` define the full schema,
tables, and RLS policies. To regenerate a live dump yourself:
```bash
supabase login
supabase link --project-ref rmiwnhvabqhhcsixyvao   # will prompt for the DB password
supabase db dump --linked --schema public,storage -f supabase/SCHEMA-DUMP.sql
```

## Environment variables (NAMES only — values are NOT in this package)
**⚠ SECURITY — this package CONTAINS live secrets.** At the owner's request, the real
**`.env.local` is included** in this zip, with live production values: the Supabase
**service-role key** (full DB admin, bypasses RLS), the **Anthropic** key, the
**Meta/Instagram** secrets, and `CRON_SECRET`. Treat this zip as confidential — do not
forward or store it in the open, and **rotate the keys** if it is ever exposed. The same
values also live in Vercel (Project → Settings → Environment Variables).

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`   *(secret)*
- `NEXT_PUBLIC_SITE_URL`
- `ANTHROPIC_API_KEY`   *(secret)*
- `ALIGNED_API_KEY`   *(secret — not set yet; see HANDOFF/ROADMAP.md)*
- `CRON_SECRET`   *(secret)*
- `META_APP_ID`
- `META_APP_SECRET`   *(secret)*
- `INSTAGRAM_ACCESS_TOKEN`   *(secret)*
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`

## SQL migrations in `supabase/` (inferred order applied)
These were applied by hand via the Supabase SQL editor, so the exact sequence isn't
recorded — the order below is **inferred from file modification times** and should be
treated as approximate. `schema.sql` is the base; the rest are incremental.

1. `schema.sql` — base schema
2. `migration_roles_channels.sql`
3. `migration_journey.sql`
4. `migration_channel_members.sql`
5. `migration_channel_stats.sql`
6. `migration_team_uploads.sql`
7. `migration_events.sql`
8. `migration_manager_applications.sql`
9. `migration_team_chat.sql`
10. `migration_video_lifecycle.sql`
11. `migration_storage_manager_read.sql`
12. `migration_video_thumbnail.sql`
13. `migration_join_application.sql`
14. `migration_avatars_bucket.sql`
15. `migration_anonymous_quick_upload.sql`
16. `migration_events_cards.sql`

## Project file tree (depth 3; build/artifact folders omitted)
Omitted from this listing (and from the zip): `node_modules`, `.next`, `out`, `dist`,
`.vercel`, `.turbo`, `.git`, `ios/App/build`, `ios/App/Pods`, `ios/App/DerivedData`,
`android/build`, `android/app/build`, `android/.gradle`, `public/ffmpeg`. The real
**`.env.local` IS included** in the zip (live secrets — owner's request; see the security
note above), alongside `.env.local.example`.

```
.claude/
  launch.json
.env.local                  # INCLUDED — live production secrets (owner's request)
.env.local.example
.gitignore
HANDOFF-NOTES.md            # this file
HANDOFF/
  ACCESS.md
  ARCHITECTURE.md
  DEPLOYMENT-AND-IOS.md
  FEATURE-MAP.md
  GOTCHAS.md
  README.md
  ROADMAP.md
  SUPABASE.md
android/
  .gitignore
  app/
    .gitignore
    build.gradle
    capacitor.build.gradle
    proguard-rules.pro
    src/
  build.gradle
  capacitor-cordova-android-plugins/
    build.gradle
    cordova.variables.gradle
    src/
  capacitor.settings.gradle
  gradle/
  gradle.properties
  gradlew
  gradlew.bat
  settings.gradle
  variables.gradle
app/
  api/
    admin/  aligned/  claim-goal/  complete-onboarding/  generate-script/
    instagram/  join-channel/  manager-application/  team/  toggle-follow/  videos/
  assignedtolabor/
    page.tsx  qr/  quickupload/
  events/
    EventsView.tsx  page.tsx
  globals.css
  icon.png
  layout.tsx
  page.tsx
  quick/
    page.tsx
  wagepeace/
    account/  admin/  auth/  dashboard/  layout.tsx  leader/  login/
assets/
  logo.png
capacitor.config.ts
components/
  AdSense.tsx  NativeInit.tsx  Navbar.tsx  VideoPlayer.tsx  VideoRecorder.tsx  VideoThumb.tsx
ios/
  .gitignore
  App/
    App/  App.xcodeproj/  CapApp-SPM/
  capacitor-cordova-ios-plugins/
    CordovaPluginsResources.podspec  resources/  sources/
  debug.xcconfig
lib/
  constants.ts  merge-clips.ts  native.ts
  supabase/
    client.ts  server.ts
  team-auth.ts  upload-video.ts
middleware.ts
mobile-shell/
  index.html
next-env.d.ts
next.config.ts
package-lock.json
package.json
postcss.config.mjs
public/
  ads.txt  assigned-to-labor.jpg
  events/
    billings.jpg  rexburg.jpg  uvu.jpg
  logo.png  world-dots.svg  worldmap.png
supabase/
  (16 .sql files — see list above)
tailwind.config.ts
tsconfig.json
vercel.json
```

## First-run for the recipient
```bash
npm install
cp .env.local.example .env.local     # then paste real values (from Vercel)
npm run dev                           # http://localhost:3000
```
Note: `public/ffmpeg/` (the ~32 MB ffmpeg.wasm core used by the video-clip merger) is
excluded from this zip — regenerate it with:
`cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.{js,wasm} public/ffmpeg/`
(after `npm install`). See `HANDOFF/FEATURE-MAP.md`.
