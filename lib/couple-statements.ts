// A relationship ends for both people. Check the actor's current membership in
// the mutation, so an old request cannot change sharing in a newer couple.
export const CLEAR_COUPLE_SHARING_SQL = `UPDATE transactions
SET shared = 0, shared_couple_id = NULL
WHERE shared_couple_id = ? AND EXISTS (
  SELECT 1 FROM couple_members actor WHERE actor.user_id = ?
    AND actor.couple_id = transactions.shared_couple_id
)`;

export const DELETE_COUPLE_SQL = `DELETE FROM couples WHERE id = ? AND EXISTS (
  SELECT 1 FROM couple_members actor WHERE actor.user_id = ?
    AND actor.couple_id = couples.id
)`;
