import assert from "node:assert/strict";
import { test } from "node:test";
import { mapBillingRows } from "../lib/billing-import.ts";
import { parseStatement } from "../lib/import-parser.ts";
import { transactionFingerprint } from "../lib/transaction-identity.ts";

function rows(content: string, fileName = "synthetic-card.csv") {
  return parseStatement(content, {
    fileName,
    sourceType: "credit",
    referenceMonth: "2026-02",
  }).rows;
}

test("compras dos dias 29 e 31 continuam distintas na fatura curta de fevereiro", () => {
  const original = rows(
    "date,title,amount\n2026-01-29,Cafe Central,10.00\n2026-01-31,Cafe Central,10.00",
  );
  const before = JSON.stringify(original);
  const mapped = mapBillingRows(original, "2026-02");
  assert.deepEqual(
    mapped.map((row) => row.date),
    ["2026-02-28", "2026-02-28"],
  );
  assert.equal(new Set(mapped.map((row) => row.fingerprint)).size, 2);
  assert.ok(mapped[0].fingerprint.endsWith("_1"));
  assert.ok(mapped[1].fingerprint.endsWith("_2"));
  assert.match(mapped[0].note!, /2026-01-29/);
  assert.match(mapped[1].note!, /2026-01-31/);
  assert.equal(JSON.stringify(original), before);
});

test("ano bissexto e compras legítimas iguais no mesmo dia preservam toda a multiplicidade", () => {
  const original = rows(
    "date,title,amount\n2028-01-29,Cafe Central,10.00\n2028-01-31,Cafe Central,10.00\n2028-01-31,Cafe Central,10.00",
  );
  const mapped = mapBillingRows(original, "2028-02");
  assert.ok(mapped.every((row) => row.date === "2028-02-29"));
  assert.equal(new Set(mapped.map((row) => row.fingerprint)).size, 3);
  assert.ok(mapped[2].fingerprint.endsWith("_3"));
});

test("reimportar ou renomear o mesmo arquivo mantém as identidades após converter a competência", () => {
  const text =
    "date,title,amount\n2026-01-29,Cafe Central,10.00\n2026-01-31,Cafe Central,10.00";
  assert.deepEqual(
    mapBillingRows(rows(text), "2026-02").map((row) => row.fingerprint),
    mapBillingRows(rows(text, "renamed.csv"), "2026-02").map(
      (row) => row.fingerprint,
    ),
  );
  const [single] = rows("date,title,amount\n2026-01-29,Cafe Central,10.00");
  assert.equal(
    mapBillingRows([single], "2026-02")[0].fingerprint,
    transactionFingerprint({ ...single, date: "2026-02-28" }, 1),
  );
});

test("IDs externos diferentes continuam distintos e repetir o mesmo ID não cria outra identidade", () => {
  const original = rows(
    "date,title,amount,id\n2026-01-29,Cafe Central,10.00,a\n2026-01-31,Cafe Central,10.00,b\n2026-01-31,Cafe Central,10.00,a",
  );
  const mapped = mapBillingRows(original, "2026-02");
  assert.notEqual(mapped[0].fingerprint, mapped[1].fingerprint);
  assert.equal(mapped[0].fingerprint, mapped[2].fingerprint);
  assert.ok(mapped.every((row) => row.fingerprint.endsWith("_1")));
});

test("uma competência já correta preserva a identidade e observação existentes", () => {
  const [original] = rows("date,title,amount\n2026-02-10,Cafe Central,10.00");
  original.note = "Observação existente";
  const [mapped] = mapBillingRows([original], "2026-02");
  assert.equal(mapped.fingerprint, original.fingerprint);
  assert.equal(mapped.note, original.note);
  assert.throws(
    () => mapBillingRows([original], "2026-13"),
    /mês de fatura válido/,
  );
});
