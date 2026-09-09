-- ─────────────────────────────────────────────────────────────────
-- Migration: video thumbnail (poster frame)
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
--
-- Stores a small JPEG poster (data URL) captured in the browser at upload time.
-- Null = UI falls back to the gradient placeholder.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS thumbnail text;
