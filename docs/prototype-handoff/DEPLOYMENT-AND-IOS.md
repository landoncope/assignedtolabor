# Deployment & the iOS app

## Web deploy (Vercel)
There is **no git remote / no CI** — deploys run from the local tree:
```bash
cd ~/Documents/wagepeace
vercel --prod --yes          # (Travis's machine used the absolute path /Users/travislish/node/bin/vercel)
```
- Vercel project **`wagepeace`**, team **`travislish-8017s-projects`**. Aliased to
  `theholyrebellion.org`.
- **Every deploy goes straight to production** — there is no staging. Because the app
  loads the live site, a deploy affects both the website and the app. If you want a
  safe preview flow, set up Vercel preview deployments / a staging alias (recommended).
- **Standard pre-deploy checks** used throughout the project:
  ```bash
  npx tsc --noEmit -p tsconfig.json     # types
  npx next build                        # full build
  ```

## Environment variables
Set in the **Vercel dashboard** (Project → Settings → Environment Variables) and locally
in `.env.local` (git-ignored; template is `.env.local.example`). Names in use:

| Var | What |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** — service role, used by API routes / cron |
| `NEXT_PUBLIC_SITE_URL` | Canonical site origin (used e.g. for OAuth redirect) |
| `ANTHROPIC_API_KEY` | **Secret** — Claude, powers the interim Script Assistant writer |
| `ALIGNED_API_KEY` | **Secret** — aligned.ai (NOT set yet; see `ROADMAP.md`) |
| `CRON_SECRET` | **Secret** — bearer token guarding cron endpoints |
| `META_APP_ID` / `META_APP_SECRET` / `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram/Meta sync integration |

Never commit real values. Only variable **names** appear in code and in this doc.

## The iOS app (Capacitor 8)
- **Identity:** appId `org.theholyrebellion.assignedtolabor`, appName "Assigned to Labor".
- **Entry:** `capacitor.config.ts` → `server.url = https://theholyrebellion.org/wagepeace/login`,
  plus `server.allowNavigation: ["theholyrebellion.org", "*.theholyrebellion.org"]`
  (**critical** — see `GOTCHAS.md`).
- **Plugins (Swift Package Manager — NO CocoaPods):** `@capacitor/{app,browser,keyboard,
  splash-screen,status-bar,camera}`. After changing plugins/config: `npx cap sync ios`.
- **Permissions** already in `ios/App/App/Info.plist`: camera, microphone, photo library,
  plus `ITSAppUsesNonExemptEncryption=false` (skips the TestFlight export-compliance prompt).
- **App icon + splash** generated with `npx @capacitor/assets generate --ios` from
  `assets/logo.png` on a dark (`#0b0b0f`) background.

### Building the app (the working recipe)
The repo is under **iCloud Drive** (`~/Documents`), which breaks Xcode/`cap run ios`
signing (`xattr` "resource fork" errors). Build into `/tmp` instead:
```bash
cd ~/Documents/wagepeace && xattr -cr ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'id=<simulator-udid>' \
  -derivedDataPath /tmp/atl-derived build
xcrun simctl install <udid> /tmp/atl-derived/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch <udid> org.theholyrebellion.assignedtolabor
```
**Durable fix (recommended):** move the repo out of iCloud (e.g. `~/Developer/wagepeace`)
so this whole class of problems disappears.

### Signing / TestFlight
- Signing is configured in `ios/App/App.xcodeproj/project.pbxproj`:
  `DEVELOPMENT_TEAM = 7P44FG5YD5`, `CODE_SIGN_STYLE = Automatic`,
  `CODE_SIGN_IDENTITY = "Apple Development"`.
- **Gotcha that cost hours:** `xcodebuild archive` with automatic signing fails with
  *"your team has no devices"* until a real device is **registered**. Fix: connect an
  iPhone, enable **Developer Mode** (Settings → Privacy & Security — only appears after
  the device is connected to Xcode), and **Run** the app to it once. After that the
  archive succeeds.
- **To ship a TestFlight build:** Xcode → set destination to *Any iOS Device* →
  **Product → Archive** → Organizer → **Distribute App → App Store Connect → Upload**.
  Processes in App Store Connect (~5–20 min) → appears under **TestFlight** → add
  internal testers → they install via the TestFlight app. App Store Connect app record
  bundle id is `org.theholyrebellion.assignedtolabor`.
- Android exists (`android/`) but hasn't been through Play Console yet.
