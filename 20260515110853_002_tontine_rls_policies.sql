/*
  # Tontine Management Application - RLS Policies

  Enables RLS on all tables and creates appropriate policies.
  - Profiles: users can read/update own profile
  - Tontines: members can read, creators can insert, admins can update
  - Tontine_members: members can read, admins can insert/update
  - All other tables: members of the tontine can read, admins can write
  - Invitations: users can read their own, admins can create, invitees can update
*/

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tontine_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE eating_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE interest_distributions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Tontines policies
CREATE POLICY "Tontine members can read tontines"
  ON tontines FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontines.id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can create tontines"
  ON tontines FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Tontine admins can update tontines"
  ON tontines FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontines.id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontines.id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Tontine members policies
CREATE POLICY "Tontine members can read membership"
  ON tontine_members FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members tm WHERE tm.tontine_id = tontine_members.tontine_id AND tm.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can add members"
  ON tontine_members FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontine_members.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

CREATE POLICY "Tontine admins can update member roles"
  ON tontine_members FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontine_members.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontine_members.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Tontine invitations policies
CREATE POLICY "Users can read their own invitations"
  ON tontine_invitations FOR SELECT TO authenticated
  USING (
    invitee_user_id = auth.uid()
    OR inviter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontine_invitations.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

CREATE POLICY "Tontine admins can create invitations"
  ON tontine_invitations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = tontine_invitations.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

CREATE POLICY "Invitees can update their invitations"
  ON tontine_invitations FOR UPDATE TO authenticated
  USING (invitee_user_id = auth.uid())
  WITH CHECK (invitee_user_id = auth.uid());

-- Categories policies
CREATE POLICY "Tontine members can read categories"
  ON categories FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = categories.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert categories"
  ON categories FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = categories.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

CREATE POLICY "Tontine admins can update categories"
  ON categories FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = categories.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = categories.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Eating schedule policies
CREATE POLICY "Tontine members can read eating schedule"
  ON eating_schedule FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = eating_schedule.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert eating schedule"
  ON eating_schedule FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = eating_schedule.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

CREATE POLICY "Tontine admins can update eating schedule"
  ON eating_schedule FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = eating_schedule.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = eating_schedule.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Contributions policies
CREATE POLICY "Tontine members can read contributions"
  ON contributions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = contributions.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert contributions"
  ON contributions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = contributions.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Payouts policies
CREATE POLICY "Tontine members can read payouts"
  ON payouts FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = payouts.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert payouts"
  ON payouts FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = payouts.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Loans policies
CREATE POLICY "Tontine members can read loans"
  ON loans FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = loans.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert loans"
  ON loans FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = loans.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

CREATE POLICY "Tontine admins can update loans"
  ON loans FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = loans.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = loans.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Loan repayments policies
CREATE POLICY "Tontine members can read loan repayments"
  ON loan_repayments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM loans l JOIN tontine_members tm ON tm.tontine_id = l.tontine_id WHERE l.id = loan_repayments.loan_id AND tm.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert loan repayments"
  ON loan_repayments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM loans l JOIN tontine_members tm ON tm.tontine_id = l.tontine_id WHERE l.id = loan_repayments.loan_id AND tm.user_id = auth.uid() AND tm.role = 'admin')
  );

-- Loan sources policies
CREATE POLICY "Tontine members can read loan sources"
  ON loan_sources FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM loans l JOIN tontine_members tm ON tm.tontine_id = l.tontine_id WHERE l.id = loan_sources.loan_id AND tm.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert loan sources"
  ON loan_sources FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM loans l JOIN tontine_members tm ON tm.tontine_id = l.tontine_id WHERE l.id = loan_sources.loan_id AND tm.user_id = auth.uid() AND tm.role = 'admin')
  );

-- Cash withdrawals policies
CREATE POLICY "Tontine members can read cash withdrawals"
  ON cash_withdrawals FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = cash_withdrawals.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert cash withdrawals"
  ON cash_withdrawals FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = cash_withdrawals.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );

-- Interest distributions policies
CREATE POLICY "Tontine members can read interest distributions"
  ON interest_distributions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = interest_distributions.tontine_id AND tontine_members.user_id = auth.uid())
  );

CREATE POLICY "Tontine admins can insert interest distributions"
  ON interest_distributions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_members.tontine_id = interest_distributions.tontine_id AND tontine_members.user_id = auth.uid() AND tontine_members.role = 'admin')
  );
