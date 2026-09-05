# Feature map — where things live

Paths are relative to the repo root.

## Member dashboard — `app/wagepeace/dashboard/`
- **`UserDashboard.tsx`** — the shell: sidebar (desktop) / bottom nav + "More" sheet
  (mobile ≤768px), sticky topbar (notifications bell, a **chat bubble**, Upload button,
  profile avatar menu), and the tab switch. Also renders the Upload modal, onboarding,
  and admin tab. Theme toggle + `data-theme` handling live here too.
  - **Chat bubble** (topbar): opens your one team chat directly, or a dropdown to pick
    when you're in several. Team chats are `teamOptions`/`openTeamChat`.
- **`JourneyTab.tsx`** — the **Home** tab: "Welcome back", a combined progress card
  (level/XP + streak + next badge), the weekly **Goals** card, and sub-tabs
  (Reflections journal, Milestones, Teams, Network). Exports the shared journey types.
- **`ContentTab.tsx`** — **My Videos** (card list on mobile, table on desktop; status
  filters). `VideoDetail` plays a video via the signed-URL player.
- **`TeamsTab.tsx`** — join/lead channels, "my teams", the network directory.
- **`teamhome/TeamHome.tsx`** — a channel's manager view (Overview / Roster / Forms;
  vitals, "Needs you", content plan review). **`teamhome/TeamChat.tsx`** — team chat
  (opened from the topbar chat bubble; the tab buttons for it were removed).
- **`ScriptBuilderTab.tsx`** — the **Script Assistant** ("Assistant" tab): a
  Connect-to-Aligned.ai onboarding gating a **Script Builder** (streamed draft) and a
  **Fact Checker** (per-claim verdicts). Backed by `app/api/aligned/*`. **aligned.ai is
  not wired yet** — see `ROADMAP.md`.
- **`admin/AdminDashboard.tsx`** — video review, manager-application approvals, roles.
- **`UploadModal.tsx`** — "Upload a video": choose **Record now** (the recorder) or
  drag/drop a file → details (team/language) → `uploadVideo`.

## The recorder — `components/VideoRecorder.tsx` (+ `lib/merge-clips.ts`)
Reusable, used by both Quick Upload and the dashboard Upload modal.
- **Multi-clip**: tap the red button to record a clip, tap to stop; each clip is its own
  file with a thumbnail + **✕ to delete just that clip**. "Start over" clears all.
- **Done** → 1 clip is used directly; **≥2 clips are merged in-browser** via
  `lib/merge-clips.ts` (**ffmpeg.wasm**, lazily loaded from **`public/ffmpeg/`** — a
  ~32 MB self-hosted core, cached after first use). Merge uses `-c copy` (lossless);
  fall back to re-encode if a device shows glitches (see `GOTCHAS.md`).
- Intro before the **first** clip only: 2s "3 tips" → fade → 3-2-1 countdown. Props:
  `onCapture(file)`, `onCancel?`, `showTips?`.

## Anonymous Quick Upload — `app/assignedtolabor/quickupload/`
- **`QuickUpload.tsx`** — the full-screen guided flow (dark shell in `layout.tsx`):
  `landing → consent (2 statements) → hook → body → cta → record → account`.
  - The **script builder** is 3 steps: pick a **Hook**, a **Body** starter
    (Testimony / Hope / Faith fill-in-the-blank, or "Write your own"), and a
    **Call-to-action** — assembled into a teleprompter shown on the record screen.
    Each step has "I'll improvise this step". Data: `HOOKS`, `TEMPLATES`, `CTAS`.
  - Uploads anonymously to the **admin queue**; then a popup invites account creation
    (which upgrades the anon session → dashboard).
- **`app/assignedtolabor/qr/page.tsx`** — printable QR (`qrcode.react`) pointing at the
  quickupload URL. `app/quick/page.tsx` redirects to it.

## Account — `app/wagepeace/account/AccountSettings.tsx` (Tailwind)
Tabs: **Profile Photo** (native picker + client resize→JPEG), **Appearance**
(dark-mode toggle, shares `thr_theme` with the dashboard), **Email**, **Password**,
**Notifications**. Prominent top-right "← Dashboard" link.

## Native glue — `lib/native.ts`, `components/NativeInit.tsx`, `components/AdSense.tsx`
See `ARCHITECTURE.md`. `isNativeApp()`, the `.capacitor-native` class, plugin init,
external-link interception, web-only AdSense.

## API routes — `app/api/`
`videos/[id]/playback-url` (signed URL, authz), `team/*` (member/video decisions),
`aligned/{generate,fact-check}` (Script Assistant proxy — Claude fallback today),
`videos/cleanup` (cron retention), `instagram/*` (Meta sync), plus onboarding/goal/
channel helpers.
