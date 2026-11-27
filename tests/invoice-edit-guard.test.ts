import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { invoicePaymentEditGuard } from "../lib/invoice-edit-guard.ts";
import { SAVE_INVOICE_PAYMENT_SQL } from "../lib/invoice-statements.ts";
import type { TransactionPatch } from "../lib/validation.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  db.exec(
    "INSERT INTO users VALUES('alice','Alice','a@example.invalid','2026-11-26'); INSERT INTO sources(id,owner_id,name,institution,type,balance_date) VALUES('bank','alice','Conta','Teste','bank','2026-11-01'),('card','alice','Cartão','Teste','credit','2026-11-01'); INSERT INTO transactions(id,owner_id,source_id,date,description,amount_cents,kind,category,fingerprint) VALUES('payment','alice','bank','2026-11-20','Fatura',10000,'card_payment','Fatura','f'); INSERT INTO card_invoices(id,owner_id,source_id,month,confirmed_total_cents) VALUES('invoice','alice','card','2026-11',10000);",
  );
  return db;
}
function allocate(db: DatabaseSync) {
  assert.ok(
    db
      .prepare(SAVE_INVOICE_PAYMENT_SQL)
      .get("link", "alice", "invoice", "payment", 10000, "2026-11-26"),
  );
}
function edit(db: DatabaseSync, patch: TransactionPatch, actor = "alice") {
  const query = new SQLiteSyncDialect().sqlToQuery(sql`UPDATE transactions SET
    date=COALESCE(${patch.date ?? null},date),
    kind=COALESCE(${patch.kind ?? null},kind),
    amount_cents=COALESCE(${patch.amountCents ?? null},amount_cents),
    note=COALESCE(${patch.note ?? null},note)
    WHERE id='payment' AND owner_id=${actor} AND ${invoicePaymentEditGuard(patch, "2026-11-26")}
    RETURNING id`);
  return db
    .prepare(query.sql)
    .get(...(query.params as (string | number | null)[]));
}
test("vínculo criado após pré-checagem bloqueia atomicamente edição para data futura", () => {
  const db = database();
  try {
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) count FROM invoice_payments WHERE transaction_id='payment'",
        )
        .get()?.count,
      0,
    );
    allocate(db);
    assert.equal(edit(db, { date: "2026-12-15" }), undefined);
    assert.equal(
      db.prepare("SELECT date FROM transactions WHERE id='payment'").get()
        ?.date,
      "2026-11-20",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM invoice_payments").get()?.count,
      1,
    );
  } finally {
    db.close();
  }
});
test("guardas atômicas impedem reduzir valor alocado ou mudar o tipo após outro pedido vincular", () => {
  const db = database();
  try {
    allocate(db);
    assert.equal(edit(db, { amountCents: 9999 }), undefined);
    assert.equal(edit(db, { kind: "expense" }), undefined);
    assert.ok(edit(db, { amountCents: 12000 }));
  } finally {
    db.close();
  }
});
test("correções compatíveis de data e nota mantêm o vínculo e a propriedade", () => {
  const db = database();
  try {
    allocate(db);
    assert.ok(edit(db, { date: "2026-11-25", note: "Conferido" }));
    assert.equal(edit(db, { note: "forged" }, "bea"), undefined);
    assert.equal(
      db.prepare("SELECT note FROM transactions WHERE id='payment'").get()
        ?.note,
      "Conferido",
    );
    assert.equal(
      db.prepare("SELECT amount_cents FROM invoice_payments").get()
        ?.amount_cents,
      10000,
    );
  } finally {
    db.close();
  }
});
test("lançamento ainda sem vínculo permite correções ordinárias, inclusive data futura", () => {
  const db = database();
  try {
    assert.ok(
      edit(db, { date: "2026-12-15", kind: "expense", amountCents: 9000 }),
    );
  } finally {
    db.close();
  }
});
