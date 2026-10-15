-- AI-suggested captions (2026-10-15, Travis's yes). A cron sends each new video's file
-- to a speech-to-text provider (ElevenLabs Scribe) and the transcript to Claude, which
-- drafts a caption in the video's language and a one-line English summary. The lead
-- sees the draft in the caption box and can edit it; nothing posts without the tap.
-- caption_state: null = not done yet (the cron picks these up), 'done', 'failed'
-- (gave up after a few attempts; the script is the caption), 'skipped' (no file).
alter table public.videos
  add column if not exists transcript text,
  add column if not exists transcript_language text,
  add column if not exists transcript_confidence real,
  add column if not exists ai_caption text,
  add column if not exists ai_summary text,
  add column if not exists caption_state text check (caption_state in ('done', 'failed', 'skipped')),
  add column if not exists caption_attempts integer not null default 0,
  add column if not exists caption_error text,
  add column if not exists captioned_at timestamptz;

create index if not exists videos_captioning on public.videos (created_at desc) where caption_state is null;
