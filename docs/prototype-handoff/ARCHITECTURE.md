# Architecture

## Stack
- **Next.js 15** (App Router) · **React 19** · **TypeScript**.
- **Supabase**: Postgres + Auth (email/password, Google OAuth, anonymous) + Storage.
  Cookie-based SSR auth via `@supabase/ssr` (`lib/supabase/server.ts` for server
  components/route handlers, `lib/supabase/client.ts` for the browser).
- **Vercel**: hosting + serverless functions (the `/api/*` routes) + cron.
- **Capacitor 8**: wraps the web app as native iOS/Android (`ios/`, `android/`).

## The most important architectural idea: "Pattern A" (remote-loaded app)
The native app is **not** a separate build of the UI. It's a thin native shell whose
WebView **loads the live website** — `capacitor.config.ts` → `server.url =
https://theholyrebellion.org/wagepeace/login`. Consequences:

- **99% of changes are web changes.** Edit code → `vercel --prod` → the app shows it on
  next launch/refresh. No app re-release, no App Store review. TestFlight testers get
  web changes automatically.
- **Only native-shell changes need a rebuild + new TestFlight build**: app icon/splash,
  native plugins, iOS permissions, the `server.url`, version number. (See
  `DEPLOYMENT-AND-IOS.md`.)
- The app injects a **`window.Capacitor`** bridge, so the web code can detect it's
  running in the app and adapt.

### How the web code knows it's "in the app"
- `lib/native.ts` → `isNativeApp()` checks `window.Capacitor?.isNativePlatform?.()`.
- `components/NativeInit.tsx` (mounted in `app/layout.tsx`) runs only inside the app:
  adds a **`.capacitor-native`** class to `<html>` (a synchronous `<head>` script in
  `app/layout.tsx` also sets it before paint to avoid flashes), initializes native
  plugins (status bar overlay, splash hide, keyboard, Android back button), and routes
  external / `target=_blank` links to the system browser via `@capacitor/browser`.
- CSS in `app/globals.css` keyed on `.capacitor-native` hides web-only chrome in the
  app (the site `Navbar`, the "Continue with Google" button, etc.).
- `components/AdSense.tsx` loads Google AdSense **web-only** (never in the app — ad
  scripts can hijack the WebView; also App Store risk).

## Route map
| Path | Purpose | Auth |
|---|---|---|
| `/` | Marketing homepage (`app/page.tsx`) | public |
| `/assignedtolabor` | "Assigned to Labor" landing page | public |
| `/assignedtolabor/quickupload` | **Anonymous** guided video upload flow | public (anon Supabase session) |
| `/assignedtolabor/qr` | Printable QR that points at the quickupload URL | public |
| `/quick` | Server redirect → `/assignedtolabor/quickupload` (legacy app entry) | public |
| `/wagepeace/login` | Member login (email/pw; Google web-only) — **the app's entry** | public |
| `/wagepeace/dashboard` | Member dashboard (home, videos, teams, chat, admin) | gated |
| `/wagepeace/account` | Account settings (photo, appearance, email, password) | gated |
| `/wagepeace/admin`, `/wagepeace/leader` | Standalone admin/leader surfaces | gated |
| `/api/*` | Route handlers (video playback URLs, team decisions, aligned.ai proxy, instagram sync, cron cleanup, …) | mixed |

`middleware.ts` gates `/wagepeace/dashboard|admin|leader`, redirects unauthenticated
users to login, and redirects already-authenticated users away from `/wagepeace/login`
→ dashboard. The dashboard itself renders the onboarding flow for brand-new accounts.

## Data flow (video upload, the core loop)
1. A member (dashboard **Upload** modal) or an anonymous visitor (**Quick Upload**)
   records/selects a video.
2. `lib/upload-video.ts` `uploadVideo(...)` validates it, uploads to the **private
   `videos`** Storage bucket, and inserts a `videos` row (`status: "pending"`). With a
   `channelId` it also links `video_channels` (goes to that team's manager); **without**
   a channel it shows only in the **admin review queue**. Quick Upload omits the channel.
3. Reviewers (admin / channel manager) watch via a **short-lived signed URL** minted by
   `app/api/videos/[id]/playback-url/route.ts` (private bucket — no public URLs).
4. Approve / reject / post flows update the row; a retention job removes files ~7 days
   after posted or rejected (see `SUPABASE.md` / `ROADMAP.md`).
