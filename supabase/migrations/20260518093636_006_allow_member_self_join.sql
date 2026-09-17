/*
  # Allow users to add themselves as members when accepting invitations

  Problem: The INSERT policy on tontine_members only allows admins to add members.
  When a user accepts an invitation, they need to insert their own membership row,
  but they're not an admin, so the INSERT fails silently.

  Solution: Add a new INSERT policy that allows authenticated users to insert
  their own membership row (user_id = auth.uid()) when there's a valid
  accepted invitation for them.
*/

-- Add policy for users to join a tontine via invitation
CREATE POLICY "Users can join via accepted invitation"
  ON tontine_members FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tontine_invitations
      WHERE tontine_invitations.tontine_id = tontine_members.tontine_id
      AND tontine_invitations.invitee_user_id = auth.uid()
      AND tontine_invitations.status = 'accepted'
    )
  );

-- Also allow users to insert eating schedule entries for themselves
-- when they join (needed for the invitation acceptance flow)
CREATE POLICY "Users can create own eating schedule on join"
  ON eating_schedule FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tontine_members
      WHERE tontine_members.tontine_id = eating_schedule.tontine_id
      AND tontine_members.user_id = auth.uid()
    )
  );
