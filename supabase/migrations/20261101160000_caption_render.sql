-- Captions drawn into the posted video (2026-11-01, Travis's request, Landon's go):
-- the words ElevenLabs Scribe times for us, the cues the lead can read and correct, an
-- optional headline, and the rendered file (captions, headline and normalised loudness)
-- that is posted instead of the original. See src/lib/caption-cues.ts and src/lib/render.ts.
alter table public.videos
  add column transcript_words  jsonb,                          -- Scribe's words with times: [{t, s, e}]
  add column caption_cues      jsonb,                          -- what is drawn: [{s, e, text}], grouped from the words, editable by the lead
  add column captions_on       boolean not null default true,  -- the lead may switch captions off per video
  add column headline          text,                           -- drawn at the top for the whole video; null = none
  add column ai_headline       text,                           -- Claude's suggestion, prefilled into the headline box
  add column render_state      text check (render_state in ('queued', 'rendering', 'done', 'failed', 'skipped')),
  add column render_path       text,                           -- the rendered file in the videos bucket, next to the original
  add column render_key        text,                           -- what the rendered file was made from; a different key means render again
  add column render_error      text,
  add column render_attempts   integer not null default 0,
  add column render_started_at timestamptz,
  add column render_meta       jsonb;                          -- cues drawn, size, encode time, loudness measured

-- guard_video_update (from 20260917150000) also pins the caption and render columns for
-- an uploader editing their own pending video: the captions are the lead's, and the
-- rendered path is what gets posted.
create or replace function public.guard_video_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or current_setting('app.claiming', true) = 'on' then
    return new;
  end if;
  if public.can_manage_area(old.area_id) or public.is_admin() then
    return new;
  end if;
  if old.user_id = auth.uid() and old.status = 'pending' then
    new.status := old.status;
    new.area_id := coalesce(new.area_id, old.area_id);
    new.user_id := old.user_id;
    new.storage_path := old.storage_path;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.posted_by := old.posted_by; new.posted_at := old.posted_at; new.post_url := old.post_url;
    new.file_purged_at := old.file_purged_at;
    new.captions_on := old.captions_on; new.headline := old.headline; new.caption_cues := old.caption_cues;
    new.render_state := old.render_state; new.render_path := old.render_path; new.render_key := old.render_key;
    new.render_error := old.render_error; new.render_attempts := old.render_attempts;
    new.render_started_at := old.render_started_at; new.render_meta := old.render_meta;
    return new;
  end if;
  raise exception 'not allowed';
end;
$$;
