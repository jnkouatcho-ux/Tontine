/*
# Add eating_order column to tontine_invitations

1. Modified Tables
- `tontine_invitations`
  - Add `eating_order` (integer, nullable) — stores the tour position chosen for
    this invitee at tontine creation time. When the invitee accepts, the edge
    function uses this value instead of max+1 so the original order is respected.

2. Security
- No security changes — the column is readable/writable through existing
  invitation policies.
*/

ALTER TABLE tontine_invitations
ADD COLUMN IF NOT EXISTS eating_order integer;
