// Bound JSON chunks avoid SQLite's variable limit without splitting an import
// into separately committed transactions.
export const IMPORT_TRANSACTIONS_SQL = `INSERT INTO transactions
  (id, owner_id, source_id, date, description, amount_cents, kind, category,
   shared, shared_couple_id, installment_current, installment_total,
   needs_review, note, import_id, fingerprint)
  SELECT json_extract(j.value, '$.id'), ?, json_extract(j.value, '$.sourceId'),
   json_extract(j.value, '$.date'), json_extract(j.value, '$.description'),
   json_extract(j.value, '$.amountCents'), json_extract(j.value, '$.kind'),
   json_extract(j.value, '$.category'), json_extract(j.value, '$.shared'),
   CASE WHEN json_extract(j.value, '$.shared') = 1 THEN ? ELSE NULL END,
   json_extract(j.value, '$.installmentCurrent'), json_extract(j.value, '$.installmentTotal'),
   json_extract(j.value, '$.needsReview'), json_extract(j.value, '$.note'), ?,
   json_extract(j.value, '$.fingerprint')
  FROM json_each(?) j
  WHERE EXISTS (SELECT 1 FROM sources s WHERE s.id = json_extract(j.value, '$.sourceId') AND s.owner_id = ?)
  ON CONFLICT(owner_id, source_id, fingerprint) DO NOTHING`;

export const JOIN_COUPLE_SQL = `INSERT INTO couple_members (user_id, couple_id, slot, joined_at)
  SELECT ?, c.id,
   CASE WHEN EXISTS (SELECT 1 FROM couple_members m WHERE m.couple_id = c.id AND m.slot = 1) THEN 2 ELSE 1 END, ?
  FROM couples c WHERE c.invite_hash = ? AND c.invite_expires_at > ?
   AND (SELECT COUNT(*) FROM couple_members m WHERE m.couple_id = c.id) < 2
   AND NOT EXISTS (SELECT 1 FROM couple_members WHERE user_id = ?)`;
