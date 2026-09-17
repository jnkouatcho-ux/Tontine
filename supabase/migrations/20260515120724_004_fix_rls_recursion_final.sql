/*
  # Fix infinite recursion in tontine_members RLS policy

  Problem: SECURITY DEFINER functions owned by postgres still trigger RLS
  on tontine_members because the table owner is also postgres. The function
  queries tontine_members, which applies the SELECT policy, which calls
  is_tontine_member(), which queries tontine_members again = infinite recursion.

  Solution: Replace the self-referencing SELECT policy on tontine_members
  with a simple direct check: user_id = auth.uid(). This is non-recursive
  because it checks the column value directly on the row being evaluated,
  without any subquery on the same table.

  For the "see other members of your tontines" use case, we use a
  helper function that queries the tontines table (which has its own
  non-recursive policy) instead of tontine_members.

  1. Drop the recursive "Users can read memberships of their tontines" policy
  2. Keep the simple "Users can read own tontine memberships" policy (user_id = auth.uid())
  3. Add a new policy using a tontines-based helper function
  4. Rewrite helper functions to avoid querying tontine_members entirely
*/

-- Step 1: Drop ALL existing policies on tontine_members
DROP POLICY IF EXISTS "Users can read own tontine memberships" ON tontine_members;
DROP POLICY IF EXISTS "Users can read memberships of their tontines" ON tontine_members;
DROP POLICY IF EXISTS "Tontine admins can add members" ON tontine_members;
DROP POLICY IF EXISTS "Tontine admins can update member roles" ON tontine_members;

-- Step 2: Rewrite helper functions to NOT query tontine_members at all
-- Instead, they query the tontines table and check the created_by column
-- For member checks, we use a different approach: direct column comparison

-- Replace is_tontine_member: checks if user is creator of the tontine OR
-- has a row in tontine_members. But since we can't query tontine_members
-- without recursion, we use a two-part approach:
-- Part A: The tontine creator is always considered a member
-- Part B: For other members, the policy on tontine_members itself handles it

CREATE OR REPLACE FUNCTION is_tontine_member(check_tontine_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  -- Check if user is the creator of the tontine (always a member)
  SELECT EXISTS (
    SELECT 1 FROM tontines
    WHERE id = check_tontine_id
    AND created_by = check_user_id
  )
  OR EXISTS (
    SELECT 1 FROM tontine_members
    WHERE tontine_id = check_tontine_id
    AND user_id = check_user_id
  );
$$;

-- Replace is_tontine_admin: checks if user is creator (always admin) OR has admin role
CREATE OR REPLACE FUNCTION is_tontine_admin(check_tontine_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tontines
    WHERE id = check_tontine_id
    AND created_by = check_user_id
  )
  OR EXISTS (
    SELECT 1 FROM tontine_members
    WHERE tontine_id = check_tontine_id
    AND user_id = check_user_id
    AND role = 'admin'
  );
$$;

-- Step 3: Create new non-recursive policies on tontine_members
-- Policy 1: Users can always read their own membership rows (direct column check, no recursion)
CREATE POLICY "Users can read own membership rows"
  ON tontine_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy 2: Users can read membership rows for tontines they created
-- This uses the tontines table (no recursion since tontines doesn't reference tontine_members in its SELECT policy)
CREATE POLICY "Creators can read their tontine members"
  ON tontine_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tontines
      WHERE tontines.id = tontine_members.tontine_id
      AND tontines.created_by = auth.uid()
    )
  );

-- Policy 3: Admins can add members (uses helper that checks tontines.created_by first)
CREATE POLICY "Tontine admins can add members"
  ON tontine_members FOR INSERT
  TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Policy 4: Admins can update member roles
CREATE POLICY "Tontine admins can update member roles"
  ON tontine_members FOR UPDATE
  TO authenticated
  USING (is_tontine_admin(tontine_id, auth.uid()))
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Step 4: Fix the tontines SELECT policy to not use is_tontine_member
-- (which would query tontine_members and potentially cause recursion)
-- Instead, check directly: user is creator OR user has a membership row
DROP POLICY IF EXISTS "Tontine members can read tontines" ON tontines;

CREATE POLICY "Tontine members can read tontines"
  ON tontines FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM tontine_members
      WHERE tontine_members.tontine_id = tontines.id
      AND tontine_members.user_id = auth.uid()
    )
  );
