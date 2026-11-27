import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeMutationResult,
  readApiJson,
  readAppState,
} from "../lib/client-state.ts";
import type { AppState, Transaction } from "../lib/types.ts";

function state(): AppState {
  return {
    user: { id: "alice", name: "Alice", email: "a@example.invalid" },
    sources: [
      {
        id: "bank",
        ownerId: "alice",
        name: "Conta",
        institution: "Teste",
        type: "bank",
        initialBalanceCents: 100000,
        balanceDate: "2026-11-01",
        hasOpeningBalance: true,
      },
    ],
    transactions: [],
    partnerTransactions: [],
    imports: [],
    couple: null,
  };
}
function transaction(id = "payment"): Transaction {
  return {
    id,
    ownerId: "alice",
    ownerName: "Alice",
    sourceId: "bank",
    date: "2026-11-10",
    description: "Fatura",
    amountCents: 10000,
    kind: "card_payment",
    category: "Fatura",
    shared: false,
    installmentCurrent: null,
    installmentTotal: null,
    needsReview: false,
    note: "",
    importId: "batch",
    fingerprint: id,
  };
}
test("resposta confirmada de conta ou lançamento atualiza a memória sem depender de um GET seguinte", () => {
  const before = state(),
    source = { ...before.sources[0], name: "Conta renomeada" };
  const after = mergeMutationResult(before, "/api/sources/bank", "PATCH", {
    source,
  });
  assert.equal(after.sources[0].name, "Conta renomeada");
  assert.equal(before.sources[0].name, "Conta");
  const changed = mergeMutationResult(
    { ...after, transactions: [transaction()] },
    "/api/transactions/payment",
    "PATCH",
    { transaction: { ...transaction(), amountCents: 12000 } },
  );
  assert.equal(changed.transactions.length, 1);
  assert.equal(changed.transactions[0].amountCents, 12000);
});
test("orçamentos confirmados ou copiados preservam IDs e não se duplicam em respostas repetidas", () => {
  const budget = {
    id: "budget",
    ownerId: "alice",
    ownerName: "Alice",
    scope: "personal" as const,
    month: "2026-11",
    category: "Moradia",
    limitCents: 50000,
    canEdit: true,
  };
  const copied = { ...budget, id: "copy", month: "2026-12" };
  let after = mergeMutationResult(state(), "/api/budgets", "POST", { budget });
  after = mergeMutationResult(after, "/api/budgets/copy", "POST", {
    copied: 1,
    skipped: 0,
    budgets: [copied],
  });
  after = mergeMutationResult(after, "/api/budgets/copy", "POST", {
    copied: 0,
    skipped: 1,
    budgets: [copied],
  });
  assert.deepEqual(
    after.budgets?.map((row) => row.id),
    ["budget", "copy"],
  );
  assert.equal(
    mergeMutationResult(after, "/api/budgets/budget", "DELETE", {
      deleted: true,
    }).budgets?.length,
    1,
  );
});
test("importação confirmada incorpora IDs reais, lote e saldo aceito antes da atualização geral", () => {
  const before = state(),
    source = {
      ...before.sources[0],
      initialBalanceCents: 200000,
      balanceVersion: "applied",
    };
  const batch = {
    id: "batch",
    createdAt: "2026-11-10T12:00:00Z",
    files: ["extrato.csv"],
    count: 1,
    incomeCents: 0,
    expenseCents: 0,
    periodStart: "2026-11-10",
    periodEnd: "2026-11-10",
    balanceTracking: true,
  };
  const result = { batch, transactions: [transaction()], sources: [source] };
  const after = mergeMutationResult(
    mergeMutationResult(before, "/api/imports", "POST", result),
    "/api/imports",
    "POST",
    result,
  );
  assert.equal(after.transactions.length, 1);
  assert.equal(after.imports.length, 1);
  assert.equal(after.transactions[0].id, "payment");
  assert.equal(after.sources[0].initialBalanceCents, 200000);
  assert.equal(before.transactions.length, 0);
});
test("desfazer aplica saldo confirmado e remove vínculos do lote sem apagar compromissos ou outros arquivos", () => {
  const before = state();
  before.transactions = [
    transaction(),
    { ...transaction("other"), importId: "other-batch" },
  ];
  before.invoicePayments = [
    {
      id: "link",
      invoiceId: "invoice",
      transactionId: "payment",
      amountCents: 10000,
    },
  ];
  before.occurrences = [
    {
      id: "occurrence",
      scheduleId: "schedule",
      dueDate: "2026-11-10",
      state: "linked",
      transactionId: "payment",
      confirmedBy: "alice",
    },
  ];
  const restored = { ...before.sources[0], initialBalanceCents: 50000 };
  const after = mergeMutationResult(before, "/api/imports/batch", "DELETE", {
    deleted: 1,
    sources: [restored],
  });
  assert.equal(after.sources[0].initialBalanceCents, 50000);
  assert.deepEqual(
    after.transactions.map((tx) => tx.id),
    ["other"],
  );
  assert.equal(after.invoicePayments?.length, 0);
  assert.equal(after.occurrences?.[0].transactionId, null);
  assert.equal(after.occurrences?.length, 1);
  assert.equal(before.occurrences[0].transactionId, "payment");
});
test("remoção de recorrência e reset de vencimento mantêm a coerência dos marcadores locais", () => {
  const before = state();
  before.occurrences = [
    {
      id: "occ",
      scheduleId: "schedule",
      dueDate: "2026-11-10",
      state: "confirmed",
      transactionId: null,
      confirmedBy: "alice",
    },
  ];
  const reset = mergeMutationResult(
    before,
    "/api/schedules/schedule/occurrences",
    "POST",
    {},
    { action: "reset", dueDate: "2026-11-10" },
  );
  assert.equal(reset.occurrences?.length, 0);
  assert.equal(
    mergeMutationResult(before, "/api/schedules/schedule", "DELETE", {})
      .occurrences?.length,
    0,
  );
});
test("encerrar casal remove imediatamente o conteúdo conjunto e mantém o histórico próprio privado", () => {
  const before = state();
  before.couple = {
    id: "couple",
    members: [
      { id: "alice", name: "Alice" },
      { id: "bea", name: "Bea" },
    ],
  };
  before.transactions = [{ ...transaction(), shared: true }];
  before.partnerTransactions = [
    { ...transaction("partner"), ownerId: "bea", shared: true },
  ];
  before.goals = [
    {
      id: "private",
      ownerId: "alice",
      ownerName: "Alice",
      scope: "personal",
      name: "Minha reserva",
      targetCents: 100000,
      targetDate: null,
      archived: false,
      canEdit: true,
    },
    {
      id: "shared",
      ownerId: "alice",
      ownerName: "Alice",
      scope: "couple",
      name: "Viagem",
      targetCents: 100000,
      targetDate: null,
      archived: false,
      canEdit: true,
    },
  ];
  const after = mergeMutationResult(
    before,
    "/api/couple",
    "POST",
    {},
    { action: "leave" },
  );
  assert.equal(after.couple, null);
  assert.equal(after.partnerTransactions.length, 0);
  assert.equal(after.transactions[0].shared, false);
  assert.deepEqual(
    after.goals?.map((goal) => goal.id),
    ["private"],
  );
  assert.equal(before.transactions[0].shared, true);
});

test("criar casal incorpora o vínculo confirmado sem inventar dados do parceiro", () => {
  const before = state();
  before.transactions = [transaction()];
  const couple = {
    id: "new-couple",
    members: [{ id: "alice", name: "Alice" }],
  };
  const after = mergeMutationResult(
    before,
    "/api/couple",
    "POST",
    { code: "ABCDEFGHJKLM", couple },
    { action: "create" },
  );
  assert.deepEqual(after.couple, couple);
  assert.deepEqual(after.partnerTransactions, []);
  assert.deepEqual(after.transactions, before.transactions);
  assert.equal(after.sources, before.sources);
  assert.equal(before.couple, null);
});

test("entrar em outro casal descarta apenas contexto conjunto antigo até receber os novos dados", () => {
  const before = state();
  before.couple = {
    id: "old-couple",
    members: [
      { id: "alice", name: "Alice" },
      { id: "bea", name: "Bea" },
    ],
  };
  before.transactions = [{ ...transaction(), shared: true }];
  before.partnerTransactions = [
    { ...transaction("old-peer"), ownerId: "bea", shared: true },
  ];
  before.budgets = ["personal", "couple"].map((scope) => ({
    id: `budget-${scope}`,
    ownerId: "alice",
    ownerName: "Alice",
    scope: scope as "personal" | "couple",
    month: "2026-11",
    category: "Moradia",
    limitCents: 10000,
    canEdit: true,
  }));
  before.schedules = ["personal", "couple"].map((scope) => ({
    id: `schedule-${scope}`,
    ownerId: "alice",
    ownerName: "Alice",
    scope: scope as "personal" | "couple",
    name: "Conta",
    kind: "expense",
    category: "Moradia",
    amountCents: 10000,
    frequency: "monthly",
    startDate: "2026-11-01",
    endDate: null,
    active: true,
    canEdit: true,
  }));
  before.occurrences = before.schedules.map((schedule) => ({
    id: `occurrence-${schedule.id}`,
    scheduleId: schedule.id,
    dueDate: "2026-11-01",
    state: "confirmed",
    transactionId: null,
    confirmedBy: "alice",
  }));
  before.goals = ["personal", "couple"].map((scope) => ({
    id: `goal-${scope}`,
    ownerId: "alice",
    ownerName: "Alice",
    scope: scope as "personal" | "couple",
    name: "Reserva",
    targetCents: 100000,
    targetDate: null,
    archived: false,
    canEdit: true,
  }));
  before.goalMovements = before.goals.map((goal) => ({
    id: `movement-${goal.id}`,
    goalId: goal.id,
    ownerId: "alice",
    ownerName: "Alice",
    kind: "deposit",
    amountCents: 10000,
    date: "2026-11-01",
    note: "",
    createdAt: "2026-11-01T00:00:00Z",
  }));
  const couple = {
    id: "new-couple",
    members: [
      { id: "carla", name: "Carla" },
      { id: "alice", name: "Alice" },
    ],
  };
  const after = mergeMutationResult(
    before,
    "/api/couple",
    "POST",
    { couple },
    { action: "join", code: "ABCDEFGHJKLM" },
  );
  assert.deepEqual(after.couple, couple);
  assert.deepEqual(after.partnerTransactions, []);
  assert.deepEqual(after.transactions, [
    { ...before.transactions[0], shared: false },
  ]);
  assert.equal(after.sources, before.sources);
  assert.equal(after.imports, before.imports);
  assert.deepEqual(after.budgets, [before.budgets[0]]);
  assert.deepEqual(after.schedules, [before.schedules[0]]);
  assert.deepEqual(after.occurrences, [before.occurrences[0]]);
  assert.deepEqual(after.goals, [before.goals[0]]);
  assert.deepEqual(after.goalMovements, [before.goalMovements[0]]);
  assert.equal(before.partnerTransactions.length, 1);
  assert.equal(before.transactions[0].shared, true);
});

test("renovar convite do mesmo casal mantém o conteúdo conjunto conhecido", () => {
  const before = state();
  before.couple = { id: "couple", members: [{ id: "alice", name: "Alice" }] };
  before.transactions = [{ ...transaction(), shared: true }];
  before.partnerTransactions = [
    { ...transaction("partner"), ownerId: "bea", shared: true },
  ];
  const couple = {
    ...before.couple,
    members: [...before.couple.members, { id: "bea", name: "Bea" }],
  };
  const after = mergeMutationResult(
    before,
    "/api/couple",
    "POST",
    { code: "ABCDEFGHJKLM", couple },
    { action: "create" },
  );
  assert.deepEqual(after.couple, couple);
  assert.equal(after.transactions, before.transactions);
  assert.equal(after.partnerTransactions, before.partnerTransactions);
});

test("respostas HTML ou erros em HTTP200 nunca são confirmação de escrita", () => {
  assert.throws(
    () => readApiJson("<html>Entrar</html>", true),
    /Não foi possível ler/,
  );
  assert.throws(
    () => readApiJson('{"error":"Sessão indisponível"}', true),
    /Sessão indisponível/,
  );
  assert.throws(
    () => readApiJson('{"error":"Servidor indisponível"}', false),
    /Servidor indisponível/,
  );
  assert.throws(
    () => readApiJson("[]", true),
    /resposta do servidor é inválida/,
  );
  assert.throws(
    () => readApiJson("null", true),
    /resposta do servidor é inválida/,
  );
  assert.deepEqual(readApiJson('{"deleted":true}', true), { deleted: true });
});
test("resposta de estado incompleta é rejeitada antes de substituir os dados conhecidos", () => {
  const before = state();
  assert.equal(readAppState(before), before);
  for (const invalid of [
    {},
    { error: "Não autenticado" },
    { ...before, user: { ...before.user, id: 7 } },
    { ...before, transactions: null },
    { ...before, sources: undefined },
    { ...before, couple: {} },
    { ...before, couple: { id: "ab", members: [null] } },
    { ...before, budgets: {} },
    { ...before, cardInvoices: null },
  ])
    assert.throws(
      () => readAppState(invalid),
      /resposta do servidor está incompleta/,
    );
  const optional = {
    ...before,
    budgets: [],
    cardCycles: [],
    cardInvoices: [],
    invoicePayments: [],
  };
  assert.equal(readAppState(optional), optional);
});
test("cópia substitui apenas o mês e escopo autoritativos e remove orçamento apagado no servidor", () => {
  const base = {
    ownerId: "alice",
    ownerName: "Alice",
    scope: "personal" as const,
    category: "Moradia",
    limitCents: 50000,
    canEdit: true,
  };
  const before = state();
  before.budgets = [
    { ...base, id: "past", month: "2026-11" },
    { ...base, id: "ghost", month: "2026-12" },
    { ...base, id: "couple", scope: "couple", month: "2026-12" },
  ];
  const returned = {
    ...base,
    id: "copied",
    category: "Lazer",
    month: "2026-12",
  };
  const body = { scope: "personal", fromMonth: "2026-11", toMonth: "2026-12" };
  const after = mergeMutationResult(
    before,
    "/api/budgets/copy",
    "POST",
    { copied: 1, skipped: 0, budgets: [returned] },
    body,
  );
  assert.deepEqual(
    after.budgets?.map((row) => row.id),
    ["past", "couple", "copied"],
  );
  assert.deepEqual(
    before.budgets.map((row) => row.id),
    ["past", "ghost", "couple"],
  );
  const empty = mergeMutationResult(
    after,
    "/api/budgets/copy",
    "POST",
    { copied: 0, skipped: 0, budgets: [] },
    body,
  );
  assert.deepEqual(
    empty.budgets?.map((row) => row.id),
    ["past", "couple"],
  );
});
