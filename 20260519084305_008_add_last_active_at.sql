/*
  # Add secondary admin support and last_active tracking

  1. Modified Tables
    - `tontine_members`
      - Added `last_active_at` (timestamptz) to track when admin was last active
      - Role now supports 'secondary_admin' in addition to 'admin' and 'member'

  2. Security
    - No RLS changes needed - existing policies apply
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tontine_members' AND column_name = 'last_active_at'
  ) THEN
    ALTER TABLE tontine_members ADD COLUMN last_active_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Update existing admin last_active_at to now
UPDATE tontine_members SET last_active_at = now() WHERE role = 'admin' AND last_active_at IS NULL;
