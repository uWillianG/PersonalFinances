import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  DELETE_INVOICE_PAYMENT_SQL,
  ENSURE_INVOICE_SQL,
  SAVE_CARD_CYCLE_SQL,
  SAVE_INVOICE_PAYMENT_SQL,
  SAVE_INVOICE_SQL,
} from "../lib/invoice-statements.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const actor of ["alice", "bea"]) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, '2026-11-26')").run(
      actor,
      actor,
      `${actor}@example.invalid`,
    );
    for (const type of ["bank", "credit", "benefit"])
      db.prepare(
        "INSERT INTO sources (id,owner_id,name,institution,type,initial_balance_cents,balance_date,has_opening_balance) VALUES (?, ?, ?, 'Teste', ?, 100000, '2026-11-01', 1)",
      ).run(`${actor}-${type}`, actor, type, type);
  }
  db.exec(
    "INSERT INTO couples (id,created_by,created_at) VALUES ('together','alice','2026-11-26'); INSERT INTO couple_members VALUES ('alice','together',1,'2026-11-26'),('bea','together',2,'2026-11-26')",
  );
  return db;
}
function invoice(
  db: DatabaseSync,
  id: string,
  actor = "alice",
  month = "2026-11",
  total: number | null = null,
  source = `${actor}-credit`,
) {
  return db.prepare(SAVE_INVOICE_SQL).get(id, month, total, source, actor);
}
function transaction(
  db: DatabaseSync,
  id: string,
  actor = "alice",
  amount = 10000,
  kind = "card_payment",
  source = `${actor}-bank`,
  date = "2026-11-10",
  batch: string | null = null,
) {
  db.prepare(
    "INSERT INTO transactions (id,owner_id,source_id,date,description,amount_cents,kind,category,fingerprint,import_id) VALUES (?, ?, ?, ?, 'Pagamento teste', ?, ?, 'Fatura', ?, ?)",
  ).run(id, actor, source, date, amount, kind, id, batch);
}
function allocate(
  db: DatabaseSync,
  id: string,
  invoiceId = "invoice",
  transactionId = "payment",
  amount = 10000,
  actor = "alice",
) {
  return db
    .prepare(SAVE_INVOICE_PAYMENT_SQL)
    .get(id, actor, invoiceId, transactionId, amount, "2026-11-26") as
    | {
        id: string;
        invoiceId: string;
        transactionId: string;
        amountCents: number;
      }
    | undefined;
}

test("ciclo e total são exclusivos do cartão de crédito próprio, com upsert estável", () => {
  const db = database();
  try {
    const cycle = db.prepare(SAVE_CARD_CYCLE_SQL);
    assert.ok(cycle.get(28, 5, "alice-credit", "alice"));
    assert.equal(cycle.get(28, 5, "alice-bank", "alice"), undefined);
    assert.equal(cycle.get(28, 5, "alice-benefit", "alice"), undefined);
    assert.equal(cycle.get(28, 5, "bea-credit", "alice"), undefined);
    assert.equal(
      invoice(db, "foreign", "alice", "2026-11", null, "bea-credit"),
      undefined,
    );
    assert.equal(
      invoice(db, "not-card", "alice", "2026-11", null, "alice-bank"),
      undefined,
    );
    assert.deepEqual(
      { ...invoice(db, "invoice", "alice", "2026-11", 15000) },
      {
        id: "invoice",
        sourceId: "alice-credit",
        month: "2026-11",
        confirmedTotalCents: 15000,
      },
    );
    const kept = db
      .prepare(ENSURE_INVOICE_SQL)
      .get("new-id", "2026-11", null, "alice-credit", "alice");
    assert.equal(kept?.id, "invoice");
    assert.equal(kept?.confirmedTotalCents, 15000);
    assert.equal(
      invoice(db, "again", "alice", "2026-11", 0)?.confirmedTotalCents,
      0,
    );
    assert.equal(
      invoice(db, "reset", "alice", "2026-11", null)?.confirmedTotalCents,
      null,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM card_invoices").get()?.count,
      1,
    );
  } finally {
    db.close();
  }
});

test("vínculos exigem banco, titular e tipo corretos mesmo no casal, sem aceitar pagamento futuro", () => {
  const db = database();
  try {
    invoice(db, "invoice");
    transaction(db, "payment");
    transaction(db, "partner", "bea");
    transaction(db, "expense", "alice", 10000, "expense");
    transaction(
      db,
      "credit-receipt",
      "alice",
      10000,
      "card_payment",
      "alice-credit",
    );
    transaction(db, "benefit", "alice", 10000, "card_payment", "alice-benefit");
    transaction(
      db,
      "future",
      "alice",
      10000,
      "card_payment",
      "alice-bank",
      "2026-11-27",
    );
    for (const id of [
      "partner",
      "expense",
      "credit-receipt",
      "benefit",
      "future",
      "missing",
    ])
      assert.equal(allocate(db, `bad-${id}`, "invoice", id), undefined);
    assert.equal(
      allocate(db, "foreign-actor", "invoice", "payment", 10000, "bea"),
      undefined,
    );
    assert.ok(allocate(db, "own"));
    assert.equal(
      db.prepare(DELETE_INVOICE_PAYMENT_SQL).get("own", "bea"),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count,
      6,
    );
    assert.equal(
      db
        .prepare(
          "SELECT initial_balance_cents FROM sources WHERE id='alice-bank'",
        )
        .get()?.initial_balance_cents,
      100000,
    );
  } finally {
    db.close();
  }
});

test("pagamento pode ser dividido sem exceder seu valor e retries substituem a mesma alocação", () => {
  const db = database();
  try {
    invoice(db, "invoice");
    invoice(db, "next", "alice", "2026-12");
    transaction(db, "payment");
    const first = allocate(db, "first", "invoice", "payment", 6000);
    assert.ok(first);
    assert.equal(
      allocate(db, "simultaneous", "next", "payment", 6000),
      undefined,
    );
    assert.equal(
      allocate(db, "retry", "invoice", "payment", 6000)?.id,
      "first",
    );
    assert.ok(allocate(db, "second", "next", "payment", 4000));
    assert.equal(allocate(db, "over", "invoice", "payment", 6001), undefined);
    assert.equal(
      allocate(db, "replace", "invoice", "payment", 5000)?.id,
      "first",
    );
    assert.equal(
      db.prepare("SELECT SUM(amount_cents) amount FROM invoice_payments").get()
        ?.amount,
      9000,
    );
    assert.ok(db.prepare(DELETE_INVOICE_PAYMENT_SQL).get("second", "alice"));
    assert.equal(
      allocate(db, "increase", "invoice", "payment", 10000)?.amountCents,
      10000,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM invoice_payments").get()?.count,
      1,
    );
  } finally {
    db.close();
  }
});

test("banco impede fraude por SQL direto e preserva os valores vinculados ao corrigir fontes ou movimentos", () => {
  const db = database();
  try {
    invoice(db, "invoice");
    invoice(db, "other", "alice", "2026-12");
    invoice(db, "bea-invoice", "bea");
    transaction(db, "payment");
    transaction(db, "partner", "bea");
    assert.ok(allocate(db, "link", "invoice", "payment", 6000));
    const insert = db.prepare(
      "INSERT INTO invoice_payments VALUES (?, ?, ?, ?, ?)",
    );
    assert.throws(() => insert.run("fraud", "bea", "invoice", "partner", 1));
    assert.throws(() => insert.run("over", "alice", "other", "payment", 5000));
    assert.throws(() =>
      db.exec("UPDATE invoice_payments SET amount_cents=10001 WHERE id='link'"),
    );
    assert.throws(() =>
      db.exec("UPDATE transactions SET amount_cents=5999 WHERE id='payment'"),
    );
    assert.throws(() =>
      db.exec("UPDATE transactions SET kind='expense' WHERE id='payment'"),
    );
    assert.throws(() =>
      db.exec(
        "UPDATE transactions SET source_id='alice-credit' WHERE id='payment'",
      ),
    );
    assert.throws(() =>
      db.exec("UPDATE sources SET type='credit' WHERE id='alice-bank'"),
    );
    assert.throws(() =>
      db.exec("UPDATE sources SET type='bank' WHERE id='alice-credit'"),
    );
    db.exec("UPDATE transactions SET amount_cents=12000 WHERE id='payment'");
    assert.equal(
      db.prepare("SELECT SUM(amount_cents) amount FROM invoice_payments").get()
        ?.amount,
      6000,
    );
    assert.ok(db.prepare(DELETE_INVOICE_PAYMENT_SQL).get("link", "alice"));
    db.exec(
      "UPDATE transactions SET kind='expense',amount_cents=1 WHERE id='payment'",
    );
  } finally {
    db.close();
  }
});

test("remover importação apaga só referências de pagamento sem conservar uma falsa quitação", () => {
  const db = database();
  try {
    invoice(db, "invoice", "alice", "2026-11", 10000);
    db.exec(
      "INSERT INTO import_batches (id,owner_id,created_at,files_json,period_start,period_end) VALUES ('batch','alice','2026-11-26','[]','2026-11-01','2026-11-26')",
    );
    transaction(
      db,
      "payment",
      "alice",
      10000,
      "card_payment",
      "alice-bank",
      "2026-11-10",
      "batch",
    );
    allocate(db, "link");
    db.exec("DELETE FROM import_batches WHERE id='batch'");
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM invoice_payments").get()?.count,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT confirmed_total_cents amount FROM card_invoices WHERE id='invoice'",
        )
        .get()?.amount,
      10000,
    );
    assert.equal(
      db
        .prepare(
          "SELECT initial_balance_cents FROM sources WHERE id='alice-bank'",
        )
        .get()?.initial_balance_cents,
      100000,
    );
  } finally {
    db.close();
  }
});
