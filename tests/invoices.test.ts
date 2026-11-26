import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateReserve } from "../lib/reserve-estimate.ts";
import { defaultReservePlan } from "../lib/reserve-types.ts";
import {
  invoiceDates,
  invoiceSummaries,
  invoiceProtection,
  paymentCandidates,
} from "../lib/invoices.ts";
import type { AppState, Transaction } from "../lib/types.ts";

function data(): AppState {
  return {
    user: { id: "alice", name: "Alice", email: "alice@example.invalid" },
    sources: [
      {
        id: "bank",
        ownerId: "alice",
        name: "Banco",
        institution: "Teste",
        type: "bank",
        initialBalanceCents: 100000,
        balanceDate: "2026-11-01",
        hasOpeningBalance: true,
      },
      ...["card1", "card2"].map((id) => ({
        id,
        ownerId: "alice",
        name: id,
        institution: "Teste",
        type: "credit" as const,
        initialBalanceCents: 0,
        balanceDate: "2026-11-01",
        hasOpeningBalance: true,
      })),
      {
        id: "benefit",
        ownerId: "alice",
        name: "Vale",
        institution: "Teste",
        type: "benefit",
        initialBalanceCents: 0,
        balanceDate: "2026-11-01",
        hasOpeningBalance: true,
      },
    ],
    transactions: [],
    partnerTransactions: [],
    imports: [],
    couple: null,
    cardCycles: [{ sourceId: "card1", closingDay: 28, dueDay: 5 }],
    cardInvoices: [
      {
        id: "inv1",
        sourceId: "card1",
        month: "2026-11",
        confirmedTotalCents: null,
      },
      {
        id: "inv2",
        sourceId: "card2",
        month: "2026-11",
        confirmedTotalCents: 20000,
      },
    ],
    invoicePayments: [],
  };
}
function tx(
  id: string,
  sourceId: string,
  kind: Transaction["kind"],
  amountCents: number,
  date = "2026-11-01",
  extra: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    sourceId,
    kind,
    amountCents,
    date,
    ownerId: "alice",
    ownerName: "Alice",
    description: id,
    category: "Outros",
    shared: false,
    installmentCurrent: null,
    installmentTotal: null,
    needsReview: false,
    note: "",
    importId: null,
    fingerprint: id,
    ...extra,
  };
}
test("datas previstas preservam competência, fecham no mês anterior e ajustam fevereiro", () => {
  assert.deepEqual(
    invoiceDates("2026-01", { sourceId: "x", closingDay: 28, dueDay: 5 }),
    { closingDate: "2025-12-28", dueDate: "2026-01-05" },
  );
  assert.deepEqual(
    invoiceDates("2028-02", { sourceId: "x", closingDay: 20, dueDay: 31 }),
    { closingDate: "2028-02-20", dueDate: "2028-02-29" },
  );
  assert.deepEqual(
    invoiceDates("2027-03", { sourceId: "x", closingDay: 31, dueDay: 5 }),
    { closingDate: "2027-02-28", dueDate: "2027-03-05" },
  );
  assert.deepEqual(invoiceDates("2026-11"), {
    closingDate: null,
    dueDate: null,
  });
  assert.throws(() => invoiceDates("2026-13"), /inválido/);
});
test("compras e estornos formam a fatura; pagamentos recebidos no cartão não são compras", () => {
  const state = data();
  state.transactions = [
    tx("purchase", "card1", "expense", 10000),
    tx("refund", "card1", "refund", 2000),
    tx("payment-received", "card1", "card_payment", 8000),
    tx("other-month", "card1", "expense", 40000, "2026-10-01"),
  ];
  const result = invoiceSummaries(state, "2026-11", "2026-11-26")[0];
  assert.equal(result.totalCents, 8000);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.status, "unverified");
  assert.equal(result.paidCents, 0);
});
test("conferir total ajusta a obrigação sem criar consumo, inclusive fatura zerada", () => {
  const state = data();
  state.transactions = [tx("purchase", "card1", "expense", 10000)];
  state.cardInvoices![0].confirmedTotalCents = 12500;
  const before = JSON.stringify(state.transactions),
    result = invoiceSummaries(state, "2026-11")[0];
  assert.equal(result.totalCents, 12500);
  assert.equal(result.computedTotalCents, 10000);
  assert.equal(result.status, "open");
  assert.equal(JSON.stringify(state.transactions), before);
  state.cardInvoices![0].confirmedTotalCents = 0;
  assert.equal(invoiceSummaries(state, "2026-11")[0].status, "paid");
});
test("pagamento parcial vinculado reduz saldo e pagamentos sem vínculo não quitam automaticamente", () => {
  const state = data();
  state.transactions = [
    tx("purchase", "card1", "expense", 10000),
    tx("payment", "bank", "card_payment", 10000),
  ];
  state.cardInvoices![0].confirmedTotalCents = 10000;
  assert.equal(invoiceSummaries(state, "2026-11")[0].remainingCents, 10000);
  state.invoicePayments = [
    {
      id: "link",
      invoiceId: "inv1",
      transactionId: "payment",
      amountCents: 4000,
    },
  ];
  const result = invoiceSummaries(state, "2026-11")[0];
  assert.equal(result.remainingCents, 6000);
  assert.equal(result.status, "partial");
  assert.equal(result.payments[0].transaction.id, "payment");
  state.invoicePayments[0].amountCents = 10000;
  assert.equal(invoiceSummaries(state, "2026-11")[0].status, "paid");
});
test("um pagamento pode ser dividido entre cartões sem disponibilizar a parcela já usada", () => {
  const state = data();
  state.transactions = [tx("payment", "bank", "card_payment", 30000)];
  state.invoicePayments = [
    {
      id: "a",
      invoiceId: "inv1",
      transactionId: "payment",
      amountCents: 10000,
    },
    {
      id: "b",
      invoiceId: "inv2",
      transactionId: "payment",
      amountCents: 15000,
    },
  ];
  const first = paymentCandidates(state, {
    sourceId: "card1",
    month: "2026-11",
  })[0];
  assert.equal(first.availableCents, 5000);
  assert.equal(first.currentAllocationCents, 10000);
  assert.equal(first.allocatedCents, 25000);
  const other = paymentCandidates(state, {
    sourceId: "card1",
    month: "2026-12",
  })[0];
  assert.equal(other.currentAllocationCents, 0);
  assert.equal(other.availableCents, 5000);
});
test("vínculos inválidos ou acima do valor bancário não fazem uma fatura parecer paga", () => {
  const state = data();
  state.transactions = [tx("payment", "bank", "card_payment", 10000)];
  state.invoicePayments = [
    { id: "a", invoiceId: "inv1", transactionId: "payment", amountCents: 8000 },
    { id: "b", invoiceId: "inv2", transactionId: "payment", amountCents: 8000 },
  ];
  assert.equal(invoiceSummaries(state, "2026-11")[0].paidCents, 0);
  state.invoicePayments = [
    { id: "a", invoiceId: "inv1", transactionId: "payment", amountCents: 8000 },
  ];
  state.transactions[0].kind = "expense";
  assert.equal(invoiceSummaries(state, "2026-11")[0].paidCents, 0);
  assert.equal(
    paymentCandidates(state, { sourceId: "card1", month: "2026-11" }).length,
    0,
  );
});
test("somente pagamentos bancários próprios já realizados podem ser vinculados", () => {
  const state = data();
  state.transactions = [
    tx("future", "bank", "card_payment", 10000, "2026-12-01"),
    tx("benefit", "benefit", "card_payment", 10000),
    tx("card", "card1", "card_payment", 10000),
    tx("foreign", "bank", "card_payment", 10000, "2026-11-01", {
      ownerId: "bea",
    }),
  ];
  assert.deepEqual(
    paymentCandidates(
      state,
      { sourceId: "card1", month: "2026-11" },
      "2026-11-26",
    ),
    [],
  );
});
test("pagamento de dezembro quita fatura de novembro e só aparece como pago a partir de dezembro", () => {
  const state = data();
  state.cardInvoices![0].confirmedTotalCents = 10000;
  state.transactions = [
    tx("purchase", "card1", "expense", 10000),
    tx("payment", "bank", "card_payment", 10000, "2026-12-03"),
  ];
  state.invoicePayments = [
    {
      id: "a",
      invoiceId: "inv1",
      transactionId: "payment",
      amountCents: 10000,
    },
  ];
  assert.equal(
    invoiceSummaries(state, "2026-11", "2026-11-30")[0].remainingCents,
    10000,
  );
  assert.equal(
    invoiceSummaries(state, "2026-11", "2026-12-03")[0].remainingCents,
    0,
  );
});
test("proteção de caixa inclui faturas anteriores pendentes sem descontar pagamentos por coincidência de mês", () => {
  const state = data();
  state.cardInvoices = [];
  state.transactions = [
    tx("old", "card1", "expense", 10000, "2026-10-20"),
    tx("current", "card1", "expense", 5000),
    tx("payment", "bank", "card_payment", 10000),
  ];
  const result = invoiceProtection(state, "2026-11", "2026-11-26");
  assert.equal(result.pendingCents, 15000);
  assert.equal(result.unallocatedPaymentCents, 10000);
  assert.equal(result.unverifiedCount, 2);
});
test("registros do parceiro e pagamentos removidos não alteram faturas pessoais", () => {
  const state = data();
  state.sources.push({
    ...state.sources[1],
    id: "foreign-card",
    ownerId: "bea",
  });
  state.transactions = [
    tx("shared", "card1", "expense", 5000, "2026-11-01", { shared: true }),
    tx("foreign", "foreign-card", "expense", 999999, "2026-11-01", {
      ownerId: "bea",
    }),
  ];
  state.partnerTransactions = [
    tx("partner", "foreign-card", "expense", 999999, "2026-11-01", {
      ownerId: "bea",
      shared: true,
    }),
  ];
  state.invoicePayments = [
    {
      id: "missing",
      invoiceId: "inv1",
      transactionId: "deleted",
      amountCents: 5000,
    },
  ];
  const rows = invoiceSummaries(state, "2026-11");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].totalCents, 5000);
  assert.equal(rows[0].paidCents, 0);
});
test("créditos e excedentes não geram saldo pendente negativo", () => {
  const state = data();
  state.cardInvoices![0].confirmedTotalCents = 1000;
  state.transactions = [tx("payment", "bank", "card_payment", 1500)];
  state.invoicePayments = [
    { id: "a", invoiceId: "inv1", transactionId: "payment", amountCents: 1500 },
  ];
  const paid = invoiceSummaries(state, "2026-11")[0];
  assert.equal(paid.remainingCents, 0);
  assert.equal(paid.creditCents, 500);
  state.invoicePayments = [];
  state.cardInvoices![0].confirmedTotalCents = null;
  state.transactions = [tx("refund", "card1", "refund", 500)];
  const credit = invoiceSummaries(state, "2026-11")[0];
  assert.equal(credit.totalCents, 0);
  assert.equal(credit.creditCents, 500);
});

test("um estorno parcial importado não inventa crédito quando o total real já foi conferido", () => {
  const state = data();
  state.transactions = [tx("refund", "card1", "refund", 1000)];
  for (const total of [5000, 0]) {
    state.cardInvoices![0].confirmedTotalCents = total;
    const result = invoiceSummaries(state, "2026-11")[0];
    assert.equal(result.creditCents, 0);
    assert.equal(result.remainingCents, total);
  }
});
test("vincular a quitação libera somente a proteção de caixa, sem descontar novamente o consumo", () => {
  const state = data();
  state.cardInvoices = state.cardInvoices!.slice(0, 1);
  state.cardInvoices[0].confirmedTotalCents = 30000;
  state.transactions = [
    tx("salary", "bank", "income", 100000),
    tx("purchase", "card1", "expense", 30000),
    tx("payment", "bank", "card_payment", 30000),
  ];
  const plan = {
    ...defaultReservePlan("2026-11"),
    minimumBalanceCents: 130000,
  };
  const before = estimateReserve(state, "2026-11", plan, "2026-11-26");
  assert.equal(before.expenseCents, 30000);
  assert.equal(before.cardReserveCents, 30000);
  assert.equal(before.suggestedCents, 10000);
  state.invoicePayments = [
    {
      id: "link",
      invoiceId: "inv1",
      transactionId: "payment",
      amountCents: 30000,
    },
  ];
  const after = estimateReserve(state, "2026-11", plan, "2026-11-26");
  assert.equal(after.expenseCents, 30000);
  assert.equal(after.bankBalanceCents, before.bankBalanceCents);
  assert.equal(after.monthlyMarginCents, before.monthlyMarginCents);
  assert.equal(after.cardReserveCents, 0);
  assert.equal(after.suggestedCents, 40000);
  state.invoicePayments = [];
  assert.equal(
    estimateReserve(state, "2026-11", plan, "2026-11-26").suggestedCents,
    10000,
  );
});
test("proteção de faturas anteriores não é liberada por um pagamento que ainda está no futuro", () => {
  const state = data();
  state.cardInvoices = state.cardInvoices!.slice(0, 1);
  state.cardInvoices[0].month = "2026-10";
  state.cardInvoices[0].confirmedTotalCents = 30000;
  state.transactions = [
    tx("salary", "bank", "income", 100000),
    tx("purchase", "card1", "expense", 30000, "2026-10-01"),
    tx("payment", "bank", "card_payment", 30000, "2026-11-27"),
  ];
  state.invoicePayments = [
    {
      id: "link",
      invoiceId: "inv1",
      transactionId: "payment",
      amountCents: 30000,
    },
  ];
  assert.equal(
    estimateReserve(
      state,
      "2026-11",
      defaultReservePlan("2026-11"),
      "2026-11-26",
    ).cardReserveCents,
    30000,
  );
});
