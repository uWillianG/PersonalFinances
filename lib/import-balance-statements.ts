// Snapshot and application are executed in the same D1 batch as the imported
// transactions. A version token identifies which operation owns a baseline.
export const SAVE_IMPORT_BALANCE_SQL = `INSERT INTO import_balance_changes
  (id, owner_id, import_id, source_id, before_balance_cents, before_balance_date,
   before_has_opening_balance, before_version, after_version)
SELECT ?, s.owner_id, ?, s.id, s.initial_balance_cents, s.balance_date,
  s.has_opening_balance, s.balance_version, ?
FROM sources s
WHERE s.owner_id = ? AND s.id = ? AND EXISTS (
  SELECT 1 FROM import_batches b WHERE b.id = ? AND b.owner_id = s.owner_id
)`;

export const APPLY_IMPORT_BALANCE_SQL = `UPDATE sources AS s SET
  initial_balance_cents = ?, balance_date = ?, has_opening_balance = 1,
  balance_version = (SELECT h.after_version FROM import_balance_changes h
    WHERE h.import_id = ? AND h.owner_id = s.owner_id AND h.source_id = s.id)
WHERE s.owner_id = ? AND s.id = ? AND EXISTS (
  SELECT 1 FROM import_balance_changes h WHERE h.import_id = ?
    AND h.owner_id = s.owner_id AND h.source_id = s.id AND h.before_version = s.balance_version
)`;

// Removing an older import must not let a later undo resurrect its baseline.
// Rebase its direct successor onto the baseline that existed before it.
export const REBASE_IMPORT_BALANCES_SQL = `UPDATE import_balance_changes AS child SET
  (before_balance_cents, before_balance_date, before_has_opening_balance, before_version) = (
    SELECT parent.before_balance_cents, parent.before_balance_date,
      parent.before_has_opening_balance, parent.before_version
    FROM import_balance_changes parent
    WHERE parent.import_id = ? AND parent.owner_id = ?
      AND parent.source_id = child.source_id AND parent.after_version = child.before_version
  )
WHERE child.owner_id = ? AND child.import_id <> ? AND EXISTS (
  SELECT 1 FROM import_balance_changes parent
  WHERE parent.import_id = ? AND parent.owner_id = child.owner_id
    AND parent.source_id = child.source_id AND parent.after_version = child.before_version
)`;

export const RESTORE_IMPORT_BALANCES_SQL = `UPDATE sources AS s SET
  (initial_balance_cents, balance_date, has_opening_balance, balance_version) = (
    SELECT h.before_balance_cents, h.before_balance_date, h.before_has_opening_balance, h.before_version
    FROM import_balance_changes h WHERE h.import_id = ? AND h.owner_id = s.owner_id
      AND h.source_id = s.id AND h.after_version = s.balance_version
  )
WHERE s.owner_id = ? AND EXISTS (
  SELECT 1 FROM import_balance_changes h WHERE h.import_id = ?
    AND h.owner_id = s.owner_id AND h.source_id = s.id AND h.after_version = s.balance_version
)`;

export const COUNT_IMPORT_BALANCES_SQL = `SELECT COUNT(*) AS count FROM import_balance_changes
WHERE owner_id = ? AND import_id = ?`;
