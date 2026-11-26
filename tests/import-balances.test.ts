import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  APPLY_IMPORT_BALANCE_SQL,
  REBASE_IMPORT_BALANCES_SQL,
  RESTORE_IMPORT_BALANCES_SQL,
  SAVE_IMPORT_BALANCE_SQL,
} from "../lib/import-balance-statements.ts";
import {
  applyDemoImportBalances,
  undoDemoImportBalances,
} from "../lib/import-balances.ts";
import { validateImportBalances } from "../lib/validation.ts";
import type { AppState } from "../lib/types.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const owner of ["alice", "bea"]) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, '2026-11-26')").run(
      owner,
      owner,
      `${owner}@example.invalid`,
    );
    db.prepare(
      "INSERT INTO sources (id, owner_id, name, institution, type, initial_balance_cents, balance_date, has_opening_balance) VALUES (?, ?, 'Conta', 'Teste', 'bank', 5000, '2026-11-01', 1)",
    ).run(`source-${owner}`, owner);
  }
  return db;
}
function batch(db: DatabaseSync, id: string, owner = "alice") {
  db.prepare(
    "INSERT INTO import_batches (id, owner_id, created_at, files_json, period_start, period_end, balance_tracking) VALUES (?, ?, '2026-11-26', '[]', '2026-11-01', '2026-11-26', 1)",
  ).run(id, owner);
}
function apply(
  db: DatabaseSync,
  id: string,
  amount = 10000,
  owner = "alice",
  source = `source-${owner}`,
) {
  batch(db, id, owner);
  db.prepare(SAVE_IMPORT_BALANCE_SQL).run(
    `change-${id}`,
    id,
    `version-${id}`,
    owner,
    source,
    id,
  );
  db.prepare(APPLY_IMPORT_BALANCE_SQL).run(
    amount,
    "2026-11-26",
    id,
    owner,
    source,
    id,
  );
}
function undo(db: DatabaseSync, id: string, owner = "alice") {
  db.exec("BEGIN");
  try {
    db.prepare(REBASE_IMPORT_BALANCES_SQL).run(id, owner, owner, id, id);
    const restored = db
      .prepare(RESTORE_IMPORT_BALANCES_SQL)
      .run(id, owner, id).changes;
    db.prepare(
      "DELETE FROM transactions WHERE import_id = ? AND owner_id = ?",
    ).run(id, owner);
    db.prepare("DELETE FROM import_batches WHERE id = ? AND owner_id = ?").run(
      id,
      owner,
    );
    db.exec("COMMIT");
    return restored;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function source(db: DatabaseSync, id = "source-alice") {
  return db
    .prepare(
      "SELECT initial_balance_cents AS amount, balance_date AS date, has_opening_balance AS known, balance_version AS version FROM sources WHERE id = ?",
    )
    .get(id);
}

test("saldo aceito na importação e seu histórico são revertidos junto dos lançamentos", () => {
  const db = database();
  try {
    const before = source(db);
    apply(db, "a", 15000);
    db.exec(
      "INSERT INTO transactions (id, owner_id, source_id, date, description, amount_cents, kind, category, import_id, fingerprint) VALUES ('tx','alice','source-alice','2026-11-26','Compra',100,'expense','Outros','a','tx')",
    );
    assert.equal(source(db)?.amount, 15000);
    assert.equal(undo(db, "a"), 1);
    assert.deepEqual(source(db), before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions").get()?.n, 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM import_balance_changes").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test("desfazer importações em qualquer ordem não ressuscita saldo de lote removido", () => {
  const orders = [
    ["a", "b", "c"],
    ["a", "c", "b"],
    ["b", "a", "c"],
    ["b", "c", "a"],
    ["c", "a", "b"],
    ["c", "b", "a"],
  ];
  for (const order of orders) {
    const db = database();
    try {
      const before = source(db);
      apply(db, "a", 10000);
      apply(db, "b", 20000);
      apply(db, "c", 30000);
      for (const id of order) undo(db, id);
      assert.deepEqual(source(db), before, order.join(" -> "));
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM import_balance_changes").get()?.n,
        0,
      );
    } finally {
      db.close();
    }
  }
});

test("saldo manual posterior é preservado mesmo quando repete o valor importado", () => {
  const db = database();
  try {
    apply(db, "a", 10000);
    db.prepare(
      "UPDATE sources SET balance_version = 'manual-choice' WHERE id = 'source-alice'",
    ).run();
    const manual = source(db);
    apply(db, "b", 20000);
    assert.equal(undo(db, "a"), 0);
    assert.equal(source(db)?.amount, 20000);
    assert.equal(undo(db, "b"), 1);
    assert.deepEqual(source(db), manual);
  } finally {
    db.close();
  }
});

test("dois saldos idênticos mantêm origem distinta e uma edição manual invalida o desfazer", () => {
  const db = database();
  try {
    const before = source(db);
    apply(db, "a", 10000);
    apply(db, "b", 10000);
    assert.equal(undo(db, "a"), 0);
    assert.equal(undo(db, "b"), 1);
    assert.deepEqual(source(db), before);
    apply(db, "c", 10000);
    db.prepare(
      "UPDATE sources SET initial_balance_cents=12345, balance_date='2026-11-27', has_opening_balance=0, balance_version='manual-later' WHERE id='source-alice'",
    ).run();
    const manual = source(db);
    assert.equal(undo(db, "c"), 0);
    assert.deepEqual(source(db), manual);
  } finally {
    db.close();
  }
});

test("snapshots, aplicação e desfazer não acessam saldo de outro titular", () => {
  const db = database();
  try {
    const bea = source(db, "source-bea");
    apply(db, "a", 10000, "alice", "source-bea");
    assert.deepEqual(source(db, "source-bea"), bea);
    apply(db, "b", 20000, "bea");
    assert.equal(undo(db, "b", "alice"), 0);
    assert.equal(source(db, "source-bea")?.amount, 20000);
    assert.equal(undo(db, "b", "bea"), 1);
    assert.deepEqual(source(db, "source-bea"), bea);
  } finally {
    db.close();
  }
});

test("erro no lote reverte transações, snapshot e aplicação do saldo", () => {
  const db = database();
  try {
    const before = source(db);
    db.exec("BEGIN");
    apply(db, "a", 10000);
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO transactions (id, owner_id, source_id, date, description, amount_cents, kind, category, import_id, fingerprint) VALUES ('bad','alice','source-alice','2026-11-26','Compra',100,'expense','Outros','missing','bad')",
        ),
      /FOREIGN KEY/,
    );
    db.exec("ROLLBACK");
    assert.deepEqual(source(db), before);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM import_balance_changes").get()?.n,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM import_batches").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test("saldos opcionais aceitam dívida e rejeitam duplicatas, datas inexistentes ou campos internos", () => {
  assert.deepEqual(validateImportBalances({ items: [] }), []);
  const update = {
    sourceId: "source",
    amountCents: -10000,
    date: "2026-11-26",
  };
  assert.deepEqual(validateImportBalances({ balanceUpdates: [update] }), [
    update,
  ]);
  for (const balanceUpdates of [
    null,
    [update, update],
    [{ ...update, date: "2026-02-30" }],
    [{ ...update, amountCents: 1.5 }],
    [{ ...update, ownerId: "bea" }],
    [{ ...update, balanceVersion: "forged" }],
    Array.from({ length: 101 }, (_, i) => ({
      ...update,
      sourceId: `source-${i}`,
    })),
  ])
    assert.throws(() => validateImportBalances({ balanceUpdates }));
});

function demo(): AppState {
  return {
    user: { id: "alice", name: "Alice", email: "alice@example.invalid" },
    sources: [
      {
        id: "source",
        ownerId: "alice",
        name: "Conta",
        institution: "Teste",
        type: "bank",
        initialBalanceCents: 5000,
        balanceDate: "2026-11-01",
        hasOpeningBalance: false,
      },
    ],
    transactions: [],
    partnerTransactions: [],
    imports: [],
    couple: null,
  };
}

test("modo demo mantém histórico em memória e restaura ambos os sentidos sem mutar a entrada", () => {
  const initial = demo(),
    snapshot = structuredClone(initial);
  const a = applyDemoImportBalances(initial, "a", [
    { sourceId: "source", amountCents: 10000, date: "2026-11-26" },
  ]);
  const b = applyDemoImportBalances(a, "b", [
    { sourceId: "source", amountCents: 20000, date: "2026-11-27" },
  ]);
  const forward = undoDemoImportBalances(undoDemoImportBalances(b, "a"), "b");
  const reverse = undoDemoImportBalances(undoDemoImportBalances(b, "b"), "a");
  assert.deepEqual(forward.sources[0], {
    ...initial.sources[0],
    balanceVersion: "",
  });
  assert.deepEqual(reverse.sources[0], forward.sources[0]);
  assert.deepEqual(initial, snapshot);
  const manual = {
    ...b,
    sources: b.sources.map((s) => ({
      ...s,
      initialBalanceCents: 99999,
      balanceVersion: "manual",
    })),
  };
  assert.equal(
    undoDemoImportBalances(manual, "b").sources[0].initialBalanceCents,
    99999,
  );
});
