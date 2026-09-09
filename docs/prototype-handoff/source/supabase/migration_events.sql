-- ─────────────────────────────────────────────────────────────────
-- Migration: Events (public events listing)
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
-- ─────────────────────────────────────────────────────────────────

-- events  (public-facing event listings; upcoming vs past derived from starts_at)
CREATE TABLE IF NOT EXISTS public.events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL DEFAULT 'gathering'
                  CHECK (type IN ('fireside','conference','workshop','gathering')),
  title         text NOT NULL,
  starts_at     timestamptz NOT NULL,          -- drives ordering + upcoming/past split
  time_label    text,                          -- freeform, e.g. "7:00 PM CT" (tz varies by city)
  location      text,
  description   text,                           -- shown for upcoming events
  recap         text,                           -- shown for past events
  zeffy_url     text,                           -- registration link; NULL => "coming soon"
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Public read access for published events (page is viewable while logged out)
CREATE POLICY "anyone reads published events"
  ON public.events FOR SELECT USING (is_published = true);

-- Admins manage everything
CREATE POLICY "admins full access on events"
  ON public.events FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );
