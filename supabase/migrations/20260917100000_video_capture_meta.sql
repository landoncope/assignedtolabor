-- What the recorder saw (device, camera frame size, achieved fps, zoom mode, stalls,
-- track mute events). Written once with the upload, shown to reviewers. Uploaded
-- files have none. Added after a tester's frozen video could only be diagnosed by
-- pulling the file apart (2026-09-17).
alter table public.videos add column capture_meta jsonb;
