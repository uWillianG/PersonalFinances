import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balancesForMonth,
  categoryBreakdown,
  currentMonth,
  formatMoney,
  installmentForecast,
  missingInstallmentForecast,
  monthLabel,
  monthlySeries,
  summarize,
  transactionsForMonth,
} from "../lib/finance.ts";
import type { Source, Transaction } from "../lib/types.ts";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "bank",
    ownerId: "user",
    name: "Conta",
    institution: "Exemplo",
    type: "bank",
    initialBalanceCents: 100_000,
    balanceDate: "2026-11-01",
    hasOpeningBalance: true,
    ...overrides,
  };
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "transaction",
    ownerId: "user",
    ownerName: "Pessoa",
    sourceId: "bank",
    date: "2026-11-10",
    description: "Mercado exemplo",
    amountCents: 10_000,
    kind: "expense",
    category: "Mercado",
    shared: false,
    installmentCurrent: null,
    installmentTotal: null,
    needsReview: false,
    note: "",
    importId: null,
    fingerprint: "example",
    ...overrides,
  };
}

test("transfers affect account balances without inflating income or spending", () => {
  const transactions = [
    transaction({ kind: "transfer_out", amountCents: 30_000 }),
    transaction({
      sourceId: "second",
      kind: "transfer_in",
      amountCents: 30_000,
    }),
  ];
  assert.deepEqual(summarize(transactions, "2026-11"), {
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    count: 2,
    pendingCount: 0,
  });
  const balances = balancesForMonth(
    [source(), source({ id: "second", initialBalanceCents: 0 })],
    transactions,
    "2026-11",
  );
  assert.deepEqual(
    balances.items.map((item) => item.balanceCents),
    [70_000, 30_000],
  );
  assert.equal(balances.totalCents, 100_000);
});

test("credit purchases are spending immediately and reduce bank balance only when the bill is paid", () => {
  const sources = [
    source(),
    source({ id: "card", type: "credit", initialBalanceCents: 900_000 }),
  ];
  const purchase = transaction({
    sourceId: "card",
    amountCents: 20_000,
    shared: true,
  });
  assert.equal(summarize([purchase], "2026-11").expenseCents, 20_000);
  assert.equal(
    balancesForMonth(sources, [purchase], "2026-11").totalCents,
    100_000,
  );
  const withPayment = [
    purchase,
    transaction({ kind: "card_payment", amountCents: 20_000 }),
  ];
  assert.equal(summarize(withPayment, "2026-11").expenseCents, 20_000);
  const balances = balancesForMonth(sources, withPayment, "2026-11");
  assert.equal(balances.totalCents, 80_000);
  assert.equal(balances.items.length, 1);
});

test("benefit reloads and purchases participate in unified income, spending and balances", () => {
  const sources = [
    source(),
    source({ id: "va", type: "benefit", initialBalanceCents: 5_000 }),
  ];
  const transactions = [
    transaction({ kind: "income", amountCents: 400_000, category: "Salário" }),
    transaction({
      sourceId: "va",
      kind: "income",
      amountCents: 80_000,
      category: "Benefícios",
    }),
    transaction({ sourceId: "va", amountCents: 12_500, needsReview: true }),
  ];
  assert.deepEqual(summarize(transactions, "2026-11"), {
    incomeCents: 480_000,
    expenseCents: 12_500,
    netCents: 467_500,
    count: 3,
    pendingCount: 1,
  });
  const balances = balancesForMonth(sources, transactions, "2026-11");
  assert.equal(balances.totalCents, 572_500);
  assert.equal(balances.items[1].balanceCents, 72_500);
  assert.equal(balances.complete, true);
});

test("opening balances include movements on their date and exclude earlier and later months", () => {
  const sources = [source({ balanceDate: "2026-11-15" })];
  const transactions = [
    transaction({ date: "2026-11-14", amountCents: 99_000 }),
    transaction({ date: "2026-11-15", amountCents: 10_000 }),
    transaction({ date: "2026-11-30", kind: "income", amountCents: 2_000 }),
    transaction({ date: "2026-12-01", amountCents: 20_000 }),
  ];
  assert.equal(
    balancesForMonth(sources, transactions, "2026-11").totalCents,
    92_000,
  );
  assert.equal(
    balancesForMonth(sources, transactions, "2026-12").totalCents,
    72_000,
  );
  assert.deepEqual(balancesForMonth(sources, transactions, "2026-10"), {
    totalCents: 0,
    items: [{ source: sources[0], balanceCents: 0, complete: false }],
    complete: false,
  });
});

test("unknown opening balances remain explicitly incomplete while retaining partial movements", () => {
  const sources = [
    source({ hasOpeningBalance: false, initialBalanceCents: 999_999 }),
  ];
  const balances = balancesForMonth(
    sources,
    [transaction({ kind: "income", amountCents: 40_000 })],
    "2026-11",
  );
  assert.equal(balances.totalCents, 40_000);
  assert.equal(balances.items[0].complete, false);
  assert.equal(balances.complete, false);
  assert.equal(balancesForMonth([], [], "2026-11").complete, false);
});

test("a closing balance referenced at next month's first day is available at the month cutoff", () => {
  const sources = [
    source({ initialBalanceCents: 80_000, balanceDate: "2026-12-01" }),
  ];
  const transactions = [
    transaction({ date: "2026-11-30", amountCents: 25_000 }),
    transaction({ date: "2026-12-01", kind: "income", amountCents: 10_000 }),
  ];
  const november = balancesForMonth(sources, transactions, "2026-11");
  assert.equal(november.totalCents, 80_000);
  assert.equal(november.complete, true);
  assert.equal(
    balancesForMonth(sources, transactions, "2026-12").totalCents,
    90_000,
  );
  assert.equal(
    balancesForMonth(sources, transactions, "2026-10").complete,
    false,
  );
  assert.equal(
    balancesForMonth(sources, transactions, "2026-10").totalCents,
    0,
  );
});

test("refunds reduce net spending and category totals while crediting cash balances", () => {
  const transactions = [
    transaction({ amountCents: 12_000 }),
    transaction({ kind: "refund", amountCents: 2_000 }),
    transaction({ category: "Transporte", amountCents: 4_000 }),
    transaction({ category: "Compras", kind: "refund", amountCents: 5_000 }),
    transaction({ category: "Salário", kind: "income", amountCents: 50_000 }),
  ];
  assert.equal(summarize(transactions, "2026-11").expenseCents, 9_000);
  assert.deepEqual(categoryBreakdown(transactions, "2026-11"), [
    { category: "Mercado", amountCents: 10_000, count: 2 },
    { category: "Transporte", amountCents: 4_000, count: 1 },
    { category: "Compras", amountCents: -5_000, count: 1 },
  ]);
  assert.equal(
    balancesForMonth([source()], transactions, "2026-11").totalCents,
    141_000,
  );
});

test("month filtering uses the recorded calendar date and never mutates the original transactions", () => {
  const transactions = [
    transaction({ date: "2026-10-31", amountCents: 1 }),
    transaction({ date: "2026-11-01", amountCents: 2 }),
    transaction({ date: "2026-11-30", amountCents: 3 }),
    transaction({ date: "2026-12-01", amountCents: 4 }),
  ];
  const original = structuredClone(transactions);
  assert.deepEqual(
    transactionsForMonth(transactions, "2026-11").map(
      (item) => item.amountCents,
    ),
    [2, 3],
  );
  assert.equal(summarize(transactions, "2026-11").expenseCents, 5);
  assert.deepEqual(transactions, original);
});

test("series retains empty months and advances across December without date or DST arithmetic", () => {
  const transactions = [
    transaction({ date: "2026-12-31", amountCents: 12_345 }),
    transaction({ date: "2027-01-01", kind: "income", amountCents: 45_678 }),
  ];
  assert.deepEqual(monthlySeries(transactions, "2027-02", 3), [
    { month: "2026-12", incomeCents: 0, expenseCents: 12_345 },
    { month: "2027-01", incomeCents: 45_678, expenseCents: 0 },
    { month: "2027-02", incomeCents: 0, expenseCents: 0 },
  ]);
  assert.equal(monthlySeries(transactions, "2027-02").length, 6);
});

test("installment forecasts show only each month's installment, deduplicating imported schedule rows", () => {
  const transactions = [
    transaction({
      sourceId: "card",
      date: "2026-12-10",
      description: "Loja Exemplo parcela 1/3",
      amountCents: 20_000,
      installmentCurrent: 1,
      installmentTotal: 3,
    }),
    transaction({
      sourceId: "card",
      date: "2027-01-10",
      description: "LOJA EXEMPLO - PARCELA 2/3",
      amountCents: 20_000,
      installmentCurrent: 2,
      installmentTotal: 3,
    }),
    transaction({
      sourceId: "card",
      date: "2027-02-10",
      description: "Loja Exemplo 03/03",
      amountCents: 20_000,
      installmentCurrent: 3,
      installmentTotal: 3,
    }),
  ];
  assert.equal(summarize(transactions, "2026-12").expenseCents, 20_000);
  assert.deepEqual(installmentForecast(transactions, "2026-12"), [
    { month: "2027-01", amountCents: 20_000 },
    { month: "2027-02", amountCents: 20_000 },
    { month: "2027-03", amountCents: 0 },
    { month: "2027-04", amountCents: 0 },
    { month: "2027-05", amountCents: 0 },
    { month: "2027-06", amountCents: 0 },
  ]);
});

test("installment groups distinguish purchase start month and source; paid final installments add no future expense", () => {
  const transactions = [
    transaction({
      date: "2026-11-10",
      description: "Loja 1/3",
      amountCents: 20_000,
      installmentCurrent: 1,
      installmentTotal: 3,
    }),
    transaction({
      date: "2026-12-10",
      description: "Loja 1/3",
      amountCents: 20_000,
      installmentCurrent: 1,
      installmentTotal: 3,
    }),
    transaction({
      date: "2026-12-10",
      sourceId: "another-card",
      description: "Loja 1/3",
      amountCents: 20_000,
      installmentCurrent: 1,
      installmentTotal: 3,
    }),
    transaction({
      date: "2026-12-10",
      description: "Compra final 3/3",
      amountCents: 90_000,
      installmentCurrent: 3,
      installmentTotal: 3,
    }),
    transaction({
      date: "2026-12-10",
      description: "À vista",
      amountCents: 80_000,
    }),
    transaction({
      date: "2026-12-10",
      kind: "card_payment",
      amountCents: 50_000,
    }),
  ];
  assert.deepEqual(
    installmentForecast(transactions, "2026-12").map(
      (item) => item.amountCents,
    ),
    [60_000, 40_000, 0, 0, 0, 0],
  );
});

test("two legitimate identical purchases retain their multiplicity across imported installments", () => {
  const transactions = [
    transaction({
      id: "purchase-a-dec",
      sourceId: "card",
      date: "2026-12-10",
      description: "Loja 2/4",
      amountCents: 15_000,
      installmentCurrent: 2,
      installmentTotal: 4,
    }),
    transaction({
      id: "purchase-b-dec",
      sourceId: "card",
      date: "2026-12-10",
      description: "Loja 2/4",
      amountCents: 15_000,
      installmentCurrent: 2,
      installmentTotal: 4,
    }),
    transaction({
      id: "purchase-a-jan",
      sourceId: "card",
      date: "2027-01-10",
      description: "Loja parcela 3/4",
      amountCents: 15_000,
      installmentCurrent: 3,
      installmentTotal: 4,
    }),
  ];
  assert.deepEqual(
    installmentForecast(transactions, "2026-12").map(
      (item) => item.amountCents,
    ),
    [30_000, 30_000, 0, 0, 0, 0],
  );
});

test("missing installments are matched before changed category and sharing are attributed", () => {
  const first = transaction({
    id: "oct",
    sourceId: "card",
    date: "2026-10-10",
    description: "Notebook 1/4",
    installmentCurrent: 1,
    installmentTotal: 4,
    category: "Compras",
  });
  const second = transaction({
    ...first,
    id: "nov",
    date: "2026-11-10",
    description: "Notebook 2/4",
    installmentCurrent: 2,
    category: "Educação",
    shared: true,
  });
  assert.deepEqual(missingInstallmentForecast([first, second], "2026-11"), []);
  const december = missingInstallmentForecast([first, second], "2026-12");
  assert.equal(december.length, 1);
  assert.equal(december[0].transaction.id, "nov");
  assert.equal(december[0].amountCents, 10000);
  assert.equal(december[0].transaction.shared, true);
});

test("missing identical purchases retain the uninported copy after one installment is recorded", () => {
  const first = transaction({
    id: "a-oct",
    sourceId: "card",
    date: "2026-10-10",
    description: "Loja 1/4",
    installmentCurrent: 1,
    installmentTotal: 4,
  });
  const another = { ...first, id: "b-oct" };
  const current = {
    ...first,
    id: "a-nov",
    date: "2026-11-10",
    description: "Loja 2/4",
    installmentCurrent: 2,
    category: "Compras",
  };
  const missing = missingInstallmentForecast(
    [first, another, current],
    "2026-11",
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].quantity, 1);
  assert.equal(missing[0].amountCents, 10000);
});

test("formatting uses Brazilian currency, month labels, and São Paulo's date at a UTC month boundary", (context) => {
  assert.equal(formatMoney(123_456).replace(/\s/g, " "), "R$ 1.234,56");
  assert.equal(formatMoney(-123).replace(/\s/g, " "), "-R$ 1,23");
  assert.equal(monthLabel("2026-11"), "novembro de 2026");
  assert.match(monthLabel("2026-11", true), /nov.*2026/);
  context.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-12-01T01:30:00Z"),
  });
  assert.equal(currentMonth(), "2026-11");
  context.mock.timers.setTime(new Date("2026-12-01T03:30:00Z").getTime());
  assert.equal(currentMonth(), "2026-12");
});
