import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintOccurrence, transactionFingerprint } from "../lib/transaction-identity.ts";
import { ApiError, money, readJson, validDate, validateImport, validateOrigin, validateSource, validateTransactionPatch } from "../lib/validation.ts";

const draft = {
  date: "2026-11-25", description: "Mercado de teste", amountCents: 4599,
  kind: "expense" as const, category: "Mercado", installmentCurrent: null, installmentTotal: null,
  needsReview: false, sourceId: "source-owner-a", fileName: "extrato.csv",
};
function item(changes: Record<string, unknown> = {}, occurrence = 1) {
  const row = { ...draft, ...changes };
  return { ...row, fingerprint: transactionFingerprint(row, occurrence) };
}

test("datas reais respeitam ano bissexto e rejeitam normalização silenciosa", () => {
  assert.equal(validDate("2024-02-29"), "2024-02-29");
  for (const date of ["2026-02-29", "2026-11-31", "2026-00-10", "25/11/2026", "0000-01-01"]) assert.throws(() => validDate(date), ApiError);
});

test("centavos são inteiros seguros, incluindo valores negativos", () => {
  assert.equal(money(-12345), -12345);
  for (const amount of [12.5, NaN, Infinity, "12345", Number.MAX_SAFE_INTEGER]) assert.throws(() => money(amount), ApiError);
});

test("origem diferente e pedidos cross-site são rejeitados antes das mutações", () => {
  validateOrigin(new Request("https://clara.example/api/imports", { method: "POST", headers: { origin: "https://clara.example" } }));
  validateOrigin(new Request("https://clara.example/api/imports", { method: "POST" }));
  for (const headers of [new Headers({ origin: "https://attacker.example" }), new Headers({ origin: "null" }), new Headers({ "sec-fetch-site": "cross-site" })]) {
    assert.throws(() => validateOrigin(new Request("https://clara.example/api/imports", { method: "POST", headers })), ApiError);
  }
});

test("JSON exige tipo correto, objeto e conteúdo bem formado", async () => {
  await assert.rejects(readJson(new Request("https://clara.example", { method: "POST", body: "{}" })), (error: unknown) => error instanceof ApiError && error.status === 415);
  for (const body of ["[]", "null", "{bad"]) await assert.rejects(readJson(new Request("https://clara.example", { method: "POST", headers: { "content-type": "application/json" }, body })), ApiError);
});

test("payload não pode escolher proprietário, ID ou dados internos", () => {
  const source = { name: "Conta", institution: "Teste", type: "bank", initialBalanceCents: 0, balanceDate: "2026-11-25", hasOpeningBalance: false };
  assert.equal(validateSource(source).name, "Conta");
  assert.throws(() => validateSource({ ...source, ownerId: "another-owner" }), ApiError);
  assert.throws(() => validateTransactionPatch({ ownerId: "another-owner" }), ApiError);
  assert.throws(() => validateTransactionPatch({ sourceId: "another-source" }), ApiError);
  assert.throws(() => validateImport({ items: [{ ...item(), ownerId: "another-owner" }] }), ApiError);
});

test("campos editáveis podem ser corrigidos, mas não alteram identidade persistida", () => {
  assert.deepEqual(validateTransactionPatch({ category: "Saúde", shared: false, note: "Conferido" }), { category: "Saúde", shared: false, note: "Conferido" });
  assert.throws(() => validateTransactionPatch({ shared: "true" }), ApiError);
  assert.throws(() => validateTransactionPatch({ amountCents: -100 }), ApiError);
  assert.throws(() => validateImport({ items: [item({ amountCents: -100 })] }), ApiError);
  assert.throws(() => validateTransactionPatch({}), ApiError);
});

test("edição de parcelas exige par completo válido e permite remover parcelas", () => {
  assert.deepEqual(validateTransactionPatch({ installmentCurrent: 2, installmentTotal: 12 }), { installmentCurrent: 2, installmentTotal: 12 });
  assert.deepEqual(validateTransactionPatch({ installmentCurrent: null, installmentTotal: null }), { installmentCurrent: null, installmentTotal: null });
  assert.deepEqual(validateTransactionPatch({ installmentCurrent: 120, installmentTotal: 600 }), { installmentCurrent: 120, installmentTotal: 600 });
  for (const patch of [
    { installmentCurrent: 1 }, { installmentTotal: 12 },
    { installmentCurrent: null, installmentTotal: 12 }, { installmentCurrent: 1, installmentTotal: null },
    { installmentCurrent: 13, installmentTotal: 12 }, { installmentCurrent: 0, installmentTotal: 12 },
    { installmentCurrent: 1.5, installmentTotal: 12 }, { installmentCurrent: 1, installmentTotal: 601 },
  ]) assert.throws(() => validateTransactionPatch(patch), ApiError);
  // Fingerprint cannot be replaced by an editing request: dedup retains the
  // original imported bank identity, including the imported installment.
  assert.throws(() => validateTransactionPatch({ installmentCurrent: 2, installmentTotal: 12, fingerprint: "replacement" }), ApiError);
});

test("importação exige conta, arquivo e no máximo 5.000 linhas", () => {
  assert.throws(() => validateImport({ items: [] }), ApiError);
  assert.throws(() => validateImport({ items: Array(5001).fill(item()) }), ApiError);
  assert.throws(() => validateImport({ items: [item({ sourceId: undefined })] }), ApiError);
  assert.throws(() => validateImport({ items: [item({ fileName: "" })] }), ApiError);
  assert.equal(validateImport({ items: [item()] })[0].shared, false);
});

test("mesmo gasto em duas ocorrências é preservado e a reimportação é estável", () => {
  const first = item({}, 1);
  const second = item({}, 2);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(transactionFingerprint(first, 1), first.fingerprint);
  assert.equal(fingerprintOccurrence(second.fingerprint), 2);
  // Removing the first occurrence from a preview must not renumber the other.
  assert.equal(validateImport({ items: [second] })[0].fingerprint, second.fingerprint);
});

test("servidor detecta fingerprint adulterado e desconsidera campos editoriais", () => {
  const original = item();
  assert.throws(() => validateImport({ items: [{ ...original, amountCents: 99999 }] }), ApiError);
  assert.throws(() => validateImport({ items: [{ ...original, kind: "income" }] }), ApiError);
  // Reclassification preserves identity only when movement direction stays
  // the same. Category, sharing and note are still editorial metadata.
  assert.equal(validateImport({ items: [{ ...original, kind: "transfer_out", category: "Transferências", note: "Ajustado" }] })[0].fingerprint, original.fingerprint);
});

test("entradas e saídas de mesmo valor, data e descrição têm identidades distintas", () => {
  const outgoing = transactionFingerprint(draft);
  const incoming = transactionFingerprint({ ...draft, kind: "income" });
  assert.notEqual(outgoing, incoming);
  for (const kind of ["expense", "transfer_out", "card_payment"] as const) assert.equal(transactionFingerprint({ ...draft, kind }), outgoing);
  for (const kind of ["income", "refund", "transfer_in"] as const) assert.equal(transactionFingerprint({ ...draft, kind }), incoming);
});

test("identificador externo é estável e não cria ocorrências extras", () => {
  const external = item({ externalId: "bank-id-123" });
  assert.equal(transactionFingerprint({ ...external, description: "Nome corrigido", amountCents: 100 }), external.fingerprint);
  assert.equal(transactionFingerprint(external, 2), external.fingerprint);
  assert.throws(() => validateImport({ items: [{ ...external, fingerprint: external.fingerprint.replace(/_1$/, "_2") }] }), ApiError);
});

test("normalização textual é igual no navegador e servidor; parcelas compõem identidade", () => {
  assert.equal(transactionFingerprint(draft), transactionFingerprint({ ...draft, description: "  MERCÁDO   DE TESTE  " }));
  assert.notEqual(transactionFingerprint({ ...draft, installmentCurrent: 1, installmentTotal: 2 }), transactionFingerprint({ ...draft, installmentCurrent: 2, installmentTotal: 2 }));
  assert.throws(() => validateImport({ items: [item({ installmentCurrent: 3, installmentTotal: 2 })] }), ApiError);
});
