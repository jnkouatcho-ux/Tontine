/*
# Add initial_amounts JSON column to tontine_invitations

1. Modified Tables
- `tontine_invitations`
  - Add `initial_amounts` (jsonb, default '{}') — stores a map of { category_id: amount } for each invited member's initial contribution per category.

2. Purpose
  When creating a tontine, the admin can now set a different initial amount for each member.
  For the creator, a contribution is created directly. For invited members, their individual
  amounts are stored in this JSON column and applied as contributions when they accept the invitation.

3. Security
  No security changes — the column is readable/writable through existing invitation policies.
*/

ALTER TABLE tontine_invitations
ADD COLUMN IF NOT EXISTS initial_amounts jsonb DEFAULT '{}'::jsonb;
