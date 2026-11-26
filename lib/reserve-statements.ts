const columns = `id, owner_id AS ownerId, month,
  minimum_balance_cents AS minimumBalanceCents, extra_expense_cents AS extraExpenseCents,
  card_reserve_cents AS cardReserveCents, goal_reserve_cents AS goalReserveCents,
  shared_commitment_cents AS sharedCommitmentCents`;

export const READ_RESERVE_PLANS_SQL = `SELECT ${columns} FROM reserve_plans WHERE owner_id = ? ORDER BY month`;

// The authenticated actor supplies owner_id; clients cannot choose it. Unique
// owner/month makes concurrent or repeated saves update the same personal row.
export const SAVE_RESERVE_PLAN_SQL = `INSERT INTO reserve_plans
  (id, owner_id, month, minimum_balance_cents, extra_expense_cents, card_reserve_cents, goal_reserve_cents, shared_commitment_cents)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(owner_id, month) DO UPDATE SET
  minimum_balance_cents = excluded.minimum_balance_cents,
  extra_expense_cents = excluded.extra_expense_cents,
  card_reserve_cents = excluded.card_reserve_cents,
  goal_reserve_cents = excluded.goal_reserve_cents,
  shared_commitment_cents = excluded.shared_commitment_cents
RETURNING ${columns}`;

export const DELETE_RESERVE_PLAN_SQL = `DELETE FROM reserve_plans WHERE owner_id = ? AND month = ?`;
