-- ─────────────────────────────────────────────────────────────────
-- Migration: Video lifecycle (private storage + retention)
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
-- ─────────────────────────────────────────────────────────────────

-- New columns on public.videos:
--   storage_path    — key within the (private) `videos` bucket; signed URLs are
--                     generated on demand for playback (replaces the broken public file_url)
--   rejected_at     — set when status → 'rejected'; drives 7-day retention
--   file_purged_at  — set by the cleanup job once the source file is deleted
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS storage_path   text,
  ADD COLUMN IF NOT EXISTS rejected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS file_purged_at timestamptz;

-- file_url is superseded by storage_path (+ on-demand signed URLs); allow null.
ALTER TABLE public.videos ALTER COLUMN file_url DROP NOT NULL;

-- Keep the `videos` bucket private and re-assert its limits.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 524288000,
    allowed_mime_types = array['video/mp4','video/quicktime','video/x-msvideo','video/webm','video/mpeg','video/ogg']
WHERE id = 'videos';
