-- ─────────────────────────────────────────────────────────────────
-- Migration: Journey / Onboarding tables
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
-- ─────────────────────────────────────────────────────────────────

-- 1. user_profiles  (row existence = onboarding complete)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name        text,
  display_name      text,
  callings          text[]  NOT NULL DEFAULT '{}',
  aspirations       text[]  NOT NULL DEFAULT '{}',
  languages         text[]  NOT NULL DEFAULT '{}',
  cadence           text,
  suggested_team    text,
  onboarded_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own profile"
  ON public.user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users insert own profile"
  ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users update own profile"
  ON public.user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "admins full access on profiles"
  ON public.user_profiles FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- 2. user_journey  (XP / level / streak)
CREATE TABLE IF NOT EXISTS public.user_journey (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  level         int  NOT NULL DEFAULT 1,
  xp            int  NOT NULL DEFAULT 0,
  xp_for_level  int  NOT NULL DEFAULT 1000,
  streak_weeks  int  NOT NULL DEFAULT 0,
  best_streak   int  NOT NULL DEFAULT 0,
  last_active   date
);
ALTER TABLE public.user_journey ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own journey"
  ON public.user_journey FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own journey"
  ON public.user_journey FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own journey"
  ON public.user_journey FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "admins full access on journey"
  ON public.user_journey FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. user_goals  (weekly claimable goals)
CREATE TABLE IF NOT EXISTS public.user_goals (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label     text NOT NULL,
  icon      text NOT NULL DEFAULT '🎯',
  progress  int  NOT NULL DEFAULT 0,
  target    int  NOT NULL DEFAULT 1,
  xp        int  NOT NULL DEFAULT 100,
  claimed   bool NOT NULL DEFAULT false,
  week_of   date NOT NULL DEFAULT CURRENT_DATE
);
ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own goals"
  ON public.user_goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own goals"
  ON public.user_goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own goals"
  ON public.user_goals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "admins full access on goals"
  ON public.user_goals FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. user_badges
CREATE TABLE IF NOT EXISTS public.user_badges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id   text NOT NULL,
  earned     bool NOT NULL DEFAULT false,
  earned_at  timestamptz,
  progress   int  NOT NULL DEFAULT 0,
  target     int  NOT NULL DEFAULT 1,
  UNIQUE(user_id, badge_id)
);
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own badges"
  ON public.user_badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own badges"
  ON public.user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own badges"
  ON public.user_badges FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "admins full access on badges"
  ON public.user_badges FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- 5. user_follows
CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own follows"
  ON public.user_follows FOR ALL USING (auth.uid() = follower_id);
CREATE POLICY "users see who follows them"
  ON public.user_follows FOR SELECT USING (auth.uid() = following_id);
