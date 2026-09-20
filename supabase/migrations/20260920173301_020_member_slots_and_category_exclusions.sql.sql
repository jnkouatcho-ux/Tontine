/*
# Member slots (multi-name per user) and category exclusions

## Purpose
Allows a single user to appear multiple times in a tontine under different "slots"
(e.g. Fandio, Fandio_2, Fandio_3). Each slot gets its own tour (eating_order).
Secondary slots (slot_number >= 2) must always contribute to the mandatory
"cotisation" category, but the admin can exclude them from other categories.

## Changes

### 1. tontine_members table
- Remove the UNIQUE(tontine_id, user_id) constraint so the same user can join
  a tontine multiple times.
- Add `slot_number` (integer, NOT NULL, default 1) — 1 for the primary slot,
  2+ for secondary slots (Fandio_2, Fandio_3, etc.).
- Add `display_name_override` (text, nullable) — stores the auto-generated
  display name for secondary slots (e.g. "Fandio_2"). NULL for primary slots.

### 2. member_category_exclusions table (new)
- Tracks which categories a secondary slot is excluded from contributing to.
- Columns: id, member_id (FK to tontine_members), category_id (FK to categories),
  created_at.
- UNIQUE(member_id, category_id) to prevent duplicates.
- RLS: tontine members can read; only admins can insert/update/delete.

### 3. tontine_invitations table
- Add `slot_number` column (integer, default 1) to carry slot info through
  the invitation flow.
- Add `excluded_category_ids` (jsonb, default '[]') to carry which categories
  a secondary slot is excluded from.

### Security
- RLS enabled on member_category_exclusions with admin-only write policies.
- All existing policies on tontine_members remain unchanged.
*/

-- 1. Remove UNIQUE constraint on tontine_members (tontine_id, user_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tontine_members_tontine_id_user_id_key'
    AND conrelid = 'tontine_members'::regclass
  ) THEN
    ALTER TABLE tontine_members DROP CONSTRAINT tontine_members_tontine_id_user_id_key;
  END IF;
END $$;

-- 2. Add slot_number and display_name_override to tontine_members
ALTER TABLE tontine_members
  ADD COLUMN IF NOT EXISTS slot_number integer NOT NULL DEFAULT 1;
ALTER TABLE tontine_members
  ADD COLUMN IF NOT EXISTS display_name_override text;

-- 3. Create member_category_exclusions table
CREATE TABLE IF NOT EXISTS member_category_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES tontine_members(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (member_id, category_id)
);

ALTER TABLE member_category_exclusions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_member_cat_exclusions_member ON member_category_exclusions(member_id);
CREATE INDEX IF NOT EXISTS idx_member_cat_exclusions_category ON member_category_exclusions(category_id);

-- RLS policies for member_category_exclusions
-- Members can read exclusions in their tontine
DROP POLICY IF EXISTS "select_member_category_exclusions" ON member_category_exclusions;
CREATE POLICY "select_member_category_exclusions"
ON member_category_exclusions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tontine_members tm
    JOIN categories c ON c.id = member_category_exclusions.category_id
    WHERE tm.tontine_id = c.tontine_id
    AND tm.user_id = auth.uid()
  )
);

-- Only admins can insert exclusions
DROP POLICY IF EXISTS "insert_member_category_exclusions" ON member_category_exclusions;
CREATE POLICY "insert_member_category_exclusions"
ON member_category_exclusions FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tontine_members tm
    JOIN categories c ON c.id = member_category_exclusions.category_id
    WHERE tm.tontine_id = c.tontine_id
    AND tm.user_id = auth.uid()
    AND tm.role = 'admin'
  )
);

-- Only admins can delete exclusions
DROP POLICY IF EXISTS "delete_member_category_exclusions" ON member_category_exclusions;
CREATE POLICY "delete_member_category_exclusions"
ON member_category_exclusions FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tontine_members tm
    JOIN categories c ON c.id = member_category_exclusions.category_id
    WHERE tm.tontine_id = c.tontine_id
    AND tm.user_id = auth.uid()
    AND tm.role = 'admin'
  )
);

-- 4. Add slot_number and excluded_category_ids to tontine_invitations
ALTER TABLE tontine_invitations
  ADD COLUMN IF NOT EXISTS slot_number integer NOT NULL DEFAULT 1;
ALTER TABLE tontine_invitations
  ADD COLUMN IF NOT EXISTS excluded_category_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
