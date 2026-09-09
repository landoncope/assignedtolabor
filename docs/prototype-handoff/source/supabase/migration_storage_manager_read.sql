-- ─────────────────────────────────────────────────────────────────
-- Migration: managers can read team video files (for signed-URL playback)
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
--
-- Owners (storage_own_select) and admins (storage_admin_select) already have
-- read access. This adds managers/leaders of a channel the video is linked to,
-- so playback signed URLs can be generated with the caller's own session —
-- no service-role key required.
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "managers read team video files" ON storage.objects;
CREATE POLICY "managers read team video files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'videos'
  AND EXISTS (
    SELECT 1
    FROM public.videos v
    JOIN public.video_channels vc ON vc.video_id = v.id
    WHERE v.storage_path = storage.objects.name
      AND public.can_manage_channel(vc.channel_id)
  )
);
