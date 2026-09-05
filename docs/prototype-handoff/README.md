# Project Handoff — The Holy Rebellion / WagePeace + "Assigned to Labor"

Welcome, Landon. This folder is a written brief of the project, compiled so you can
pick it up without re-deriving everything. Start here, then read the topic files.

## What this project is
Two things that share **one codebase**:

1. **The website** — `https://theholyrebellion.org` — a Next.js app with a marketing
   site plus an **authenticated member dashboard** (`/wagepeace/dashboard`) for a
   faith-video ministry: members upload short testimony videos, join channel "teams,"
   chat, track progress, and managers review/route content.
2. **"Assigned to Labor" — the iOS/Android app** — a **Capacitor** shell that loads
   the *live website* in a native WebView (see `ARCHITECTURE.md`). It also powers an
   **anonymous "Quick Upload"** flow (no login) at
   `/assignedtolabor/quickupload`, shareable via a printable QR page.

The app is on **TestFlight** already (build 1.0). Web changes go live on every deploy;
native changes require a rebuild (details in `DEPLOYMENT-AND-IOS.md`).

## Quickstart (local dev)
```bash
# repo lives at ~/Documents/wagepeace (NOTE: iCloud-synced — see GOTCHAS.md)
npm install
cp .env.local.example .env.local     # then fill in the values (ask Travis / copy from Vercel)
npm run dev                           # http://localhost:3000
```
There is **no git remote** — deploys happen from the local tree via the Vercel CLI
(`DEPLOYMENT-AND-IOS.md`). Setting up a git remote is an early recommended task.

## The docs in this folder
| File | What's in it |
|---|---|
| `ARCHITECTURE.md` | Stack, the Capacitor "load the live site" model, routes, auth |
| `DEPLOYMENT-AND-IOS.md` | Vercel deploy, env vars, the iOS build + TestFlight process |
| `SUPABASE.md` | DB project, auth, storage buckets, the video upload pipeline |
| `FEATURE-MAP.md` | Every major feature → the files that implement it |
| `GOTCHAS.md` | **Read this early.** Hard-won pitfalls that will waste your day otherwise |
| `ROADMAP.md` | Outstanding/planned work (esp. the aligned.ai Script Assistant) |
| `ACCESS.md` | Accounts, ownership, and where secrets live |

## Key facts at a glance
| Thing | Value |
|---|---|
| Prod site | `https://theholyrebellion.org` |
| Vercel project / team | `wagepeace` / `travislish-8017s-projects` |
| Supabase project (ref) | `wagepeace` / `rmiwnhvabqhhcsixyvao` (org "Travis", us-west-2, PG17) |
| App bundle id | `org.theholyrebellion.assignedtolabor` |
| Apple Developer Team ID | `7P44FG5YD5` |
| iOS repo path | `~/Documents/wagepeace/ios` (Capacitor 8, Swift Package Manager) |
| Stack | Next.js 15 (App Router, React 19, TS) · Supabase · Capacitor 8 · Vercel |

## House style (so your code matches)
- Components are **React with inline `style={{}}` objects** and `<style>@media` blocks
  for responsive rules — **not** Tailwind — **except** `app/wagepeace/account/*` which
  uses Tailwind. Match whatever the file you're editing already uses.
- Theme via CSS custom properties (`var(--text)`, `var(--bg-elev)`, `var(--accent)`,
  `var(--line)`, …) defined in `app/globals.css`; dark mode toggles `data-theme="dark"`.
- Mobile breakpoint for the dashboard shell is **≤768px** (sidebar → bottom nav).
