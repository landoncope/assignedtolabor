# Assigned To Labor

Owner: Landon Cope (landon@highpsiproducts.com). Product owner: Travis (non-technical).
Claude owns this repo: language, dependencies, architecture, and this file. Keep CLAUDE.md
current whenever a decision is made or reversed. Dates below are absolute (YYYY-MM-DD).

## Status (2026-09-20)

**MVP is live in production at https://assignedtolabor.org.** Landon and Travis are
admins and are testing. Working and verified: anonymous upload with portrait 9:16
recording (multi-clip, zoom), language-based routing to areas, review queue, assisted
Instagram posting workflow, admin (areas, managers), Google and magic-link sign-in,
cross-device email links, email notifications through Resend (managers, uploaders,
new reviewers), nightly file purge, branding (wheat-sheaf logo). Travis's first
feedback round (language step, recorder layout) shipped 2026-09-12; one-tap script
skip and Turnstile bot protection (enforced in Supabase) shipped 2026-09-15; reviewer
delete and, after a tester's frozen video, the recorder rework (1080p capture, camera
zoom, raw mic audio, frame watchdog, per-recording diagnostics on the review page)
shipped 2026-09-17. Teams (members apply to join a team or to start one; leads and
admins decide; members tag uploads with their team) shipped 2026-09-17 for Travis's
Saturday 2026-09-19 event (100+ uploads, 10+ would-be leads).

**The event (2026-09-19) ran:** 27 videos, 23 recorded in the app, no upload or sign-in
trouble. But 11 of the 13 iPhone recordings have a frozen picture (10 to 24 s of video
under 17 to 184 s of sound): every iPhone on iOS 26 that recorded longer than 17 s.
Cause and fix are under "iOS 26 frozen picture" in the recorder notes below; the fix
shipped 2026-09-20 and is NOT yet confirmed on a real iPhone. Those 11 files cannot be
repaired (the frames were never written). Next: iPhone testers confirm the fix (every
new recording reports on itself, see `capture_meta.picture`), then phase-2 Instagram
API posting.

### After the 2026-09-19 event (do these, then delete this list)

- Confirm the iOS 26 fix on real iPhones: a recording of 45 s or more from an iPhone on
  iOS 26 whose review page shows no red "picture freezes" line, and
  `node scripts/dev/freeze-audit.mjs <since>` reporting it ok. Landon proposed emailing
  the affected uploaders who left an address to ask for a test (list and draft given to
  him 2026-09-20; nothing is sent without his go-ahead).
- Only then raise `VIDEO_BITRATE` back to 8 Mbps (cut to 5 for the venue network; Landon
  prefers 8: storage is cheap and YouTube may follow Instagram). It waits because the
  iOS 26 bug bites sooner the more data there is, and because iPhones overshoot anyway
  (8 to 9 Mbps written when asked for 5).
- Try `?rec=camera` (direct camera recording, see below) on a real iPhone and a cheap
  Android; if upright and smooth, consider making it the default for portrait frames.
- Remind Landon to downgrade Resend from Pro (upgraded 2026-09-18) unless email volume
  stayed above ~100 a day.
- Still open with Travis: Brady Gordon's email (Philippines lead), whether
  holyrebellionph@gmail.com stays a lead, Instagram handles for the four new teams.

## Account setup (one-time, needs dashboard access)

1. Supabase DONE 2026-09-10: project `assignedtolabor` (renamed from a typo 2026-09-11), ref `zyqualxehxopcvkqdjlo`,
   org `landoncope.dev`, region us-east-1, Free plan. Anonymous sign-ins on, Email +
   Google providers on, site URL `https://assignedtolabor.org`. Redirect allow list
   uses `/**` globs: `http://localhost:3000/**`, `https://assignedtolabor.org/**`,
   `https://assignedtolabor.vercel.app/**`,
   `https://assignedtolabor-*-assignedtolabor.vercel.app/**` (a bare `/auth/callback`
   entry does NOT match once `?next=` is appended; that bit us once). Migrations pushed via
   `supabase db push --db-url` (pooler host `aws-0-us-east-1.pooler.supabase.com`,
   user `postgres.zyqualxehxopcvkqdjlo`; password in Landon's `.env.local`).
2. Vercel DONE 2026-09-10: Travis's team was renamed **`assignedtolabor`** (Pro).
   Project `assignedtolabor` is connected to GitHub with production from `main` and
   previews per PR. Env vars set for Production + Preview (the five in `.env.example`).
   Domains: `assignedtolabor.org` = production; `www.assignedtolabor.org`,
   `assignedtolabor.com`, `www.assignedtolabor.com` = 308 redirect to the .org apex.
   Landon's Chrome Vercel login (`landoncope`) is on the team; the local Vercel CLI
   login (`landon-5551`) is NOT, so Vercel changes go through the dashboard.
   `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are stored as readable "Config"
   values and Vercel flags them "Needs Attention"; converting to Secret requires
   typing a new value, which Claude does not do. `RESEND_API_KEY` is a Secret.
3. Google Cloud DONE 2026-09-10: project `assigned-to-labor-508202`, OAuth consent
   published to production (External), web client "Supabase Auth" with redirect
   `https://zyqualxehxopcvkqdjlo.supabase.co/auth/v1/callback` and, since 2026-09-17,
   `https://api.assignedtolabor.org/auth/v1/callback` too. Branding links to
   `/privacy` and `/terms` on assignedtolabor.org (pages exist in the app). The
   consent screen showed the callback DOMAIN (the supabase.co address a tester
   flagged, then api.assignedtolabor.org) until brand verification. Brand
   verification (Google Auth Platform -> Branding -> Verify branding, then Publish
   branding) passed and was published 2026-09-17: the consent screen now shows
   "Assigned To Labor". Google's check was automated and took minutes, not days. Its
   one prerequisite was Search Console ownership of the home page: the URL-prefix
   property `https://assignedtolabor.org/` is verified for landoncope@gmail.com by
   the meta tag in `src/app/layout.tsx` (`metadata.verification.google`; keep it).
   A Domain property via DNS was attempted first but Namecheap's session had expired
   mid-way and "Failed to save record" was the only symptom; the CNAME/TXT it wanted
   were never saved and are not needed.
4. Namecheap DONE 2026-09-10 (Namecheap BasicDNS, both domains): `A @ 216.150.1.1`
   and `CNAME www 8a4deef4ce3f28c8.vercel-dns-016.com`. The default parking records
   were removed. Namecheap's locked SPF TXT record remains (harmless).
5. Supabase custom domain DONE 2026-09-17 (tester Braydon: the Google consent screen
   named zyqualxehxopcvkqdjlo.supabase.co): add-on "Custom Domain" ($10/month),
   `api.assignedtolabor.org` with `CNAME api -> zyqualxehxopcvkqdjlo.supabase.co` and
   `TXT _acme-challenge.api` at Namecheap (verification took ~15 minutes after the
   records were public; Supabase's resolver had cached the miss). Active and serving:
   REST/Auth/Storage answer on both hostnames; the app uses the custom one
   (`NEXT_PUBLIC_SUPABASE_URL=https://api.assignedtolabor.org` in Vercel and
   `.env.local`). Switching the URL changed the auth cookie name (@supabase/ssr derives
   it from the hostname), so everyone was signed out once. Delete the CNAME and the
   domain stops; the supabase.co hostname keeps working regardless.
6. Event readiness (2026-09-18, before a talk where ~100 people record at once on one
   venue network; all dashboard settings, none in the repo):
   - Supabase Auth -> Rate Limits were the defaults, which are PER IP ADDRESS and a
     room shares one: anonymous sign-ins 30/h -> 1000/h, emails 30/h -> 300/h, token
     verifications and sign-ups/sign-ins 30 -> 150 per 5 min. Turnstile stays the abuse
     control. Lower them again only if abuse shows up.
   - Storage -> Settings -> Global file size limit was 50 MB (the bucket's own 500 MB
     cap does not override it); now 500 MB. Found with
     `node scripts/dev/big-upload-check.mjs` (60 MB and 120 MB bodies through the
     custom domain; 400 "EntityTooLarge" before, 200 after). The spend cap is still on.
   - Compute is the Pro default and the database is 12 MB; nothing to scale.
   - `scripts/dev/event-watch.sh [seconds]` is a read-only live view for the day:
     uploads per 15 min/hour, by team, recorder health (avg fps, stalls, camera zoom),
     devices, sign-ins, typed-but-unconfirmed emails, waiting team requests.
   - Emergency levers, in order: people record with their own camera app and use
     "Upload a video I already have"; captcha off in Auth -> Attack Protection if
     submits fail on captcha; Auth -> Rate Limits if errors mention a rate limit.
   - Resend: Landon upgraded to Pro on 2026-09-18 (the free tier is 100 emails a day,
     and auth emails share it with the notification digests).
7. Seed data lives in `supabase/seeds/` (applied by hand with psql, re-runnable).
   Philippines / Tagalog with Instagram `Liwinag.ni.kristo` and manager invite
   `holyrebellionph@gmail.com` were seeded 2026-09-10. English, Spanish, French and
   Swahili (language-only teams, no leads yet) were seeded 2026-09-17 at Travis's
   request for the Saturday event; their leads apply from the Teams page.

## What this is

Assigned To Labor is a standalone web service for spreading faith-promoting videos
about The Church of Jesus Christ of Latter-day Saints. Members of the public record or
upload short videos; **managers** who are responsible for a geographic area (possibly
area + language) review the videos in a queue; approved videos are shared to social
media. Travis is the product owner. Landon pays for hosting.

In Travis's prototype it was one piece of a larger site ("The Holy Rebellion" /
"WagePeace" at theholyrebellion.org):

- An **anonymous "Quick Upload"** flow: a visitor scans a QR code, is guided through a
  3-step script builder (hook / body / call-to-action), records a short testimony video
  in the browser with a teleprompter (multi-clip, merged client-side with ffmpeg.wasm),
  and submits it with no account. Videos land in an admin review queue.
- A **member dashboard** behind login: my videos, teams ("channels") with managers who
  review/route content, team chat, gamified progress (XP, streaks, badges, weekly goals,
  reflections journal), an AI script assistant, admin review of videos and roles.
- A **native iOS/Android shell** (Capacitor) that just loads the live website in a
  WebView. It is on TestFlight as build 1.0. Bundle id `org.theholyrebellion.assignedtolabor`.

The prototype's own docs are vendored verbatim in `docs/prototype-handoff/` (written by
Travis's AI session on 2026-09-04), and the reusable source files are in
`docs/prototype-handoff/source/` (received 2026-09-09). Read `README.md`, `ARCHITECTURE.md`, and
`FEATURE-MAP.md` there for the full picture. They describe the prototype, not this repo.

## The prototype (what exists today)

- **Code:** received 2026-09-09 as `~/Downloads/wagepeace-source.zip` (8 MB, no
  secrets beyond the public anon key). Originals live on Travis's Mac at
  `~/Documents/wagepeace`. Next.js 15 App Router, React 19, TypeScript,
  inline-style React components (no Tailwind except the account page), Supabase JS.
- **Hosting:** Vercel project `wagepeace`, team `travislish-8017s-projects`, deployed by
  `vercel --prod` from Travis's laptop. No staging, no CI.
- **Data:** Supabase project `wagepeace`, ref `rmiwnhvabqhhcsixyvao`, us-west-2, PG17.
  Postgres + Auth (email/password, Google OAuth, anonymous sign-ins) + Storage (private
  `videos` bucket served via signed URLs, public `avatars` bucket). Schema was applied
  by pasting SQL into the dashboard; SQL files supposedly live in `supabase/` in his tree.
- **Access:** Travis is inviting `landoncope@gmail.com` as owner on Vercel and Supabase.
  The local Vercel CLI is logged in as a different account (`landon-5551`, team
  `drafted-commerce`) and cannot see Travis's team; log in with the gmail account or use
  the web dashboards. The `supabase` CLI is not installed.
- **Verdict so far:** treat the prototype as a spec and a source of reusable pieces (the
  recorder, the upload pipeline, the quick-upload script flow, the Supabase schema), not
  as a codebase to inherit wholesale. It bundles an unrelated ministry site, has no
  version control, and deploys straight to prod. Final call after we get the code and
  the MVP scope.

## Domains

- `assignedtolabor.org` is the **primary** domain.
- `assignedtolabor.com` **redirects** to the .org (301, preserve path).
- Both registered at Namecheap by Landon. DNS: point nameservers at DigitalOcean if we
  host there (matches Landon's other apps), otherwise Namecheap DNS with records.

## Landon's environment and conventions

- Node via asdf; `.tool-versions` pins `nodejs 24.16.0`. In non-interactive shells run
  `export ASDF_NODEJS_VERSION=24.16.0` first or node/npm/vercel will not resolve.
- Preferred hosting: **DigitalOcean App Platform** (doctl account `landoncope@gmail.com`,
  team `landoncope.dev`). Reference spec: `../landoncope.dev/.do/app.yaml` (Next.js,
  `npm run build` / `npm start`, GitHub deploy-on-push from `main`, managed Postgres,
  DO-managed domains). Vercel is acceptable if Supabase stays.
- Sibling Next.js project for conventions: `../landoncope.dev` (Next.js + Drizzle + pg +
  Tailwind v4, migrations run at container start via `scripts/migrate.mjs`).
- GitHub: `landoncope/assignedtolabor`, `gh` authenticated. `main` deploys to
  production; Landon has said merges need no sign-off, so small fixes go straight to
  `main` and larger work goes through a PR.
- Claude in Chrome: the registry can show the Mac Mini's browser (it runs the
  drafted-advertising Rails app on :3000). Verify with `http://127.0.0.1:3000` before
  trusting a tab; only this MacBook's Chrome reaches this machine's dev server.
- `psql` 17 available locally. No Docker.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Decisions (2026-09-04, confirmed by Landon unless marked proposed)

- **Standalone product** on assignedtolabor.org. Fresh codebase in this repo; the
  prototype is a spec and a parts bin, not a base.
- **MVP scope:** anonymous quick upload (QR + script builder + in-browser recorder),
  accounts with "my videos", areas with managers and a review queue, admin (roles,
  areas, review), social media sharing of approved videos. **Out:** gamification,
  native app, AI fact-checker. AI script drafting is a post-MVP nice-to-have; the
  template-based script builder (hook / body / CTA) is in.
- **Supabase** for Postgres, Auth, and video Storage. A NEW Supabase project named
  `assignedtolabor` in **Landon's own Supabase account** (Landon lacked permission to
  create projects in Travis's org, and Landon pays anyway). Free tier to start; expect
  to move to Pro ($25/mo) because Free caps uploads at 50 MB and pauses idle projects.
  Invite Travis as a read-only org member later. Storage sits behind one small module
  so it can move to an S3-compatible bucket if egress cost grows. Original video files
  are purged ~7 days after posting or rejection; metadata stays. The site never serves
  videos publicly; social media is the only outlet.
- **Hosting:** Vercel, a NEW project `assignedtolabor` in Travis's team, connected to
  GitHub `landoncope/assignedtolabor` with production deploys from `main` and preview
  deploys per PR. Never `vercel --prod` from a laptop. Uploads go browser-to-Supabase
  directly, so the app server stays small. Check which Vercel plan the team is on;
  Hobby forbids team members, so the invite implies Pro billing.
- **Stack:** Next.js (App Router) + TypeScript + Tailwind v4, supabase-js
  with generated DB types, RLS as the authorization layer, Supabase CLI migrations in
  `supabase/migrations/`. Playwright for the handful of end-to-end flows that matter
  (quick upload, review, role gating).
- **Vocabulary (2026-09-17):** the UI says **team** and **team lead** everywhere
  (Travis's words); the schema keeps `areas`, `area_managers`, `manager_invites`.
  Members of a team are `area_members`.
- **Areas:** an admin-defined name plus a language, no geo logic in the app. Travis's
  examples (2026-09-09): "Philippines / Tagalog", "West Africa / French",
  "East Africa / Swahili"; some future areas are language-only ("Spanish",
  "English"). A manager can be assigned to several areas. Uploaders pick their area
  from a list; "not sure" routes to the admin queue.
- **Social accounts:** each area (Travis calls them teams) has its own accounts.
  **Instagram first.** The area record stores the Instagram handle; posting is manual
  (assisted) for the MVP.
- **First admins:** Landon Cope (landoncope@gmail.com) and Travis Lish
  (travis.lish@gmail.com). Seed them in a migration or the first-run setup.
- **Auth:** Google sign-in + email magic link for everyone; no passwords.
  Anonymous Supabase sessions for quick upload, upgradeable to a real account. Managers
  and admins are promoted by an admin, never self-signup.
- **Social posting (two phases):** Phase 1 "assisted posting": approved videos
  land in a ready-to-post queue with the file, caption, and hashtags; a human posts from
  the platform app and marks it posted. Phase 2: automate Meta (Instagram/Facebook
  Reels) and YouTube Shorts via their APIs once app review and quota increases are
  granted. Both platforms require reviews that take weeks and cap posts per day, so
  automation cannot gate the MVP.

## Open questions (Landon is asking Travis)

1. Instagram handles for the English, Spanish, French and Swahili teams (Travis,
   2026-09-17: the leads will apply through the Teams page; admins approve them as
   leads). Philippines' lead is Brady Gordon per Travis (2026-09-17), who is getting an
   account; the seeded lead `holyrebellionph@gmail.com` ("Christian") is still a lead.

## Codebase

Next.js 16 (App Router, Turbopack, React 19), TypeScript, Tailwind v4, supabase-js +
@supabase/ssr. Read `node_modules/next/dist/docs/` before using a Next API from memory:
middleware is `src/proxy.ts`, and `params`, `searchParams`, `cookies()` are async only.

```
supabase/migrations/        schema + RLS + storage bucket (apply with npm run db:push)
supabase/config.toml        Supabase CLI config (anonymous sign-ins on)
src/proxy.ts                session refresh + redirects for /my, /review, /admin
src/lib/supabase/           client.ts (browser), server.ts (cookies), admin.ts (service role)
src/lib/auth.ts             getViewer / requireUser / requireManager / requireAdmin
src/lib/types.ts            row types, areaLabel(), STATUS_LABEL
src/lib/script.ts           hooks, body templates, CTAs, consent copy
src/lib/upload-video.ts     browser -> signed upload URL -> videos row
src/lib/merge-clips.ts      ffmpeg.wasm clip concat (runtime copied to public/ffmpeg on postinstall)
src/lib/mp4-tracks.ts       reads a recorded MP4's frame times on the device: frozen-picture check, track order
src/lib/picture-watch.ts    while recording: do the one-second slices still carry picture?
src/lib/mp4-orientation.ts  reads an MP4's rotation matrix; restores it after a merge if lost
src/lib/video-thumb.ts      thumbnail for files picked with "Upload a video I already have"
src/lib/capture-meta.ts     CaptureMeta: what the recorder saw, uploaded with each recording
src/components/             Nav, VideoRecorder (multi-clip + teleprompter), VideoPlayer (signed URL)
src/app/                    / landing, /upload flow, /qr poster, /login, /auth/*, /my,
                            /my/teams (join/start a team), /review (+/[id], /requests),
                            /admin, /api/videos/[id]/playback-url, /api/cron/{purge,notify}
```

Commands: `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`,
`npm run db:push` (after `npx supabase link --project-ref <ref>`), `npm run db:types`,
`node scripts/dev/e2e-live.mjs` (live RLS/flow test against the project in `.env.local`;
44 checks incl. teams, join-as-lead and the stranded-upload claim (it sets `auth.users.email_change`
with `psql` via `SUPABASE_DB_URL` from `.env.local`); creates and deletes throwaway
users and a Klingon test team, safe to re-run; needs captcha OFF in
Supabase for the run, and toggling it back on keeps the stored Turnstile secret). `scripts/dev/session-cookie.mjs`
mints a throwaway admin session cookie; note the Chrome automation permission layer
refuses to inject it, so browser tests of gated pages use Landon's real sign-in.

### Data model and rules

- `profiles` mirrors `auth.users` (trigger). `role` is `member` or `admin`. Admin is
  granted automatically to emails in `admin_seed_emails`. Managers are rows in
  `area_managers`; `manager_invites` holds emails that have not signed in yet and is
  applied by the same trigger on first sign-in or on anonymous-to-email upgrade.
- Teams (2026-09-17, Travis's request for the Saturday event): `area_members` (team
  membership, distinct from leads) and `team_applications` (`kind` join or start;
  `status` pending/approved/declined; start requests carry `team_name`, `language`,
  `region`, `instagram_handle`; one open request per person per target, enforced by
  partial unique indexes). Members apply from `/my/teams` (requires a real account;
  anonymous sessions are sent to sign in). Join requests are decided by the team's
  leads, start requests by admins, both on `/review/requests` (linked with a count
  from `/review` and `/admin`). Decisions go through the security-definer function
  `decide_team_application(app_id, approve, note)`, which checks who may decide and
  creates the membership, or the team plus its lead (+ member), in the same
  transaction; there is no update policy on the table. A join request can carry
  `wants_lead` ("I'd like to lead this team"); only an admin can approve a join
  request `as_lead` (4th argument), which also inserts `area_managers` with
  `notified_at` set so the approval email is the one that says "you are now a lead".
  Proposing a team whose language an active team already covers is refused by the
  server action (one team per language keeps language routing unambiguous); the
  applicant is told to ask to join it as a lead instead. Leads can read the profiles
  of applicants to and members of their teams (`profiles_select_for_leads`). Uploads:
  signed-in members (and leads) see their teams as tick-boxes on the language step
  (`myTeams` from `src/app/upload/page.tsx`); a ticked team sets `area_id` directly and
  prefills the language, otherwise routing is by language as before. The thank-you
  screen points at `/my/teams` (or sign-in). Emails (cron): `team_application` to the
  deciders (leads, admins as fallback; grouped per recipient per sweep) and
  `application_outcome` to the applicant; a newly created team's lead gets the
  approval email only (`area_managers.notified_at` is set by the function).
- `areas` = name + language + optional `instagram_handle`. Since 2026-09-12 (Travis's
  feedback) uploaders do not pick a team: they say the language they will speak
  (`videos.language`). Since 2026-09-17 (tester Braydon: iOS drew the old free-text
  datalist as a dropdown that never opened; Landon: prefer a short list) the language
  step is a list of options: a member's own team(s) first ("My team · …", the default
  for members per Travis), then English, then the languages existing teams cover, then
  "Another language" with a text box. The starting pick follows the phone's language
  (`navigator.language` via `Intl.DisplayNames`; `fil`/`tl` = Tagalog): a covered
  language is preselected, an uncovered one prefills "Another language", else English.
  A team option sets `area_id` directly; a language routes to the single active area
  with that language (`areaForLanguage`), else null = admin queue, and reviewers
  assign the team on the review page.
- Script builder (hook / body / CTA) is optional at every level (the skip controls are
  outlined buttons under Next since 2026-09-18, not faint links): each step has
  "I'll improvise this part", the first step has "Skip the script, I know what I'll
  say" and the second "Skip the rest of the script", both jumping to the language
  step (Landon, 2026-09-15: many people don't need prompts). A skipped script stores
  `script = null`; the review page then shows "No script. The uploader improvised."
- `videos.status`: pending -> approved -> posted, or pending/approved -> rejected.
  Reviewers may reopen. `script` is `{hook, body, cta}` and doubles as the caption.
- Delete (2026-09-15, Landon): the review page has a "Delete this video" link with an
  inline confirm. `deleteVideo` in `src/app/review/actions.ts` deletes the row through
  the caller's session (RLS `videos_delete_manage`: area managers, admins, admins for
  unassigned videos) and only then removes the file with the service role. Uploaders
  cannot delete their own videos; nothing is emailed. `notifications.video_id` nulls out.
- Authorization lives in RLS (`is_admin()`, `can_manage_area()`), not in app code.
  Server actions in `src/app/review/actions.ts` and `src/app/admin/actions.ts` only shape
  the write. The `guard_video_update` trigger stops uploaders changing status.
- Recorder pipeline (learned the hard way on 2026-09-11 from Landon's iPhone test):
  - The bucket allow-list rejects content types with parameters. MediaRecorder reports
    e.g. `video/mp4;codecs=avc1,mp4a`, so `upload-video.ts` sends `baseMimeType()`.
  - `@ffmpeg/ffmpeg` always starts its worker as an ES module, which can only import the
    ESM core. `scripts/copy-ffmpeg.mjs` ships the ESM core + the library's ESM worker
    into `public/ffmpeg/`, loaded by plain same-origin URLs (no blob URLs).
  - `pickRecorderMimeType()` asks for H.264 + AAC first. Bare `video/mp4` on Chrome means
    VP9-in-MP4, which the stream-copy concat cannot stitch. `mergeClips()` falls back to
    a libx264/aac re-encode if the copy fails.
  - Rotation tags are TRUE (a 2026-09-11 "fix" that stripped them made video sideways
    and was reverted). Research (WebKit source, 2026-09-11): iOS never delivers portrait
    pixels; frames are sensor-oriented with a rotation tag that `<video>`, `drawImage`,
    `videoWidth/Height` and `getSettings()` all honor. Constraints are fitted in SENSOR
    coordinates, so asking for 1080x1920 selects the 4K mode and Trim-crops a sideways
    slice: a wide band with ~32% of the vertical view. Ask for `width 1920, height 1080`
    and the upright phone reports the full frame as 1080x1920. `MediaRecorder` on iOS
    writes the sensor buffer plus a rotation matrix (from the first frame only).
  - Recorder layout (2026-09-12, Travis: "congested"): inside the frame only the script
    (with a small Hide/Show chip top-right), a vertical zoom pill on the right edge, the
    timer bottom-left and the record button; the clip strip with delete buttons sits
    below the frame.
  - The recorder therefore draws each frame into a 9:16 canvas (`startCanvasCapture`
    in `VideoRecorder.tsx`, rVFC-driven, 5 Mbps since 2026-09-18, was 8) and records that: portrait pixels, no
    rotation metadata, on every device. getUserMedia exposes the front camera's full
    wide field (reads as "0.5x" versus the Camera app), so phones and tablets start at
    1.5x; laptops and desktops start at 1x since 2026-09-18 (Landon on a MacBook: 1.5x
    was far too tight; `isHandheld()` = user agent, plus touch points for iPadOS). The
    user can pick 1x/1.5x/2x either way. Since 2026-09-17 the zoom is applied by the camera
    itself (`applyConstraints({zoom})`, which WebKit implements with
    `setVideoZoomFactor` and Android Chrome supports) whenever `getCapabilities().zoom`
    reports a plain factor range (`min <= 1`, `max >= level`; webcams reporting device
    units like 100..400 are ignored); otherwise the canvas crops and the preview is
    CSS-scaled to match. Handhelds ask the camera for 1920x1080 (sensor coordinates, so
    an upright phone gives 1080x1920); laptops and desktops ask for 3840x2160 and get
    their largest mode, because their frame is landscape and the 9:16 slice is only as
    tall as the frame: 608x1080 from a 1080p webcam (a MacBook's built-in camera), full
    1080x1920 from a 4K one. Everyone asked for 3840x2160 until 2026-09-17, when a tester's
    iPhone ran the 4K pipeline at ~15 fps. (Its 41 s clip also ended its picture at
    32.5 s; that was blamed on the load then and was almost certainly the iOS 26 writer
    bug below.)
  - **iOS 26 frozen picture (event of 2026-09-19, fixed 2026-09-20, unconfirmed on
    hardware).** Symptom: the file's picture stops 10 to 24 s in and the sound runs to
    the end; in the MP4 the last video sample is simply given a duration of a minute or
    more, so both tracks report the same length. It hit 11 of the 12 iPhones on iOS 26
    (Safari and Chrome; the twelfth clip was 17 s); the one iPhone on iOS 18 recorded
    147 s intact; no Android. Safari 26 freezes the OS token in its user agent at
    `18_6`/`18_7`, so read `Version/26.x`, not `iPhone OS`. Cause: we called
    `rec.start()` with no timeslice. WebKit then holds every encoded frame in memory and
    writes the whole recording in one burst at `stop()`; on iOS 26 the MP4 writer chokes
    on the burst and drops the rest of the picture while keeping the sound (WebKit bugs
    299164 and 320943; 315091 reproduces it with a plain camera, no canvas, still open).
    It was never the canvas, the camera, GC or load: the draw loop ran at 30/s with no
    stall in every case, which is why the 2026-09-17 watchdog saw nothing. The tester
    freeze of 2026-09-17 (video 32.5 s of 40.8 s) was almost certainly the same bug, not
    the 4K load it was blamed on. Fix: **`rec.start(SLICE_MS)` with 1 s slices, never
    `rec.start()`**; frames are then written every second through the working path.
    Safari sends empty slices in between (skipped). Three nets behind it, because the
    page cannot see the loss happen: (1) `src/lib/mp4-tracks.ts` `readPicture()` reads
    the finished clip's frame times on the device (moof/trun or stts, headers only, a few
    ms) and finds the longest time one frame is held; over 1.5 s the clip gets a red
    "froze" badge and the uploader is told to retake it or to record with the camera app
    and use "Upload a video I already have"; (2) the same check on the final file goes
    up as `capture_meta.picture` and the review page prints a red line when it is bad;
    (3) `src/lib/picture-watch.ts` watches the slice sizes while recording and ends a
    clip whose file grows by sound alone for 6 s (checked by
    `node scripts/dev/picture-watch-check.mjs`). Audit stored files with
    `node scripts/dev/freeze-audit.mjs [since]` (ffprobe packet times, read-only) and
    local files with `node scripts/dev/mp4-tracks-check.mjs f.mp4`.
  - Two pipelines (2026-09-20). `canvas` is the default everywhere and is what the
    field has proven. `camera` (opt-in: `/upload?rec=camera`) hands MediaRecorder the
    camera's own stream when the frame is already a 9:16 portrait and any zoom is the
    camera's; without camera zoom it records at 1x and hides the zoom pill. It skips
    drawImage and the canvas readback (through the canvas the event's iPhones wrote 21
    to 27 fps and three cheap Androids 8 to 10 fps). An iPhone file is then landscape
    pixels plus a -90 rotation matrix, like the Camera app's; the ffmpeg.wasm stream-copy
    merge keeps the matrix (tested with synthetic clips; `restoreMp4Orientation` repairs
    it if a build ever drops it). Tested only with Chrome's fake camera so far, never on
    a phone: that is why it is opt-in. `capture_meta.pipeline` says which one recorded.
  - Merge and track order (2026-09-20): Chrome writes a recording's tracks in whichever
    order their first data arrived, so clips from one session can be video+audio and
    audio+video. ffmpeg's concat pairs streams by position, and the mismatched clip was
    lost from the merged file while ffmpeg reported success (2 of 8 two-clip runs in
    desktop Chrome; nothing stored was affected, the only merged upload so far came
    from an iPhone). `mergeClips` now reads each clip's track order and rewrites the odd
    ones (stream copy) in the first clip's order before the concat.
  - Thumbnails (2026-09-20): they show what the file shows, the same 9:16 crop and the
    true image. The preview is a CSS mirror, the recording never was, and thumbnails
    used to copy the mirror, so posters in the review queue flipped when played. Files
    picked with "Upload a video I already have" get a thumbnail too
    (`src/lib/video-thumb.ts`: hidden muted element, played, first frame about 1 s in;
    "" when the browser cannot decode the file). On 2026-09-20 the 27 thumbnails stored
    before the fix were un-mirrored in the database (checked against the videos' first
    frames) and the 5 picked files without one got theirs from the stored file with
    ffmpeg. Flipping again would undo it: never re-run that.
  - Freeze defences (2026-09-17): the preview `<video>` has no `autoplay` attribute
    (iOS pauses autoplaying elements it decides are off screen, and WebKit bug 230922
    froze autoplaying MediaStream elements outright); `play()` is called by us and again
    on any `pause` event. The rVFC callback is re-armed before `drawImage` so a throw
    cannot break the chain. A 100 ms watchdog repaints the last frame when no new frame
    arrived for 250 ms, so the recorded video track can never end before the audio, and
    it logs the stall. Track `mute`/`unmute`/`ended` events are logged too.
  - Audio (2026-09-17, tester: "sounds worse than my phone's camera"): the mic is
    requested with `echoCancellation`, `noiseSuppression` and `autoGainControl` all
    false. On iOS the default (echo cancellation on) selects WebKit's voice-processing
    audio unit, i.e. phone-call audio; with it off WebKit uses a plain non-VPIO unit
    (confirmed in `CoreAudioCaptureSource.cpp`). Nothing plays back while recording, so
    there is no echo to cancel. `audioBitsPerSecond` is 192 kbps (iOS already gave
    ~186 kbps AAC mono; Chrome's default is lower).
  - Diagnostics: every recording uploads `videos.capture_meta` (type `CaptureMeta` in
    `src/lib/capture-meta.ts`): device/browser from the UA, camera frame size, canvas
    size, codec, achieved fps, zoom and whether the camera or the canvas did it, clip
    count, seconds of repeated frames, and timestamped events (frames stopped/resumed,
    preview paused, track muted). The review page prints it under the uploader line, so
    the next "it froze" report can be read there instead of pulling the file apart.
    The capture size is also logged to the console (`[recorder] camera WxH …`).
    Diagnose files with `node scripts/dev/mp4-orientation-check.mjs f.mp4`, by
    extracting frames with and without `-noautorotate`, and with
    `ffprobe -select_streams v:0 -show_entries frame=pts_time` (compare the last video
    pts with the last audio packet pts; a video track that ends early plays as a freeze).
  - Full-flow test with a fake camera (exercises the portrait crop, merge, and upload
    through the real UI): build, `npx next start -p 3001`, then
    `node scripts/dev/headless-upload-flow.mjs http://127.0.0.1:3001 fake-cam.y4m`
    where the y4m comes from `ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 3
    -pix_fmt yuv420p fake-cam.y4m`. It uploads as `uploader_name = headless-flow`;
    delete that row, file, and anonymous user afterwards. Options: `--no-upload` stops
    at the review step (no captcha juggling), `--save out.mp4` writes the recorded file
    for ffprobe, `--clip-seconds 25` for long takes, `--query rec=camera` with a
    360x640 y4m for the camera pipeline. Run long tests under `caffeinate -dimsu`: the
    Mac slept mid-run once and the recording lost ten seconds. Clips from disk go
    through the real merger with `node scripts/dev/headless-merge-files.mjs
    http://127.0.0.1:3001/dev/merge a.mp4 b.mp4` (reports orientation before and after);
    the `/dev/merge` page also inspects one file (thumbnail plus frozen-picture check).
  - Self test: `ENABLE_DEV_PAGES=1 npx next build && ENABLE_DEV_PAGES=1 npx next start -p 3001`
    then `node scripts/dev/headless-merge-test.mjs http://127.0.0.1:3001/dev/merge`
    (records two synthetic clips in this Mac's Chrome via playwright-core, merges,
    uploads as `uploader_name = dev-merge-test`; delete those rows afterwards). The
    `/dev/merge` page 404s unless `ENABLE_DEV_PAGES=1`, which Vercel never sets. Do not
    run it against `next dev`: the HMR socket fails under the tool sandbox and reloads
    the page mid-test.
- Upload resilience (2026-09-18): `uploadVideo` tries up to three times, each with a
  fresh path and signed URL, aborts an attempt that makes no progress for 45 s, and
  retries only on network errors and 408/425/429/5xx; "too large" and other 4xx fail
  at once with a plain message. A lost response can orphan an object (accepted). The
  upload and the live camera hold a screen wake lock where the browser has one, and
  the progress line says to keep the page open.
- Files: private `videos` bucket at `{user_id}/{ts}.{ext}`, 500 MB cap. Playback is a
  1-hour signed URL from `/api/videos/[id]/playback-url` using the caller's session.
  `/api/cron/purge` (daily, `CRON_SECRET` bearer) deletes files 7 days after posted or
  rejected and sets `file_purged_at`.
- `src/proxy.ts` forwards a stray `/?code=` (Supabase site-URL fallback) to
  `/auth/callback` so sign-in still completes if the allow list ever misses.
- Email links use token hashes, not PKCE codes, so they work on any device (people
  upload from a phone and read mail on a laptop). `/auth/confirm?token_hash=&type=&next=`
  calls `verifyOtp`. The Supabase templates "Magic link or OTP" (type=magiclink),
  "Confirm sign up" (type=signup) and "Change email address" (type=email_change, the
  anonymous-to-account upgrade) were rewritten 2026-09-11 with Assigned To Labor
  wording and point at that route. Edited in the dashboard: subject input id
  `MAILER_SUBJECTS_*`, body via `window.monaco.editor.getModels()[0].setValue()`.
- Email sending: Supabase custom SMTP via Resend (host smtp.resend.com:465, user
  `resend`, password = the Resend API key, sender no-reply@assignedtolabor.org). Resend
  domain `assignedtolabor.org` (id bd5e0fee-ae29-42c7-8b93-f8bd6dcdbd56, us-east-1) with
  DKIM/SPF/MX/CNAME records at Namecheap. VERIFIED 2026-09-12 after ~14 hours of
  "pending" with provably correct DNS (Amazon-side delay; re-creating the domain issued
  the same DKIM key). A magic-link test was delivered. A parallel `.com` registration
  was deleted, unused.
- Anonymous upload: `signInAnonymously()` on submit; "Keep me posted" calls
  `updateUser({email})`, which turns the same user into a real account after they
  confirm. Anonymous sessions are redirected away from /review and /admin but may see /my.
- Stranded uploads (2026-09-17): two of two testers typed their email on the
  thank-you screen and then tapped "Sign in" instead of the confirmation link, which
  made a new, empty account while the video stayed with the anonymous user (whose
  `auth.users.email_change` still holds the typed address). `/my` now calls
  `claimable_uploads()` (security definer: videos of anonymous users whose pending
  email equals the caller's confirmed email, not yet declined) and shows "Is this
  yours?" with `claim_uploads()` / `decline_uploads()` (`videos.claimed_from`,
  `videos.claim_declined_at`). The claim runs with `app.claiming = on`, which
  `guard_video_update` honours. The confirmation-link path still works as before.
- Notifications (2026-09-11): `/api/cron/notify` runs every 5 minutes (Vercel cron,
  `CRON_SECRET` bearer) and sends through Resend via `src/lib/email.ts`:
  managers get one email per sweep listing new pending videos in their areas (admins
  when an area has no managers or the video has no area); uploaders with a confirmed
  email hear when a video is posted or not selected; people added as managers or
  invited by email are told. Bookkeeping columns: `videos.managers_notified_at`,
  `videos.uploader_notified_status`, `area_managers.notified_at`,
  `manager_invites.notified_at`; every send is logged in `notifications`. Items are
  marked only after Resend accepts the message, so failures retry next sweep.
  A recipient gets at most one `new_videos` digest per 30 minutes
  (`DIGEST_MIN_MINUTES`); a video whose recipients include a throttled one stays
  pending and rides the next digest. `?dry=1` returns the plan without sending. Test: `node scripts/dev/notify-dryrun.mjs`
  against a local `next start -p 3001`. PostgREST joins from `videos` to `profiles`
  must name the FK (`profiles!videos_user_id_fkey`): the table has three links to it.
- `guard_video_update` lets callers with no user id through (service role, migrations);
  it only constrains authenticated uploaders. Fixed 2026-09-11 after it blocked a
  migration and would have blocked the purge cron.
- Branding: the logo is a navy + gold wheat sheaf (Midjourney, 2026-09-11). Source in
  `public/brand/logo-full.png` (1146x1523 RGBA, transparent), web size in
  `public/brand/logo.png` (720 tall). Favicon `src/app/icon.png` and manifest icon
  `public/brand/icon-256.png` are the whole sheaf on a transparent square (Landon
  rejected a cropped-ear favicon 2026-09-11); `src/app/apple-icon.png` is the sheaf on
  the cream background.
  `src/components/Mark.tsx` renders the logo at a given height. Social preview is
  generated by `src/app/opengraph-image.tsx` (`twitter-image.tsx` re-exports it) and
  embeds the logo as a data URL. Palette follows the logo: navy `#002850` (accent),
  gold `#e09838` in the art, `#c98a2f` for gold text so it stays legible.
- Bot protection (2026-09-12): Cloudflare Turnstile widget "Assigned To Labor"
  (Landon's Cloudflare account, Managed mode, hostnames assignedtolabor.org, localhost,
  vercel.app). `src/components/Turnstile.tsx` renders the challenge on the upload
  review step and the magic-link form; the token goes to Supabase as `captchaToken`
  on `signInAnonymously` and `signInWithOtp`. Enforcement is Supabase's: Authentication
  -> Attack Protection -> Captcha -> Turnstile with the secret key (only Landon types
  it). ENFORCED since 2026-09-15: `node scripts/dev/captcha-check.mjs` shows both
  `signInAnonymously` and `signInWithOtp` rejected without a token ("captcha
  protection: request disallowed"), and a real upload through the live site with the
  widget succeeded the same day. Without `NEXT_PUBLIC_TURNSTILE_SITE_KEY` the widget is
  absent, so local builds and the headless tests run with
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY= npx next build`. With enforcement on,
  `scripts/dev/e2e-live.mjs` and the headless flow cannot sign in anonymously against
  the live project; switch captcha off in Supabase for a test run and back on after.
- Env vars (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `RESEND_API_KEY`,
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
  Template in `.env.example`.

## Working rules for Claude in this repo

- Update this file when any decision above is made, and keep the Status section dated.
- Do not put secrets in the repo; only env var names. Template goes in `.env.example`.
- Every schema change ships as a migration file in the repo, never a dashboard paste.
- Nothing deploys straight to production from a laptop; deploys come from `main`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
