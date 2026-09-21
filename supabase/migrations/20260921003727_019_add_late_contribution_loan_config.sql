ALTER TABLE tontines ADD COLUMN IF NOT EXISTS late_contribution_loan_rate numeric DEFAULT 0;
ALTER TABLE tontines ADD COLUMN IF NOT EXISTS late_contribution_loan_period text DEFAULT 'monthly';