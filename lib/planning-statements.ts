// Keep authorization in the mutating SQL as well as in API lookups, so a
// concurrent unlink or relationship change cannot authorize a stale request.
const scheduleAccess = `((s.scope = 'personal' AND s.owner_id = (SELECT user_id FROM actor)) OR
  (s.scope = 'couple' AND EXISTS (SELECT 1 FROM couple_members viewer WHERE viewer.user_id = (SELECT user_id FROM actor) AND viewer.couple_id = s.couple_id)))`;

export const SET_OCCURRENCE_SQL = `WITH actor AS (SELECT ? AS user_id)
INSERT INTO schedule_occurrences (id, schedule_id, due_date, state, transaction_id, confirmed_by)
SELECT ?, s.id, ?, ?, ?, (SELECT user_id FROM actor)
FROM recurring_schedules s
WHERE s.id = ? AND ${scheduleAccess}
  AND s.frequency = ? AND s.start_date = ? AND s.end_date IS ?
  AND (? IS NULL OR EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = ? AND t.kind = s.kind AND (
      (s.scope = 'personal' AND t.owner_id = (SELECT user_id FROM actor) AND t.shared = 0) OR
      (s.scope = 'couple' AND t.shared = 1 AND t.shared_couple_id = s.couple_id AND EXISTS (
        SELECT 1 FROM couple_members transaction_owner WHERE transaction_owner.user_id = t.owner_id AND transaction_owner.couple_id = s.couple_id
      ))
    )
  ))
ON CONFLICT(schedule_id, due_date) DO UPDATE SET state = excluded.state, transaction_id = excluded.transaction_id, confirmed_by = excluded.confirmed_by
RETURNING id, schedule_id AS scheduleId, due_date AS dueDate, state, transaction_id AS transactionId, confirmed_by AS confirmedBy`;

export const RESET_OCCURRENCE_SQL = `WITH actor AS (SELECT ? AS user_id)
DELETE FROM schedule_occurrences WHERE schedule_id = ? AND due_date = ? AND EXISTS (
  SELECT 1 FROM recurring_schedules s WHERE s.id = schedule_occurrences.schedule_id AND ${scheduleAccess}
)`;

export const COPY_BUDGETS_SQL = `WITH actor AS (SELECT ? AS user_id)
INSERT INTO budget_limits (id, owner_id, couple_id, scope, scope_key, month, category, category_key, limit_cents)
SELECT lower(hex(randomblob(16))), (SELECT user_id FROM actor), b.couple_id, b.scope, b.scope_key, ?, b.category, b.category_key, b.limit_cents
FROM budget_limits b WHERE b.scope_key = ? AND b.month = ? AND (
  (b.scope = 'personal' AND b.owner_id = (SELECT user_id FROM actor)) OR
  (b.scope = 'couple' AND EXISTS (SELECT 1 FROM couple_members viewer WHERE viewer.user_id = (SELECT user_id FROM actor) AND viewer.couple_id = b.couple_id))
)
ON CONFLICT(scope_key, month, category_key) DO NOTHING`;
