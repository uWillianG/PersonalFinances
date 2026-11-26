import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { IMPORT_TRANSACTIONS_SQL, JOIN_COUPLE_SQL } from "../lib/database-statements.ts";
import { transactionFingerprint } from "../lib/transaction-identity.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(migrations.length, "Generate and commit the D1 migration before running database checks.");
  for (const name of migrations) db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const id of ["alice", "bea", "carla"]) {
    db.prepare("INSERT INTO users (id, display_name, email, updated_at) VALUES (?, ?, ?, ?)").run(id, id, `${id}@example.invalid`, "2026-11-25T00:00:00.000Z");
    db.prepare("INSERT INTO sources (id, owner_id, name, institution, type, initial_balance_cents, balance_date, has_opening_balance) VALUES (?, ?, ?, 'Teste', 'bank', 0, '2026-11-25', 0)").run(`source-${id}`, id, `Conta ${id}`);
  }
  return db;
}

function batch(db: DatabaseSync, id: string, owner = "alice") {
  db.prepare("INSERT INTO import_batches (id, owner_id, created_at, files_json, count, income_cents, expense_cents, period_start, period_end) VALUES (?, ?, '2026-11-25T00:00:00.000Z', '[\"extrato.csv\"]', 0, 0, 0, '2026-11-25', '2026-11-25')").run(id, owner);
}

function row(id: string, changes: Record<string, unknown> = {}) {
  const content = {
    id, sourceId: "source-alice", date: "2026-11-25", description: `Compra ${id}`,
    amountCents: 100, kind: "expense" as const, category: "Outros", shared: 0,
    installmentCurrent: null, installmentTotal: null, needsReview: 0, note: "", ...changes,
  };
  return { ...content, fingerprint: transactionFingerprint(content) };
}

test("SQL de importação ignora fonte de outro titular e deduplica somente dentro da fonte/titular", () => {
  const db = database();
  try {
    batch(db, "batch-alice");
    const statement = db.prepare(IMPORT_TRANSACTIONS_SQL);
    const purchase = row("purchase-a");
    assert.equal(statement.run("alice", null, "batch-alice", JSON.stringify([purchase]), "alice").changes, 1);
    assert.equal(statement.run("alice", null, "batch-alice", JSON.stringify([{ ...purchase, id: "purchase-copy" }]), "alice").changes, 0);
    assert.equal(statement.run("alice", null, "batch-alice", JSON.stringify([row("foreign", { sourceId: "source-bea" })]), "alice").changes, 0);
    batch(db, "batch-bea", "bea");
    assert.equal(statement.run("bea", null, "batch-bea", JSON.stringify([{ ...purchase, id: "purchase-bea", sourceId: "source-bea" }]), "bea").changes, 1);
  } finally { db.close(); }
});

test("5.000 transações usam o mesmo SQL de lote sem exceder binds e sem perder centavos", () => {
  const db = database();
  try {
    db.exec("BEGIN");
    batch(db, "large-batch");
    const statement = db.prepare(IMPORT_TRANSACTIONS_SQL);
    for (let start = 0; start < 5000; start += 50) {
      const chunk = Array.from({ length: 50 }, (_, offset) => row(`item-${start + offset}`, { amountCents: 12345 }));
      assert.equal(statement.run("alice", null, "large-batch", JSON.stringify(chunk), "alice").changes, 50);
    }
    db.exec("COMMIT");
    const result = db.prepare("SELECT COUNT(*) count, SUM(amount_cents) total FROM transactions WHERE owner_id = 'alice'").get();
    assert.equal(result?.count, 5000);
    assert.equal(result?.total, 61_725_000);
  } finally { db.close(); }
});

test("erro num lote reverte metadata e linhas", () => {
  const db = database();
  try {
    db.exec("BEGIN");
    batch(db, "rollback-batch");
    const insert = db.prepare(IMPORT_TRANSACTIONS_SQL);
    insert.run("alice", null, "rollback-batch", JSON.stringify([row("valid")]), "alice");
    assert.throws(() => insert.run("alice", null, "missing-batch", JSON.stringify([row("invalid")]), "alice"), /FOREIGN KEY/);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM import_batches").get()?.count, 0);
  } finally { db.close(); }
});

test("schema impede relação com três membros e SQL rejeita convite vencido", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO couples (id, created_by, invite_hash, invite_expires_at, created_at) VALUES ('couple', 'alice', 'hash-code', '2026-12-02T00:00:00.000Z', '2026-11-25T00:00:00.000Z')").run();
    db.prepare("INSERT INTO couple_members (user_id, couple_id, slot, joined_at) VALUES ('alice', 'couple', 1, '2026-11-25T00:00:00.000Z')").run();
    const join = db.prepare(JOIN_COUPLE_SQL);
    assert.equal(join.run("bea", "2026-12-03T00:00:00.000Z", "hash-code", "2026-12-03T00:00:00.000Z", "bea").changes, 0);
    assert.equal(join.run("bea", "2026-11-25T00:00:00.000Z", "hash-code", "2026-11-25T00:00:00.000Z", "bea").changes, 1);
    assert.equal(join.run("carla", "2026-11-25T00:00:00.000Z", "hash-code", "2026-11-25T00:00:00.000Z", "carla").changes, 0);
    assert.throws(() => db.prepare("INSERT INTO couple_members (user_id, couple_id, slot, joined_at) VALUES ('carla', 'couple', 3, '2026-11-25T00:00:00.000Z')").run(), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO couple_members (user_id, couple_id, slot, joined_at) VALUES ('carla', 'couple', 2, '2026-11-25T00:00:00.000Z')").run(), /UNIQUE/);
  } finally { db.close(); }
});

test("excluir importação de outro owner não apaga nem movimentações nem arquivo", () => {
  const db = database();
  try {
    batch(db, "batch-bea", "bea");
    db.prepare(IMPORT_TRANSACTIONS_SQL).run("bea", null, "batch-bea", JSON.stringify([row("bea-purchase", { sourceId: "source-bea" })]), "bea");
    assert.equal(db.prepare("DELETE FROM import_batches WHERE id = ? AND owner_id = ?").run("batch-bea", "alice").changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions WHERE owner_id = 'bea'").get()?.count, 1);
    db.prepare("DELETE FROM import_batches WHERE id = ? AND owner_id = ?").run("batch-bea", "bea");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions WHERE owner_id = 'bea'").get()?.count, 0);
  } finally { db.close(); }
});
