# Gotchas — read this early

These each cost real time to discover. In rough order of "will bite you":

## 1. The repo is in iCloud → Xcode builds fail
`~/Documents` is iCloud-synced. iCloud re-applies xattrs that break codesigning
("resource fork, Finder information, or similar detritus not allowed") and the build DB
throws disk-I/O errors. `npx cap run ios` fails for this reason.
**Fix per build:** `xattr -cr ios` then `xcodebuild ... -derivedDataPath /tmp/atl-derived`
(build into `/tmp`, outside iCloud). **Real fix:** move the repo to a local folder like
`~/Developer/wagepeace`.

## 2. `server.url` with a path needs `allowNavigation`
Because `capacitor.config.ts` `server.url` includes a path (`/wagepeace/login`),
Capacitor's in-WebView host matching misfires and **same-site navigations get kicked out
to the system Safari** (you'll see the full website open in Safari with the navbar back).
Fix already in place: `server.allowNavigation: ["theholyrebellion.org",
"*.theholyrebellion.org"]`. Don't remove it.

## 3. Archive fails with "your team has no devices"
`xcodebuild archive` (automatic signing) needs at least one **registered device**.
Connect an iPhone, enable **Developer Mode** (Settings → Privacy & Security — the toggle
only appears *after* the phone has been connected to Xcode), and **Run** the app to it
once. Then archives work. (Details in `DEPLOYMENT-AND-IOS.md`.)

## 4. Web vs native change = different release path
- **Web change** (any UI/feature/copy/bug): `vercel --prod` → reload the app. Instant,
  no App Store review, testers get it automatically.
- **Native change** (icon, splash, plugins, permissions, `server.url`, version): rebuild
  + new TestFlight/App Store build.
Knowing which bucket a change is in saves a lot of confusion.

## 5. Deploys go straight to production (no staging)
`vercel --prod` publishes to `theholyrebellion.org`, which is *also* what the app loads.
There's no preview gate. Consider adding Vercel preview deploys / a staging alias before
shipping risky changes.

## 6. iPhone photos are HEIC / large
The `avatars` bucket only allows `image/*` and 5 MB. iPhone photos are often HEIC (not
browser-renderable, rejected by the bucket) and can exceed 5 MB. `AccountSettings.tsx`
**resizes + re-encodes to JPEG client-side** (`resizeToJpeg`) before upload, and renders
avatars with a plain `<img>` (no `next/image` image-domain whitelist is configured).

## 7. Google OAuth doesn't work in the app
Embedded WebViews block Google OAuth. It's **hidden in the app** (`.capacitor-native`
CSS) — the app uses email/password only. Native Google Sign-In is a future task.

## 8. ffmpeg.wasm merge uses `-c copy`
`lib/merge-clips.ts` concatenates clips losslessly (`-c copy`) — fast, and correct since
all clips come from the same camera. **If** a merged video ever looks glitchy on a
specific device, switch to a re-encode (`-c:v libx264 -c:a aac`) — slower but bulletproof.
The ~32 MB ffmpeg core is self-hosted at `public/ffmpeg/` and only downloads on the first
multi-clip merge.

## 9. Simulator screenshot quirk
`xcrun simctl io <udid> screenshot` fails with *"Device does not have a 'default' display
port"* unless the Simulator **GUI window** for that device is attached/frontmost. Killing
and reopening the Simulator app reopens its *default* device, not necessarily the one you
built for — screenshot whichever device actually has a window.

## 10. Style conventions are mixed
Most components use **inline `style` objects + `<style>@media`** (CSS vars from
`globals.css`), **not** Tailwind. `app/wagepeace/account/*` **is** Tailwind. Match the
file you're in. No component library.

## 11. No git remote
The project deploys from the local tree; there's no origin. Set up a remote early so work
is backed up and reviewable.
