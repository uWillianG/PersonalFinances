export const SAVE_CARD_CYCLE_SQL = `INSERT INTO card_cycles (source_id, owner_id, closing_day, due_day)
SELECT s.id, s.owner_id, ?, ? FROM sources s WHERE s.id = ? AND s.owner_id = ? AND s.type = 'credit'
ON CONFLICT(source_id) DO UPDATE SET closing_day = excluded.closing_day, due_day = excluded.due_day
RETURNING source_id AS sourceId, closing_day AS closingDay, due_day AS dueDay`;

export const SAVE_INVOICE_SQL = `INSERT INTO card_invoices (id, owner_id, source_id, month, confirmed_total_cents)
SELECT ?, s.owner_id, s.id, ?, ? FROM sources s WHERE s.id = ? AND s.owner_id = ? AND s.type = 'credit'
ON CONFLICT(owner_id, source_id, month) DO UPDATE SET confirmed_total_cents = excluded.confirmed_total_cents
RETURNING id, source_id AS sourceId, month, confirmed_total_cents AS confirmedTotalCents`;

export const ENSURE_INVOICE_SQL = SAVE_INVOICE_SQL.replace(
  "confirmed_total_cents = excluded.confirmed_total_cents",
  "confirmed_total_cents = card_invoices.confirmed_total_cents",
);

// The actor, source type, current transaction value and all other allocations
// are checked inside one serialized SQLite statement. Re-saving the same pair
// replaces its amount instead of adding another payment.
export const SAVE_INVOICE_PAYMENT_SQL = `WITH input AS (SELECT ? AS id, ? AS actor_id, ? AS invoice_id, ? AS transaction_id, ? AS amount_cents, ? AS today)
INSERT INTO invoice_payments (id, owner_id, invoice_id, transaction_id, amount_cents)
SELECT i.id, i.actor_id, inv.id, t.id, i.amount_cents FROM input i
JOIN card_invoices inv ON inv.id = i.invoice_id AND inv.owner_id = i.actor_id
JOIN sources card ON card.id = inv.source_id AND card.owner_id = i.actor_id AND card.type = 'credit'
JOIN transactions t ON t.id = i.transaction_id AND t.owner_id = i.actor_id AND t.kind = 'card_payment' AND t.date <= i.today
JOIN sources bank ON bank.id = t.source_id AND bank.owner_id = i.actor_id AND bank.type = 'bank'
WHERE i.amount_cents > 0 AND i.amount_cents <= 1000000000000
AND i.amount_cents + COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.transaction_id = t.id AND p.invoice_id <> inv.id), 0) <= t.amount_cents
ON CONFLICT(invoice_id, transaction_id) DO UPDATE SET amount_cents = excluded.amount_cents
RETURNING id, invoice_id AS invoiceId, transaction_id AS transactionId, amount_cents AS amountCents`;

export const DELETE_INVOICE_PAYMENT_SQL = `DELETE FROM invoice_payments WHERE id = ? AND owner_id = ? RETURNING id`;
