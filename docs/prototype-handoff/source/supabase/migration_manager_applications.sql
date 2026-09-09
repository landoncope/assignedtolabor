-- ─────────────────────────────────────────────────────────────────
-- Migration: Manager applications
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
--
-- NOTE: This table already exists in production; this file documents its
-- schema for version control / fresh environments. Safe to run on a new DB.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manager_applications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id),
  kind           text NOT NULL CHECK (kind IN ('existing','new')),
  channel_id     uuid REFERENCES public.channels(id),
  proposed_name  text,
  audience       text,
  content_styles text[],
  languages      text,
  hours_per_week text,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  reviewed_by    uuid REFERENCES public.users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz DEFAULT now()
);
ALTER TABLE public.manager_applications ENABLE ROW LEVEL SECURITY;

-- Applicants manage their own applications
CREATE POLICY "own applications"
  ON public.manager_applications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins manage all applications
CREATE POLICY "admin applications"
  ON public.manager_applications FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
