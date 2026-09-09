-- Add instagram_user_id to channels table so we can link to IG Graph API
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS instagram_user_id text;

-- Cache Instagram stats per channel (upserted daily by cron)
CREATE TABLE IF NOT EXISTS public.channel_stats (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  followers_count   integer,
  reach_30d         integer,
  impressions_30d   integer,
  likes_30d         integer,
  comments_30d      integer,
  profile_views_30d integer,
  synced_at         timestamptz DEFAULT now(),
  UNIQUE(channel_id)
);
ALTER TABLE public.channel_stats ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read stats
CREATE POLICY "read channel stats" ON public.channel_stats
  FOR SELECT USING (auth.role() = 'authenticated');

-- Service role (used by cron API route) can upsert
-- (No explicit policy needed — service role bypasses RLS)
