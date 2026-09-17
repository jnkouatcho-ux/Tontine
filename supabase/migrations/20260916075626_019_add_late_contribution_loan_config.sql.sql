/*
# Add late contribution loan config to tontines

## Changes
1. Add `late_contribution_loan_rate` column to `tontines` table
   - Interest rate (percentage) applied when a late contribution is converted to a loan
   - Defaults to 0 (no interest)
2. Add `late_contribution_loan_period` column to `tontines` table
   - Period for the interest rate: 'monthly' or '3months'
   - Defaults to 'monthly'

## Security
- No new tables, no policy changes
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tontines' AND column_name = 'late_contribution_loan_rate') THEN
    ALTER TABLE tontines ADD COLUMN late_contribution_loan_rate numeric DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tontines' AND column_name = 'late_contribution_loan_period') THEN
    ALTER TABLE tontines ADD COLUMN late_contribution_loan_period text DEFAULT 'monthly';
  END IF;
END $$;
