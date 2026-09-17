/*
  # Tontine Management Application - Core Schema (Tables Only)

  Creates all tables for the tontine management system.
  Policies will be added in a separate migration.
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text DEFAULT '',
  last_name text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  username text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Tontines table
CREATE TABLE IF NOT EXISTS tontines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  periodicity_type text NOT NULL CHECK (periodicity_type IN ('monthly', 'weekly', 'biweekly')),
  periodicity_detail jsonb NOT NULL DEFAULT '{}',
  contribution_amount numeric NOT NULL DEFAULT 0,
  eating_amount numeric NOT NULL DEFAULT 0,
  previous_tontine_id uuid REFERENCES tontines(id),
  transferred_cash numeric DEFAULT 0,
  created_by uuid NOT NULL REFERENCES profiles(id),
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

-- Tontine members table
CREATE TABLE IF NOT EXISTS tontine_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  eating_order integer NOT NULL DEFAULT 0,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(tontine_id, user_id)
);

-- Tontine invitations table
CREATE TABLE IF NOT EXISTS tontine_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES profiles(id),
  invitee_username text NOT NULL,
  invitee_user_id uuid REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount_type text NOT NULL DEFAULT 'fixed' CHECK (amount_type IN ('fixed', 'minimum')),
  amount numeric NOT NULL DEFAULT 0,
  is_contribution boolean NOT NULL DEFAULT false,
  is_in_cash_box boolean NOT NULL DEFAULT true,
  can_withdraw_anytime boolean NOT NULL DEFAULT false,
  withdraw_at_end_only boolean NOT NULL DEFAULT false,
  loan_order integer,
  interest_destination_category_id uuid REFERENCES categories(id),
  created_at timestamptz DEFAULT now()
);

-- Eating schedule table
CREATE TABLE IF NOT EXISTS eating_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES tontine_members(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  order_number integer NOT NULL,
  scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at timestamptz
);

-- Contributions table
CREATE TABLE IF NOT EXISTS contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES tontine_members(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  period_date date NOT NULL,
  paid_at timestamptz DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES profiles(id)
);

-- Payouts table
CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  eating_schedule_id uuid NOT NULL REFERENCES eating_schedule(id),
  recipient_member_id uuid NOT NULL REFERENCES tontine_members(id),
  total_amount numeric NOT NULL DEFAULT 0,
  paid_at timestamptz DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES profiles(id)
);

-- Loans table
CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES tontine_members(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  interest_rate numeric NOT NULL DEFAULT 0,
  interest_rate_period text NOT NULL DEFAULT 'monthly' CHECK (interest_rate_period IN ('monthly', '3months')),
  duration_months integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'active', 'repaid', 'defaulted')),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  due_date date
);

-- Loan repayments table
CREATE TABLE IF NOT EXISTS loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  interest_amount numeric NOT NULL DEFAULT 0,
  paid_at timestamptz DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES profiles(id)
);

-- Loan sources table
CREATE TABLE IF NOT EXISTS loan_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0
);

-- Cash withdrawals table
CREATE TABLE IF NOT EXISTS cash_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  member_id uuid REFERENCES tontine_members(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  reason text DEFAULT '',
  withdrawn_at timestamptz DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES profiles(id)
);

-- Interest distributions table
CREATE TABLE IF NOT EXISTS interest_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  total_interest numeric NOT NULL DEFAULT 0,
  per_member_amount numeric NOT NULL DEFAULT 0,
  distributed_at timestamptz DEFAULT now(),
  category_id uuid NOT NULL REFERENCES categories(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tontine_members_tontine ON tontine_members(tontine_id);
CREATE INDEX IF NOT EXISTS idx_tontine_members_user ON tontine_members(user_id);
CREATE INDEX IF NOT EXISTS idx_contributions_tontine ON contributions(tontine_id);
CREATE INDEX IF NOT EXISTS idx_contributions_member ON contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_category ON contributions(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_tontine ON categories(tontine_id);
CREATE INDEX IF NOT EXISTS idx_eating_schedule_tontine ON eating_schedule(tontine_id);
CREATE INDEX IF NOT EXISTS idx_loans_tontine ON loans(tontine_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invitee ON tontine_invitations(invitee_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON tontine_invitations(status);
