import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { COPY_BUDGETS_SQL, RESET_OCCURRENCE_SQL, SET_OCCURRENCE_SQL } from "../lib/planning-statements.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const id of ["alice", "bea", "carla"]) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, '2026-11-25')").run(id, id, `${id}@example.invalid`);
    db.prepare("INSERT INTO sources (id, owner_id, name, institution, type, balance_date) VALUES (?, ?, ?, 'Teste', 'bank', '2026-11-25')").run(`source-${id}`, id, id);
  }
  db.exec(`INSERT INTO couples (id, created_by, created_at) VALUES ('group-ab', 'alice', '2026-11-25'), ('group-c', 'carla', '2026-11-25');
    INSERT INTO couple_members VALUES ('alice', 'group-ab', 1, '2026-11-25'), ('bea', 'group-ab', 2, '2026-11-25'), ('carla', 'group-c', 1, '2026-11-25');`);
  return db;
}

function budget(db: DatabaseSync, id: string, owner = "alice", group: string | null = null, month = "2026-11", key = "moradia", limit = 10000) {
  db.prepare("INSERT INTO budget_limits (id, owner_id, couple_id, scope, scope_key, month, category, category_key, limit_cents) VALUES (?, ?, ?, ?, ?, ?, 'Moradia', ?, ?)").run(id, owner, group, group ? "couple" : "personal", group ? `couple:${group}` : `personal:${owner}`, month, key, limit);
}

function schedule(db: DatabaseSync, id: string, owner = "alice", group: string | null = null) {
  db.prepare("INSERT INTO recurring_schedules (id, owner_id, couple_id, scope, name, kind, category, amount_cents, frequency, start_date) VALUES (?, ?, ?, ?, 'Aluguel', 'expense', 'Moradia', 10000, 'monthly', '2026-11-25')").run(id, owner, group, group ? "couple" : "personal");
}

function transaction(db: DatabaseSync, id: string, owner = "alice", group: string | null = null, kind = "expense") {
  db.prepare("INSERT INTO transactions (id, owner_id, source_id, date, description, amount_cents, kind, category, shared, shared_couple_id, fingerprint) VALUES (?, ?, ?, '2026-11-25', 'Lançamento', 10000, ?, 'Moradia', ?, ?, ?)").run(id, owner, `source-${owner}`, kind, group ? 1 : 0, group, id);
}

function occurrence(db: DatabaseSync, actor: string, scheduleId: string, transactionId: string | null = null, date = "2026-11-25", state = transactionId ? "linked" : "confirmed") {
  return db.prepare(SET_OCCURRENCE_SQL).get(actor, crypto.randomUUID(), date, state, transactionId, scheduleId, "monthly", "2026-11-25", null, transactionId, transactionId);
}

test("schema mantém um orçamento por categoria/mês/casal e isola planos pessoais", () => {
  const db = database();
  try {
    budget(db, "couple-budget", "alice", "group-ab");
    assert.throws(() => budget(db, "duplicate-couple-budget", "bea", "group-ab"), /UNIQUE/);
    budget(db, "alice-budget");
    budget(db, "bea-budget", "bea");
    assert.throws(() => budget(db, "zero", "alice", null, "2026-12", "moradia", 0), /CHECK/);
    assert.throws(() => db.prepare("UPDATE budget_limits SET scope_key = 'personal:bea' WHERE id = 'alice-budget'").run(), /CHECK/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM budget_limits").get()?.count, 3);
  } finally { db.close(); }
});

test("copiar orçamento preserva destino existente e exige dono ou casal atual", () => {
  const db = database();
  try {
    budget(db, "shared-moradia", "alice", "group-ab");
    budget(db, "shared-lazer", "alice", "group-ab", "2026-11", "lazer", 20000);
    budget(db, "existing-lazer", "bea", "group-ab", "2026-12", "lazer", 50000);
    const copy = db.prepare(COPY_BUDGETS_SQL);
    assert.equal(copy.run("carla", "2026-12", "couple:group-ab", "2026-11").changes, 0);
    assert.equal(copy.run("bea", "2026-12", "couple:group-ab", "2026-11").changes, 1);
    assert.equal(copy.run("alice", "2026-12", "couple:group-ab", "2026-11").changes, 0);
    assert.equal(db.prepare("SELECT limit_cents amount FROM budget_limits WHERE id = 'existing-lazer'").get()?.amount, 50000);
    budget(db, "private");
    assert.equal(copy.run("bea", "2026-12", "personal:alice", "2026-11").changes, 0);
    assert.equal(copy.run("alice", "2026-12", "personal:alice", "2026-11").changes, 1);
  } finally { db.close(); }
});

test("confirmar ou pular ocorrência altera só planejamento, inclusive quando pausado", () => {
  const db = database();
  try {
    schedule(db, "personal");
    db.prepare("UPDATE recurring_schedules SET active = 0 WHERE id = 'personal'").run();
    assert.ok(occurrence(db, "alice", "personal"));
    assert.ok(occurrence(db, "alice", "personal", null, "2026-11-25", "skipped"));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM schedule_occurrences").get()?.count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count, 0);
    assert.equal(db.prepare("SELECT SUM(initial_balance_cents) amount FROM sources").get()?.amount, 0);
    assert.equal(occurrence(db, "bea", "personal"), undefined);
    assert.equal(db.prepare(RESET_OCCURRENCE_SQL).run("bea", "personal", "2026-11-25").changes, 0);
    assert.equal(db.prepare(RESET_OCCURRENCE_SQL).run("alice", "personal", "2026-11-25").changes, 1);
  } finally { db.close(); }
});

test("vínculos pessoais exigem lançamento privado do titular e tipo compatível", () => {
  const db = database();
  try {
    schedule(db, "personal");
    transaction(db, "alice-private");
    transaction(db, "bea-private", "bea");
    transaction(db, "alice-shared", "alice", "group-ab");
    transaction(db, "income", "alice", null, "income");
    for (const id of ["bea-private", "alice-shared", "income", "missing"]) assert.equal(occurrence(db, "alice", "personal", id), undefined);
    assert.equal(occurrence(db, "alice", "personal", "alice-private")?.transactionId, "alice-private");
    assert.throws(() => occurrence(db, "alice", "personal", "alice-private", "2026-12-25"), /UNIQUE/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count, 4);
    db.prepare("DELETE FROM transactions WHERE id = 'alice-private'").run();
    assert.equal(db.prepare("SELECT transaction_id FROM schedule_occurrences").get()?.transaction_id, null);
  } finally { db.close(); }
});

test("vínculos conjuntos exigem compartilhamento no mesmo casal e não aceitam ator externo", () => {
  const db = database();
  try {
    schedule(db, "shared", "alice", "group-ab");
    transaction(db, "bea-shared", "bea", "group-ab");
    transaction(db, "bea-private", "bea");
    transaction(db, "carla-shared", "carla", "group-c");
    assert.equal(occurrence(db, "carla", "shared", "bea-shared"), undefined);
    assert.equal(occurrence(db, "alice", "shared", "bea-private"), undefined);
    assert.equal(occurrence(db, "alice", "shared", "carla-shared"), undefined);
    assert.ok(occurrence(db, "alice", "shared", "bea-shared"));
    assert.ok(occurrence(db, "bea", "shared", null, "2026-11-25", "skipped"));
    db.prepare("UPDATE transactions SET shared = 0, shared_couple_id = NULL WHERE id = 'bea-shared'").run();
    assert.equal(occurrence(db, "alice", "shared", "bea-shared"), undefined);
    db.prepare("DELETE FROM recurring_schedules WHERE id = 'shared'").run();
    assert.equal(db.prepare("SELECT COUNT(*) count FROM schedule_occurrences").get()?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count, 3);
  } finally { db.close(); }
});

test("encerrar casal apaga só planejamento conjunto e impede reuso em outro casal", () => {
  const db = database();
  try {
    budget(db, "couple-budget", "alice", "group-ab");
    budget(db, "personal-budget");
    schedule(db, "shared", "alice", "group-ab");
    schedule(db, "personal");
    transaction(db, "ledger", "alice", "group-ab");
    assert.ok(occurrence(db, "bea", "shared", "ledger"));
    db.prepare("DELETE FROM couples WHERE id = 'group-ab'").run();
    assert.equal(db.prepare("SELECT COUNT(*) count FROM budget_limits").get()?.count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM recurring_schedules").get()?.count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM schedule_occurrences").get()?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count, 1);
    assert.equal(occurrence(db, "alice", "shared", "ledger"), undefined);
    assert.equal(db.prepare(COPY_BUDGETS_SQL).run("alice", "2026-12", "couple:group-ab", "2026-11").changes, 0);
  } finally { db.close(); }
});
