-- ─────────────────────────────────────────────────────────────────
-- Migration: team join application
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
--
-- Stores the applicant's responses (3 affirmations + open question) on their
-- pending channel_members row, for the manager to review.
-- Shape: { speaksLanguage, isMember, understandsGuidelines, reason }
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.channel_members ADD COLUMN IF NOT EXISTS application jsonb;

-- Managers/leaders/admins can read the onboarding profiles of members/applicants
-- of channels they manage (to review applications with the onboarding summary).
DROP POLICY IF EXISTS "managers read member profiles" ON public.user_profiles;
CREATE POLICY "managers read member profiles"
  ON public.user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.channel_members m
      WHERE m.user_id = user_profiles.id
        AND public.can_manage_channel(m.channel_id)
    )
  );
