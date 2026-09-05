# Roadmap / outstanding work

Status as of the handoff. Nothing here is blocking the app from running; these are the
open threads.

## 1. aligned.ai Script Assistant (biggest pending integration)
The **Script Assistant** UI (`app/wagepeace/dashboard/ScriptBuilderTab.tsx`) and its API
routes (`app/api/aligned/generate`, `app/api/aligned/fact-check`) are built and live
behind a "Connect to Aligned.ai" onboarding, but the aligned.ai integration is **stubbed**:
- `generate` currently **falls back to Claude** (`ANTHROPIC_API_KEY`) — a faith/history/
  apologetics-tuned writer that streams a draft. Works today.
- `fact-check` returns a **placeholder** (no real fact-check yet).
- The routes branch on `ALIGNED_API_KEY` and point at *guessed* endpoints
  (`api.aligned.ai/v1/...`). Travis is obtaining aligned.ai API access.
**To finish:** from aligned.ai you need the base API URL + auth (API key vs OAuth
"sign in with aligned"), the request/response shapes for generate + fact-check (ideally a
% truthful score + per-claim verdicts — the UI already renders claims), and the correct
signup URL for the Connect screen. Then set `ALIGNED_API_KEY` and wire the two routes.

## 2. Native app polish → App Store submission
The app is on TestFlight (remote-loaded dashboard). Before public App Store release:
- **Apple Guideline 4.2 (minimum functionality):** a remote-loaded WebView app can be
  rejected as "just a website." The native recorder helps; **push notifications** + more
  native touches strengthen the case. Plan for this in the submission phase.
- Verify the full logged-in dashboard on real devices (safe-areas, tap targets, external
  links opening in the system browser).
- Native **Google Sign-In** (currently email/password only in-app).
- **Android**: the `android/` project exists but hasn't been through Play Console (new
  individual accounts need a ~14-day / 12-tester closed-testing window — start early).

## 3. Video lifecycle / retention
Plan (mostly designed, verify live): private bucket + signed URLs (done); a **daily cron
retention job** (`app/api/videos/cleanup`) to delete files ~7 days after a video is
posted or rejected, guarded by `CRON_SECRET` via `vercel.json`. Confirm the cron is
scheduled and the purge behaves (sets `file_purged_at`, nulls `storage_path`, keeps the
metadata row).

## 4. Anonymous Quick Upload hardening
Anyone can submit without an account (moderation gate = the pending-review admin queue).
Before wide promotion, add **rate-limiting / abuse controls**. Also, all quick uploads
currently route to the **admin** queue even for logged-in members — team-member →
team-manager routing is a possible enhancement.

## 5. Housekeeping / recommended
- Add a **git remote** + PR review flow (none today).
- Consider **moving the repo out of iCloud** (kills the Xcode build gotcha).
- Optional: a **staging/preview** deploy so prod isn't the only target.
- There is a longer-form planning doc on Travis's machine at
  `~/.claude/plans/assigned-to-labor-app-moonlit-engelbart.md` (Claude Code plan file) —
  it captures the detailed task history if you want more context.

## Recently completed (so you don't redo them)
Multi-clip recorder + in-browser merge · TestFlight build 1.0 · native shell (hide
navbar/Google in-app, safe-areas, status bar, splash, icon) · Quick Upload 3-step script
builder · dark mode in Account settings · topbar chat bubble · profile-photo picker fix ·
admin-in-dashboard tab.
