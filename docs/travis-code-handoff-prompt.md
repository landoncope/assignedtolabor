# Prompt for Travis to paste into his AI session

Copy everything between the lines and paste it into the Claude session that built
the wagepeace project.

---

I'm handing this project to my friend Landon, who is going to rebuild
"Assigned to Labor" as its own app. Please package up the source code so I can send
it to him. Do all of this yourself and tell me when it is done and where the file is.

1. Work in the wagepeace project at ~/Documents/wagepeace.
2. Create a zip file on my Desktop named `wagepeace-source.zip` containing the whole
   project EXCEPT these, which must be left out:
   - `node_modules`, `.next`, `out`, `dist`, `.vercel`, `.turbo`
   - `ios/App/build`, `ios/App/Pods`, `ios/App/DerivedData`, `android/build`,
     `android/app/build`, `android/.gradle`
   - `public/ffmpeg` (Landon can download it himself)
   - every file whose name starts with `.env` (these contain secrets and must NOT
     be shared). Do include `.env.local.example` if it exists.
   - `.git` if it exists
3. Before zipping, add a file called `HANDOFF-NOTES.md` at the top of the project with:
   - A full listing of the project's files and folders (like `tree -L 3`, ignoring the
     excluded folders above).
   - The list of environment variable NAMES the app uses (names only, never values).
   - A list of every SQL file in the `supabase/` folder, in the order they were applied.
4. Try to export the live database schema so Landon has the exact tables and policies:
   run `npx supabase db dump --linked --schema public,storage -f supabase/SCHEMA-DUMP.sql`
   from the project folder. If that asks to link the project first, the project ref is
   `rmiwnhvabqhhcsixyvao`. If it fails for any reason (needs a database password I
   don't have handy, CLI not installed, etc.), skip it, say so in HANDOFF-NOTES.md, and
   move on. The SQL files already in `supabase/` are enough as a fallback.
5. Make sure no secrets ended up in the zip: search the zip's contents for
   `SUPABASE_SERVICE_ROLE_KEY=`, `ANTHROPIC_API_KEY=`, `sk-ant-`, and `eyJ` and
   report what you found. If any real values are present, remove those files and re-zip.
6. Tell me the final size of the zip and confirm it is on my Desktop.

Do not deploy anything, do not change any code, and do not delete anything from the
project itself.

---

Then Travis sends `wagepeace-source.zip` to Landon (AirDrop, Google Drive, or email if
it is under 25 MB). Landon does NOT need any passwords, API keys, or the `.env` file.
