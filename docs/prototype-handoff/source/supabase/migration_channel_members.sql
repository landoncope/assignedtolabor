-- channel_members: tracks which users have joined/applied to manage channels
CREATE TABLE IF NOT EXISTS channel_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id  uuid NOT NULL REFERENCES channels(id)   ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'volunteer' CHECK (role IN ('volunteer', 'manager')),
  status      text NOT NULL DEFAULT 'pending'   CHECK (status IN ('pending', 'active')),
  joined_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, channel_id)
);

ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'channel_members' AND policyname = 'users own memberships'
  ) THEN
    CREATE POLICY "users own memberships" ON channel_members
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
