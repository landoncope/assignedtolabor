# Assigned To Labor

Share a short video of your faith. A local team reviews it and shares it on the team's
Instagram. Production: https://assignedtolabor.org

Next.js 16 · Supabase (Postgres, Auth, Storage) · Vercel. See `CLAUDE.md` for the full
project brief, decisions, and codebase map.

## Local development

```bash
cp .env.example .env.local     # fill in the Supabase values
npm install                    # also copies the ffmpeg.wasm runtime to public/ffmpeg
npm run dev                    # http://localhost:3000
```

Schema changes are migrations in `supabase/migrations/`:

```bash
npx supabase link --project-ref <ref>   # once
npm run db:push
npm run db:types                        # regenerate src/lib/supabase/database.types.ts
```

Checks before a PR: `npm run typecheck && npm run lint && npm run build`.
