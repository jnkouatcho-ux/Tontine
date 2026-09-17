-- Drop the recursive SELECT policy that queries tontine_members from within its own RLS
DROP POLICY IF EXISTS "Tontine members can read membership" ON tontine_members;

-- The non-recursive "Users can read own membership rows" policy (user_id = auth.uid())
-- already covers the legitimate use case. For seeing other members of a tontine,
-- the edge function uses the service role key which bypasses RLS entirely.