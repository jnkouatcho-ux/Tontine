
CREATE TABLE fine_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  deduction_type text NOT NULL DEFAULT 'cash',
  source_category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  destination_category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE fine_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_fine_types" ON fine_types FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_types.tontine_id AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM tontines WHERE id = fine_types.tontine_id AND created_by = auth.uid())
  );

CREATE POLICY "insert_fine_types" ON fine_types FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_types.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
    OR EXISTS (SELECT 1 FROM tontines WHERE id = fine_types.tontine_id AND created_by = auth.uid())
  );

CREATE POLICY "update_fine_types" ON fine_types FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_types.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_types.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  );

CREATE POLICY "delete_fine_types" ON fine_types FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_types.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  );

CREATE TABLE fine_applications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tontine_id uuid NOT NULL REFERENCES tontines(id) ON DELETE CASCADE,
  fine_type_id uuid NOT NULL REFERENCES fine_types(id),
  member_id uuid NOT NULL REFERENCES tontine_members(id),
  amount numeric NOT NULL,
  reason text,
  recorded_by uuid NOT NULL REFERENCES profiles(id),
  applied_at timestamptz DEFAULT now(),
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
);

ALTER TABLE fine_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_fine_applications" ON fine_applications FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_applications.tontine_id AND user_id = auth.uid())
  );

CREATE POLICY "insert_fine_applications" ON fine_applications FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_applications.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  );

CREATE POLICY "update_fine_applications" ON fine_applications FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_applications.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_applications.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  );

CREATE POLICY "delete_fine_applications" ON fine_applications FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM tontine_members WHERE tontine_id = fine_applications.tontine_id AND user_id = auth.uid() AND role IN ('admin', 'secondary_admin'))
  );
