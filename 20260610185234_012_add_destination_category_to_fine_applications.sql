ALTER TABLE fine_applications
  ADD COLUMN destination_category_id uuid REFERENCES categories(id) ON DELETE SET NULL;
