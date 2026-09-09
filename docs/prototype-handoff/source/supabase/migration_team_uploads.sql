-- ── Team uploads + approval workflow ──────────────────────────────
-- NOTE: the live DB never had migration_roles_channels applied, so this
-- migration also adds the columns that earlier code already references.

-- videos: audience metadata written by the upload modal
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS countries text[];
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS belief_system text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS church_relationship text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS video_style text;

-- channels: optional assigned leader
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- video_channels: approval + posting metadata + lifecycle status
ALTER TABLE public.video_channels ADD COLUMN IF NOT EXISTS approved_at  timestamptz;
ALTER TABLE public.video_channels ADD COLUMN IF NOT EXISTS approved_by  uuid REFERENCES public.users(id);
ALTER TABLE public.video_channels ADD COLUMN IF NOT EXISTS posted_by    uuid REFERENCES public.users(id);
ALTER TABLE public.video_channels ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','approved','posted'));

UPDATE public.video_channels
  SET status = CASE WHEN posted_at IS NOT NULL THEN 'posted' ELSE 'approved' END
  WHERE status = 'pending' AND (posted_at IS NOT NULL OR approved_at IS NOT NULL);

-- SECURITY DEFINER helper avoids recursive RLS on channel_members
CREATE OR REPLACE FUNCTION public.can_manage_channel(cid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $func$
  SELECT
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR EXISTS (SELECT 1 FROM public.channels c WHERE c.id = cid AND c.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.channel_members m
               WHERE m.channel_id = cid AND m.user_id = auth.uid()
                 AND m.role = 'manager' AND m.status = 'active');
$func$;

-- ── RLS: uploaders create their own pending links; managers read+write their channel ──
DROP POLICY IF EXISTS "uploader inserts own video link" ON public.video_channels;
CREATE POLICY "uploader inserts own video link" ON public.video_channels
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.videos v WHERE v.id = video_id AND v.user_id = auth.uid()));

DROP POLICY IF EXISTS "managers select channel links" ON public.video_channels;
CREATE POLICY "managers select channel links" ON public.video_channels
  FOR SELECT USING (public.can_manage_channel(channel_id));

DROP POLICY IF EXISTS "managers update channel links" ON public.video_channels;
CREATE POLICY "managers update channel links" ON public.video_channels
  FOR UPDATE USING (public.can_manage_channel(channel_id)) WITH CHECK (public.can_manage_channel(channel_id));

DROP POLICY IF EXISTS "managers delete channel links" ON public.video_channels;
CREATE POLICY "managers delete channel links" ON public.video_channels
  FOR DELETE USING (public.can_manage_channel(channel_id));

-- Managers can read + decide members of channels they manage
DROP POLICY IF EXISTS "managers select channel members" ON public.channel_members;
CREATE POLICY "managers select channel members" ON public.channel_members
  FOR SELECT USING (public.can_manage_channel(channel_id));

DROP POLICY IF EXISTS "managers update channel members" ON public.channel_members;
CREATE POLICY "managers update channel members" ON public.channel_members
  FOR UPDATE USING (public.can_manage_channel(channel_id)) WITH CHECK (public.can_manage_channel(channel_id));

DROP POLICY IF EXISTS "managers delete channel members" ON public.channel_members;
CREATE POLICY "managers delete channel members" ON public.channel_members
  FOR DELETE USING (public.can_manage_channel(channel_id));

-- Managers can read videos linked to a channel they manage (for the review list)
DROP POLICY IF EXISTS "managers select linked videos" ON public.videos;
CREATE POLICY "managers select linked videos" ON public.videos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.video_channels vc WHERE vc.video_id = videos.id AND public.can_manage_channel(vc.channel_id))
  );

-- Managers can update the status of videos linked to a channel they manage
DROP POLICY IF EXISTS "managers update linked videos" ON public.videos;
CREATE POLICY "managers update linked videos" ON public.videos
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.video_channels vc WHERE vc.video_id = videos.id AND public.can_manage_channel(vc.channel_id))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.video_channels vc WHERE vc.video_id = videos.id AND public.can_manage_channel(vc.channel_id))
  );
