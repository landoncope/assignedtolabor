-- ─────────────────────────────────────────────────────────────────
-- Migration: Team chat (messages + reactions)
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
--
-- DEPENDS ON: is_team_member() — defined in migration_team_uploads.sql.
-- Run migration_team_uploads.sql first.
--
-- NOTE: These tables already exist in production; this file documents their
-- schema for version control / fresh environments. Safe to run on a new DB.
-- ─────────────────────────────────────────────────────────────────

-- 1. team_messages
CREATE TABLE IF NOT EXISTS public.team_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id),
  user_id    uuid NOT NULL REFERENCES public.users(id),
  body       text NOT NULL,
  is_prayer  boolean NOT NULL DEFAULT false,
  reply_to   uuid REFERENCES public.team_messages(id),
  meta       jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team reads messages"
  ON public.team_messages FOR SELECT
  USING (is_team_member(channel_id));

CREATE POLICY "team writes messages"
  ON public.team_messages FOR INSERT
  WITH CHECK (is_team_member(channel_id) AND user_id = auth.uid());

-- 2. team_message_reactions
CREATE TABLE IF NOT EXISTS public.team_message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.team_messages(id),
  user_id    uuid NOT NULL REFERENCES public.users(id),
  emoji      text NOT NULL
);
ALTER TABLE public.team_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team reads reactions"
  ON public.team_message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.team_messages t
    WHERE t.id = team_message_reactions.message_id AND is_team_member(t.channel_id)
  ));

CREATE POLICY "team writes reactions"
  ON public.team_message_reactions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
