-- Fix search_path and execute permissions on helper functions
REVOKE EXECUTE ON FUNCTION is_tontine_member(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION is_tontine_admin(uuid, uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION is_tontine_member(check_tontine_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
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
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tontines
    WHERE id = check_tontine_id
    AND created_by = check_user_id
  );
$$;