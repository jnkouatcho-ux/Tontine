ALTER TABLE fine_applications
  ADD COLUMN payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN source_category_id uuid REFERENCES categories(id) ON DELETE SET NULL;

-- payment_method: 'cash' or 'account'
-- source_category_id: which category account to debit when payment_method='account'
