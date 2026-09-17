/*
  # Add period_date to payouts table

  1. Modified Tables
    - `payouts`
      - Added `period_date` (text) column to track which contribution period the payout corresponds to
      - This allows linking a payout to a specific contribution date (e.g., "Cotisation du 31 Mai 2026")

  2. Security
    - No RLS changes needed - existing policies apply
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'period_date'
  ) THEN
    ALTER TABLE payouts ADD COLUMN period_date text DEFAULT '';
  END IF;
END $$;
