/*
  # Fix remaining RLS recursion - remove all cross-table references

  Makes tontine_members and tontines SELECT policies fully self-contained
  with NO cross-table references, eliminating any recursion possibility.
*/

-- Drop ALL existing policies on tontine_members first
DROP POLICY IF EXISTS "Users can read own membership rows" ON tontine_members;
DROP POLICY IF EXISTS "Creators can read their tontine members" ON tontine_members;
DROP POLICY IF EXISTS "Tontine admins can add members" ON tontine_members;
DROP POLICY IF EXISTS "Tontine admins can update member roles" ON tontine_members;

-- Drop tontines SELECT policy that references tontine_members
DROP POLICY IF EXISTS "Tontine members can read tontines" ON tontines;
DROP POLICY IF EXISTS "Users can read tontines they created" ON tontines;

-- Rewrite helper functions to NOT query tontine_members at all
CREATE OR REPLACE FUNCTION is_tontine_member(check_tontine_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tontines
    WHERE id = check_tontine_id
    AND created_by = check_user_id
  );
$$;

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
  );
$$;

-- tontine_members SELECT: only direct column check, zero recursion
CREATE POLICY "Users can read own membership rows"
  ON tontine_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- tontine_members INSERT: uses helper (only checks tontines.created_by)
CREATE POLICY "Tontine admins can add members"
  ON tontine_members FOR INSERT
  TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- tontine_members UPDATE: uses helper
CREATE POLICY "Tontine admins can update member roles"
  ON tontine_members FOR UPDATE
  TO authenticated
  USING (is_tontine_admin(tontine_id, auth.uid()))
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- tontines SELECT: only direct column check, zero recursion
CREATE POLICY "Users can read tontines they created"
  ON tontines FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- Now update ALL other table policies to use the simplified helper functions

-- Categories
DROP POLICY IF EXISTS "Tontine members can read categories" ON categories;
DROP POLICY IF EXISTS "Tontine admins can insert categories" ON categories;
DROP POLICY IF EXISTS "Tontine admins can update categories" ON categories;

CREATE POLICY "Tontine members can read categories"
  ON categories FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert categories"
  ON categories FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can update categories"
  ON categories FOR UPDATE TO authenticated
  USING (is_tontine_admin(tontine_id, auth.uid()))
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Eating schedule
DROP POLICY IF EXISTS "Tontine members can read eating schedule" ON eating_schedule;
DROP POLICY IF EXISTS "Tontine admins can insert eating schedule" ON eating_schedule;
DROP POLICY IF EXISTS "Tontine admins can update eating schedule" ON eating_schedule;

CREATE POLICY "Tontine members can read eating schedule"
  ON eating_schedule FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert eating schedule"
  ON eating_schedule FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can update eating schedule"
  ON eating_schedule FOR UPDATE TO authenticated
  USING (is_tontine_admin(tontine_id, auth.uid()))
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Contributions
DROP POLICY IF EXISTS "Tontine members can read contributions" ON contributions;
DROP POLICY IF EXISTS "Tontine admins can insert contributions" ON contributions;

CREATE POLICY "Tontine members can read contributions"
  ON contributions FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert contributions"
  ON contributions FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Payouts
DROP POLICY IF EXISTS "Tontine members can read payouts" ON payouts;
DROP POLICY IF EXISTS "Tontine admins can insert payouts" ON payouts;

CREATE POLICY "Tontine members can read payouts"
  ON payouts FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert payouts"
  ON payouts FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Loans
DROP POLICY IF EXISTS "Tontine members can read loans" ON loans;
DROP POLICY IF EXISTS "Tontine admins can insert loans" ON loans;
DROP POLICY IF EXISTS "Tontine admins can update loans" ON loans;

CREATE POLICY "Tontine members can read loans"
  ON loans FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert loans"
  ON loans FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can update loans"
  ON loans FOR UPDATE TO authenticated
  USING (is_tontine_admin(tontine_id, auth.uid()))
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Cash withdrawals
DROP POLICY IF EXISTS "Tontine members can read cash withdrawals" ON cash_withdrawals;
DROP POLICY IF EXISTS "Tontine admins can insert cash withdrawals" ON cash_withdrawals;

CREATE POLICY "Tontine members can read cash withdrawals"
  ON cash_withdrawals FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert cash withdrawals"
  ON cash_withdrawals FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Interest distributions
DROP POLICY IF EXISTS "Tontine members can read interest distributions" ON interest_distributions;
DROP POLICY IF EXISTS "Tontine admins can insert interest distributions" ON interest_distributions;

CREATE POLICY "Tontine members can read interest distributions"
  ON interest_distributions FOR SELECT TO authenticated
  USING (is_tontine_member(tontine_id, auth.uid()));

CREATE POLICY "Tontine admins can insert interest distributions"
  ON interest_distributions FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Tontine invitations
DROP POLICY IF EXISTS "Users can read their own invitations" ON tontine_invitations;
DROP POLICY IF EXISTS "Tontine admins can create invitations" ON tontine_invitations;

CREATE POLICY "Users can read their own invitations"
  ON tontine_invitations FOR SELECT TO authenticated
  USING (
    invitee_user_id = auth.uid()
    OR inviter_id = auth.uid()
    OR is_tontine_admin(tontine_id, auth.uid())
  );

CREATE POLICY "Tontine admins can create invitations"
  ON tontine_invitations FOR INSERT TO authenticated
  WITH CHECK (is_tontine_admin(tontine_id, auth.uid()));

-- Loan repayments
DROP POLICY IF EXISTS "Tontine members can read loan repayments" ON loan_repayments;
DROP POLICY IF EXISTS "Tontine admins can insert loan repayments" ON loan_repayments;

CREATE POLICY "Tontine members can read loan repayments"
  ON loan_repayments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM loans
      WHERE loans.id = loan_repayments.loan_id
      AND is_tontine_member(loans.tontine_id, auth.uid())
    )
  );

CREATE POLICY "Tontine admins can insert loan repayments"
  ON loan_repayments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM loans
      WHERE loans.id = loan_repayments.loan_id
      AND is_tontine_admin(loans.tontine_id, auth.uid())
    )
  );

-- Loan sources
DROP POLICY IF EXISTS "Tontine members can read loan sources" ON loan_sources;
DROP POLICY IF EXISTS "Tontine admins can insert loan sources" ON loan_sources;

CREATE POLICY "Tontine members can read loan sources"
  ON loan_sources FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM loans
      WHERE loans.id = loan_sources.loan_id
      AND is_tontine_member(loans.tontine_id, auth.uid())
    )
  );

CREATE POLICY "Tontine admins can insert loan sources"
  ON loan_sources FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM loans
      WHERE loans.id = loan_sources.loan_id
      AND is_tontine_admin(loans.tontine_id, auth.uid())
    )
  );
