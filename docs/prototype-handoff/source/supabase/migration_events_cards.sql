-- ─────────────────────────────────────────────────────────────────
-- Migration: Events card fields (image-forward Eventbrite-style cards)
-- Run via the Supabase Management API / SQL Editor.
-- ─────────────────────────────────────────────────────────────────

-- Real card image (null ⇒ branded gradient placeholder is rendered)
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS image_url text;

-- Sheet "Event Type" — time-of-day category, e.g. 'Saturday Morning' | 'Evening'
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS category text;

-- Display price; null ⇒ shown as 'Free'
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cost text;
