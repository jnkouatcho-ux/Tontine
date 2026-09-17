/*
# Add per-member initial amounts table

1. New Tables
- `category_initial_amounts`
  - `id` (uuid, primary key)
  - `category_id` (uuid, FK to categories, ON DELETE CASCADE)
  - `member_id` (uuid, FK to tontine_members, ON DELETE CASCADE)
  - `amount` (integer, not null, default 0) — individual initial amount for this member in this category
  - `created_at` (timestamptz, default now())
  - Unique constraint on (category_id, member_id) to prevent duplicates

2. Purpose
  Instead of dividing a total initial amount equally among all members,
  the admin can now set a specific initial amount for each member individually.
  The total is the sum of all per-member amounts.

3. Security
  - Enable RLS on the new table.
  - Only authenticated users who are members of the tontine can read.
  - Only the tontine admin can insert/update/delete.
*/

CREATE TABLE IF NOT EXISTS category_initial_amounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES tontine_members(id) ON DELETE CASCADE,
  amount integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (category_id, member_id)
);

ALTER TABLE category_initial_amounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_category_initial_amounts" ON category_initial_amounts;
CREATE POLICY "select_category_initial_amounts"
ON category_initial_amounts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tontine_members tm
    JOIN categories c ON c.id = category_initial_amounts.category_id
    WHERE tm.tontine_id = c.tontine_id
    AND tm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "insert_category_initial_amounts" ON category_initial_amounts;
CREATE POLICY "insert_category_initial_amounts"
ON category_initial_amounts FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM categories c
    JOIN tontines t ON t.id = c.tontine_id
    JOIN tontine_members tm ON tm.tontine_id = t.id
    WHERE c.id = category_initial_amounts.category_id
    AND tm.user_id = auth.uid()
    AND tm.role = 'admin'
  )
);

DROP POLICY IF EXISTS "update_category_initial_amounts" ON category_initial_amounts;
CREATE POLICY "update_category_initial_amounts"
ON category_initial_amounts FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM categories c
    JOIN tontines t ON t.id = c.tontine_id
    JOIN tontine_members tm ON tm.tontine_id = t.id
    WHERE c.id = category_initial_amounts.category_id
    AND tm.user_id = auth.uid()
    AND tm.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM categories c
    JOIN tontines t ON t.id = c.tontine_id
    JOIN tontine_members tm ON tm.tontine_id = t.id
    WHERE c.id = category_initial_amounts.category_id
    AND tm.user_id = auth.uid()
    AND tm.role = 'admin'
  )
);

DROP POLICY IF EXISTS "delete_category_initial_amounts" ON category_initial_amounts;
CREATE POLICY "delete_category_initial_amounts"
ON category_initial_amounts FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM categories c
    JOIN tontines t ON t.id = c.tontine_id
    JOIN tontine_members tm ON tm.tontine_id = t.id
    WHERE c.id = category_initial_amounts.category_id
    AND tm.user_id = auth.uid()
    AND tm.role = 'admin'
  )
);
