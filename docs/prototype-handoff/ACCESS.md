# Accounts, ownership & secrets

## Who owns what
| Service | Account / owner | Identifier |
|---|---|---|
| Domain | Travis | `theholyrebellion.org` |
| Hosting | Vercel — team `travislish-8017s-projects` | project `wagepeace` |
| Database/Auth/Storage | Supabase — org "Travis" | project `wagepeace` / `rmiwnhvabqhhcsixyvao` |
| iOS | Apple Developer Program (Travis) | Team ID `7P44FG5YD5`, bundle `org.theholyrebellion.assignedtolabor` |
| AI | Anthropic (Claude) | `ANTHROPIC_API_KEY` in Vercel |
| AI (pending) | aligned.ai | `ALIGNED_API_KEY` — not set yet |
| Social | Meta / Instagram | `META_*` / `INSTAGRAM_*` in Vercel |

## Where secrets live
- **Production:** Vercel → Project `wagepeace` → Settings → Environment Variables.
- **Local:** `.env.local` (git-ignored). Template: `.env.local.example`.
- Nothing secret is committed. Only variable **names** appear in the repo. See
  `DEPLOYMENT-AND-IOS.md` for the full list.

## Collaborator access — Landon (`landoncope@gmail.com`)
Travis is granting Landon **owner/admin-level** access on **Vercel** and **Supabase**.
These grants can only be done by the account owner in each dashboard (there's no API for
it), so Travis performs them — the exact click-paths are in the handoff message and are
summarized here:

- **Vercel:** Team `travislish-8017s-projects` → **Settings → Members → Invite** →
  `landoncope@gmail.com` → role **Owner** (or Admin).
- **Supabase:** Org **"Travis"** → **Team / Members → Invite** → `landoncope@gmail.com`
  → role **Owner** (or Administrator).
- **(If Landon also needs to build/ship the iOS app):** Apple Developer → App Store
  Connect → **Users and Access** → invite him to the team with **Admin** (and an Xcode
  signing cert on his Mac). Not required for web work.

Once invited, Landon should:
1. Accept both invites.
2. Pull `SUPABASE_*` / `ANTHROPIC_API_KEY` / etc. from Vercel into a local `.env.local`.
3. Run `npm install && npm run dev`.
4. Read `GOTCHAS.md` before touching the iOS build.
