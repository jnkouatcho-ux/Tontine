/*
# Add initial_amount to categories

1. Changes
- Add `initial_amount` numeric column to `categories` table (default 0).
- This allows a category to start with a carried-over balance from a previous tontine.
- No RLS changes needed — existing category policies already cover the new column.
*/

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS initial_amount numeric NOT NULL DEFAULT 0;
