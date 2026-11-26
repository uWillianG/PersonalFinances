import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryComparison, merchantKey, merchantReport, selectReportTransactions } from "../lib/analytics.ts";
import type { Transaction } from "../lib/types.ts";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "purchase", ownerId: "me", ownerName: "Pessoa", sourceId: "bank", date: "2027-01-10",
    description: "Loja Coração", amountCents: 10_000, kind: "expense", category: "Compras",
    shared: false, installmentCurrent: null, installmentTotal: null, needsReview: false,
    note: "", importId: null, fingerprint: "purchase", ...overrides,
  };
}

test("report scopes isolate private purchases and deduplicate the couple's shared ledger by ID", () => {
  const own = [transaction({ id: "private" }), transaction({ id: "shared", shared: true })];
  const partner = [
    transaction({ id: "partner-private", ownerId: "partner" }),
    transaction({ id: "partner-shared", ownerId: "partner", shared: true }),
    own[1],
  ];
  assert.deepEqual(selectReportTransactions(own, partner, "mine").map((item) => item.id), ["private", "shared"]);
  assert.deepEqual(selectReportTransactions(own, partner, "personal").map((item) => item.id), ["private"]);
  assert.deepEqual(selectReportTransactions(own, partner, "couple").map((item) => item.id), ["shared", "partner-shared"]);
  assert.equal(selectReportTransactions([own[0], own[0]], [], "mine").length, 1);
});

test("merchant keys remove clear bank and installment metadata while retaining branch identity", () => {
  assert.equal(merchantKey("  COMPRA NO DÉBITO - Loja Coração 023 - PARCELA 02/06 "), "loja coracao 023");
  assert.equal(merchantKey("Compra com cartão de crédito: LOJA CORAÇÃO 023 3/6"), "loja coracao 023");
  assert.equal(merchantKey("Loja Coração 023 parc. 2 de 6"), "loja coracao 023");
  assert.notEqual(merchantKey("Loja 023"), merchantKey("Loja 024"));
  assert.equal(merchantKey("Restaurante 24/7"), "restaurante 24/7");
  assert.equal(merchantKey("Compra CartãoPresente"), "compra cartaopresente");
  assert.notEqual(merchantKey("A&B"), merchantKey("AB"));
});

test("Pix counterparty names stay distinct and refunds alone strip the estorno prefix", () => {
  assert.equal(merchantKey("Pix enviado - João da Silva"), "joao da silva");
  assert.notEqual(merchantKey("Pix enviado - João da Silva"), merchantKey("Pix enviado - Maria da Silva"));
  assert.notEqual(merchantKey("Pix enviado"), merchantKey("Pix recebido"));
  assert.equal(merchantKey("Estorno da Loja Coração 023", "refund"), "loja coracao 023");
  assert.equal(merchantKey("Estorno da Loja Coração 023", "expense"), "estorno da loja coracao 023");
});

test("merchant report nets refunds, excludes financing movements, and compares January to December", () => {
  const transactions = [
    transaction({ id: "dec", date: "2026-12-31", amountCents: 8_000 }),
    transaction({ id: "purchase-a", description: "COMPRA NO DÉBITO - Loja Coração", amountCents: 10_000 }),
    transaction({ id: "purchase-b", date: "2027-01-12", description: "LOJA CORACAO parcela 1/3", amountCents: 4_000 }),
    transaction({ id: "refund", date: "2027-01-14", description: "Estorno da Loja Coração", kind: "refund", amountCents: 2_000 }),
    ...(["income", "transfer_in", "transfer_out", "card_payment"] as const).map((kind) => transaction({ id: kind, kind, amountCents: 999_999 })),
    transaction({ id: "feb", date: "2027-02-01", amountCents: 999_999 }),
  ];
  const original = structuredClone(transactions);
  const [row] = merchantReport(transactions, "2027-01");
  assert.equal(merchantReport(transactions, "2027-01").length, 1);
  assert.equal(row.name, "Loja Coração");
  assert.equal(row.expenseCents, 14_000);
  assert.equal(row.refundCents, 2_000);
  assert.equal(row.netCents, 12_000);
  assert.equal(row.count, 2);
  assert.equal(row.averageCents, 6_000);
  assert.equal(row.lastDate, "2027-01-14");
  assert.equal(row.previousCents, 8_000);
  assert.equal(row.changePercent, 50);
  assert.deepEqual(row.transactions.map((item) => item.id), ["refund", "purchase-b", "purchase-a"]);
  assert.deepEqual(transactions, original);
});

test("merchant refund-only and new merchants have finite averages and no fabricated percentage", () => {
  const rows = merchantReport([
    transaction({ id: "refund", kind: "refund", description: "Estorno da Loja Coração", amountCents: 2_000 }),
    transaction({ id: "new", description: "Nova Loja", amountCents: 5_000 }),
    transaction({ id: "old-only", date: "2026-12-05", description: "Loja antiga" }),
  ], "2027-01");
  assert.deepEqual(rows.map((row) => row.key), ["nova loja", "loja coracao"]);
  assert.equal(rows[1].netCents, -2_000);
  assert.equal(rows[1].count, 0);
  assert.equal(rows[1].averageCents, 0);
  assert.ok(rows.every((row) => row.changePercent === null));
});

test("merchant filters affect both months and sorting reflects visits, averages, and names", () => {
  const transactions = [
    transaction({ id: "a", description: "Água", category: "Saúde", amountCents: 3_000 }),
    transaction({ id: "b", description: "Água", category: "SAUDE", amountCents: 3_000 }),
    transaction({ id: "c", description: "Bazar", category: "Compras", amountCents: 10_000 }),
    transaction({ id: "d", description: "Água", category: "Saúde", date: "2026-12-05", amountCents: 4_000 }),
    transaction({ id: "e", description: "Água", category: "Compras", date: "2026-12-05", amountCents: 99_000 }),
  ];
  const filtered = merchantReport(transactions, "2027-01", { search: "AGUA", category: " saÚde " });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].netCents, 6_000);
  assert.equal(filtered[0].previousCents, 4_000);
  assert.deepEqual(merchantReport(transactions, "2027-01", { sort: "spent" }).map((row) => row.key), ["bazar", "agua"]);
  assert.deepEqual(merchantReport(transactions, "2027-01", { sort: "visits" }).map((row) => row.key), ["agua", "bazar"]);
  assert.deepEqual(merchantReport(transactions, "2027-01", { sort: "average" }).map((row) => row.key), ["bazar", "agua"]);
  assert.deepEqual(merchantReport(transactions, "2027-01", { sort: "name" }).map((row) => row.key), ["agua", "bazar"]);
  assert.deepEqual(merchantReport(transactions, "2027-01", { search: "não existe" }), []);
});

test("category comparisons merge category spelling, retain refund-only negatives and departed categories", () => {
  const rows = categoryComparison([
    transaction({ id: "current", category: " Saúde ", amountCents: 3_000 }),
    transaction({ id: "current-refund", category: "SAUDE", kind: "refund", amountCents: 1_000 }),
    transaction({ id: "previous", date: "2026-12-31", category: "saúde", amountCents: 4_000 }),
    transaction({ id: "departed", date: "2026-12-01", category: "Mercado", amountCents: 2_000 }),
    transaction({ id: "refund-only", category: "Compras", kind: "refund", amountCents: 500 }),
    transaction({ id: "card", category: "Saúde", kind: "card_payment", amountCents: 999_999 }),
    transaction({ id: "future", date: "2027-02-01", category: "Saúde", amountCents: 999_999 }),
  ], "2027-01");
  assert.deepEqual(rows, [
    { category: "Saúde", currentCents: 2_000, previousCents: 4_000, differenceCents: -2_000, changePercent: -50 },
    { category: "Mercado", currentCents: 0, previousCents: 2_000, differenceCents: -2_000, changePercent: -100 },
    { category: "Compras", currentCents: -500, previousCents: 0, differenceCents: -500, changePercent: null },
  ]);
});

test("comparison against a prior refund reports direction without dividing by zero or a negative base", () => {
  const [row] = categoryComparison([
    transaction({ id: "previous", date: "2026-12-01", kind: "refund", amountCents: 2_000 }),
    transaction({ id: "current", amountCents: 1_000 }),
  ], "2027-01");
  assert.equal(row.changePercent, 150);
  assert.deepEqual(categoryComparison([], "2027-01"), []);
  assert.throws(() => merchantReport([], "2027-13"), RangeError);
  assert.throws(() => categoryComparison([], "January"), RangeError);
});
