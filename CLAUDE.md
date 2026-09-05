# Assigned To Labor

Owner: Landon Cope (landon@highpsiproducts.com). Product owner: Travis (non-technical).
Claude owns this repo: language, dependencies, architecture, and this file. Keep CLAUDE.md
current whenever a decision is made or reversed. Dates below are absolute (YYYY-MM-DD).

## Status (2026-09-04)

Pre-MVP. Requirements and stack are decided (see "Decisions"). Next: scaffold the app
and schema. Still waiting on Travis's source zip (prompt in
`docs/travis-code-handoff-prompt.md`) and on the social-media answers below. Needed
from Landon before anything can run: the new Supabase project and the new Vercel
project in Travis's accounts (see "Account setup").

## Account setup (one-time, needs dashboard access)

1. Supabase (Landon's account): New project `assignedtolabor`, region us-west-2. Save
   the database password in a password manager. Enable Google and Email (magic link)
   providers and anonymous sign-ins. PENDING.
2. Vercel: team `travislish-8017s-projects` -> project from GitHub
   `landoncope/assignedtolabor`. DONE 2026-09-04.
3. Google Cloud: OAuth client for Google sign-in (Supabase docs give the redirect URL).
4. Namecheap: point `assignedtolabor.org` at Vercel; add `.com` as a redirect domain.

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
Travis's AI session on 2026-09-04). Read `README.md`, `ARCHITECTURE.md`, and
`FEATURE-MAP.md` there for the full picture. They describe the prototype, not this repo.

## The prototype (what exists today)

- **Code:** lives ONLY on Travis's Mac at `~/Documents/wagepeace` (iCloud-synced, no git
  remote). We do not have a copy yet. Next.js 15 App Router, React 19, TypeScript,
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
- GitHub: `landoncope/assignedtolabor`, `gh` authenticated. Work on branches, PRs
  into `main`; `main` deploys to production.
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
- **Areas:** an admin-defined name plus a language (no geo logic in the app). A
  manager can be assigned to several areas. Uploaders pick their area from a list.
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

1. Social accounts: one central Assigned To Labor account per platform, or one per
   area owned by the manager? Which platforms first (Instagram, YouTube, TikTok,
   Facebook, X)?
2. Does Travis have Meta/YouTube business accounts already, or do we create them?
3. Are there existing managers or areas to seed?

## Working rules for Claude in this repo

- Update this file when any decision above is made, and keep the Status section dated.
- Do not put secrets in the repo; only env var names. Template goes in `.env.example`.
- Every schema change ships as a migration file in the repo, never a dashboard paste.
- Nothing deploys straight to production from a laptop; deploys come from `main`.
