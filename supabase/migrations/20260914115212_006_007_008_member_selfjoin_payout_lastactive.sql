-- 006: Allow users to add themselves as members when accepting invitations
CREATE POLICY "Users can join via accepted invitation"
  ON tontine_members FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tontine_invitations
      WHERE tontine_invitations.tontine_id = tontine_members.tontine_id
      AND tontine_invitations.invitee_user_id = auth.uid()
      AND tontine_invitations.status = 'accepted'
    )
  );

CREATE POLICY "Users can create own eating schedule on join"
  ON eating_schedule FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tontine_members
      WHERE tontine_members.tontine_id = eating_schedule.tontine_id
      AND tontine_members.user_id = auth.uid()
    )
  );

-- 007: Add period_date to payouts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'period_date'
  ) THEN
    ALTER TABLE payouts ADD COLUMN period_date text DEFAULT '';
  END IF;
END $$;

-- 008: Add last_active_at to tontine_members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tontine_members' AND column_name = 'last_active_at'
  ) THEN
    ALTER TABLE tontine_members ADD COLUMN last_active_at timestamptz DEFAULT now();
  END IF;
END $$;

UPDATE tontine_members SET last_active_at = now() WHERE role = 'admin' AND last_active_at IS NULL;