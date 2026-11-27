import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateReserve } from "../lib/reserve-estimate.ts";
import { defaultReservePlan } from "../lib/reserve-types.ts";
import type { AppState, Source, Transaction } from "../lib/types.ts";
import type {
  BudgetLimit,
  RecurringSchedule,
  ScheduleOccurrence,
} from "../lib/planning-types.ts";
import type { GoalMovement, SavingsGoal } from "../lib/goals-types.ts";

const month = "2026-11",
  today = "2026-11-26";
let sequence = 0;
function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "bank",
    ownerId: "me",
    name: "Conta",
    institution: "Teste",
    type: "bank",
    initialBalanceCents: 50_000,
    balanceDate: `${month}-01`,
    hasOpeningBalance: true,
    ...overrides,
  };
}
function transaction(
  kind: Transaction["kind"],
  amountCents: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: `tx-${sequence++}`,
    ownerId: "me",
    ownerName: "Você",
    sourceId: "bank",
    date: `${month}-05`,
    description: "Movimento",
    amountCents,
    kind,
    category: "Alimentação",
    shared: false,
    installmentCurrent: null,
    installmentTotal: null,
    needsReview: false,
    note: "",
    importId: null,
    fingerprint: "",
    ...overrides,
  };
}
function state(overrides: Partial<AppState> = {}): AppState {
  return {
    user: { id: "me", name: "Você", email: "me@example.invalid" },
    sources: [source()],
    transactions: [
      transaction("income", 100_000),
      transaction("expense", 20_000),
    ],
    partnerTransactions: [],
    imports: [],
    couple: null,
    ...overrides,
  };
}
function estimate(
  data: AppState,
  overrides: Partial<ReturnType<typeof defaultReservePlan>> = {},
  selectedMonth = month,
  date = today,
) {
  return estimateReserve(
    data,
    selectedMonth,
    { ...defaultReservePlan(selectedMonth), ...overrides },
    date,
  );
}
function budget(overrides: Partial<BudgetLimit> = {}): BudgetLimit {
  return {
    id: "budget",
    ownerId: "me",
    ownerName: "Você",
    scope: "personal",
    month,
    category: "Alimentação",
    limitCents: 30_000,
    canEdit: true,
    ...overrides,
  };
}
function schedule(
  overrides: Partial<RecurringSchedule> = {},
): RecurringSchedule {
  return {
    id: "schedule",
    ownerId: "me",
    ownerName: "Você",
    scope: "personal",
    name: "Conta",
    kind: "expense",
    category: "Alimentação",
    amountCents: 15_000,
    frequency: "monthly",
    startDate: `${month}-28`,
    endDate: null,
    active: true,
    canEdit: true,
    ...overrides,
  };
}
function occurrence(
  overrides: Partial<ScheduleOccurrence> = {},
): ScheduleOccurrence {
  return {
    id: "occurrence",
    scheduleId: "schedule",
    dueDate: `${month}-28`,
    state: "confirmed",
    transactionId: null,
    confirmedBy: "me",
    ...overrides,
  };
}
function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "goal",
    ownerId: "me",
    ownerName: "Você",
    scope: "personal",
    name: "Reserva",
    targetCents: 200_000,
    targetDate: null,
    archived: false,
    canEdit: true,
    ...overrides,
  };
}
function movement(
  amountCents: number,
  overrides: Partial<GoalMovement> = {},
): GoalMovement {
  return {
    id: `movement-${sequence++}`,
    goalId: "goal",
    ownerId: "me",
    ownerName: "Você",
    kind: "deposit",
    amountCents,
    date: `${month}-05`,
    note: "",
    createdAt: `${month}-05T12:00:00Z`,
    ...overrides,
  };
}
const couple = {
  id: "couple",
  members: [
    { id: "me", name: "Você" },
    { id: "partner", name: "Alex" },
  ],
};

test("estimate takes the smaller of monthly surplus and bank cash without treating transfers as income", () => {
  const data = state();
  data.transactions.push(transaction("transfer_out", 60_000));
  const result = estimate(data);
  assert.equal(result.incomeCents, 100_000);
  assert.equal(result.expenseCents, 20_000);
  assert.equal(result.monthlyMarginCents, 80_000);
  assert.equal(result.bankBalanceCents, 70_000);
  assert.equal(result.suggestedCents, 70_000);
  data.sources.push(source({ id: "second", initialBalanceCents: 0 }));
  data.transactions.push(
    transaction("transfer_in", 60_000, { sourceId: "second" }),
  );
  assert.equal(estimate(data).suggestedCents, 80_000);
});

test("benefit balances, reloads and expenses cannot fund an investment estimate", () => {
  const data = state();
  data.sources.push(
    source({ id: "benefit", type: "benefit", initialBalanceCents: 900_000 }),
  );
  data.transactions.push(
    transaction("income", 85_000, { sourceId: "benefit" }),
    transaction("expense", 50_000, { sourceId: "benefit", needsReview: true }),
  );
  const result = estimate(data);
  assert.equal(result.benefitIncomeCents, 85_000);
  assert.equal(result.incomeCents, 100_000);
  assert.equal(result.expenseCents, 20_000);
  assert.equal(result.bankBalanceCents, 130_000);
  assert.equal(result.suggestedCents, 80_000);
  assert.ok(result.issues.some((issue) => issue.code === "benefit_excluded"));
});

test("card purchases are spending once while bank invoice payments only reduce cash", () => {
  const data = state({
    transactions: [
      transaction("income", 100_000),
      transaction("expense", 20_000, { sourceId: "credit" }),
      transaction("card_payment", 20_000),
    ],
  });
  data.sources.push(
    source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
  );
  const result = estimate(data);
  assert.equal(result.expenseCents, 20_000);
  assert.equal(result.monthlyMarginCents, 80_000);
  assert.equal(result.bankBalanceCents, 130_000);
  assert.equal(result.cardReserveCents, 20_000);
  assert.equal(result.cashCapacityCents, 110_000);
  assert.equal(result.suggestedCents, 80_000);
});

test("an earlier invoice payment cannot erase this month's card protection and a manual amount replaces it", () => {
  const data = state({
    transactions: [
      transaction("income", 100_000),
      transaction("expense", 25_000, { sourceId: "credit" }),
      transaction("card_payment", 70_000),
    ],
  });
  data.sources.push(
    source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
  );
  assert.equal(estimate(data).cardReserveCents, 25_000);
  assert.equal(estimate(data).cashCapacityCents, 55_000);
  const adjusted = estimate(data, { cardReserveCents: 5_000 });
  assert.equal(adjusted.cardReserveCents, 5_000);
  assert.equal(adjusted.cashCapacityCents, 75_000);
  assert.equal(adjusted.suggestedCents, 75_000);
});

test("pending card schedules use max with purchases instead of summing both", () => {
  const data = state({
    schedules: [schedule({ kind: "card_payment", amountCents: 40_000 })],
  });
  data.sources.push(
    source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
  );
  data.transactions.push(
    transaction("expense", 25_000, { sourceId: "credit" }),
  );
  const result = estimate(data);
  assert.equal(result.cardReserveCents, 40_000);
  assert.equal(result.personalProvisionCents, 0);
});

test("budget remaining and recurrent expenses in the same category overlap, different categories add", () => {
  const data = state({ budgets: [budget()], schedules: [schedule()] });
  const result = estimate(data);
  assert.equal(result.personalProvisionCents, 15_000);
  assert.equal(result.monthlyMarginCents, 65_000);
  data.schedules?.push(
    schedule({ id: "transport", category: "Transporte", amountCents: 8_000 }),
  );
  assert.equal(estimate(data).personalProvisionCents, 23_000);
  data.budgets = [budget({ limitCents: 60_000 })];
  assert.equal(estimate(data).personalProvisionCents, 48_000);
});

test("budget scopes stay separate, personal budgets exclude own shared spending, and shared protection is adjustable", () => {
  const data = state({
    couple,
    budgets: [
      budget(),
      budget({ id: "joint", scope: "couple", limitCents: 50_000 }),
    ],
  });
  data.transactions.push(transaction("expense", 10_000, { shared: true }));
  data.partnerTransactions.push(
    transaction("expense", 5_000, {
      ownerId: "partner",
      shared: true,
      sourceId: "hidden",
    }),
  );
  const result = estimate(data);
  assert.equal(result.personalProvisionCents, 10_000);
  assert.equal(result.sharedProvisionCents, 35_000);
  assert.equal(result.appliedSharedCents, 35_000);
  assert.equal(
    estimate(data, { sharedCommitmentCents: 7_000 }).appliedSharedCents,
    7_000,
  );
  assert.equal(result.incomeCents, 100_000);
  assert.equal(result.expenseCents, 30_000);
  assert.ok(result.issues.some((issue) => issue.code === "shared_assumption"));
});

test("benefit spending cannot consume the bank-funded remainder of a budget", () => {
  const data = state({ budgets: [budget({ limitCents: 40_000 })] });
  data.sources.push(source({ id: "benefit", type: "benefit" }));
  data.transactions.push(
    transaction("expense", 15_000, { sourceId: "benefit" }),
  );
  assert.equal(estimate(data).personalProvisionCents, 20_000);
});

test("confirmed unlinked commitments remain protected while valid links and skipped occurrences do not", () => {
  const paid = transaction("expense", 15_000, { id: "paid" });
  const data = state({
    transactions: [transaction("income", 100_000), paid],
    schedules: [schedule()],
    occurrences: [occurrence()],
  });
  assert.equal(estimate(data).personalProvisionCents, 15_000);
  assert.ok(
    estimate(data).issues.some(
      (issue) => issue.code === "unlinked_confirmation",
    ),
  );
  data.occurrences = [occurrence({ state: "linked", transactionId: paid.id })];
  assert.equal(estimate(data).personalProvisionCents, 0);
  data.occurrences = [occurrence({ state: "skipped" })];
  assert.equal(estimate(data).personalProvisionCents, 0);
  data.occurrences = [
    occurrence({ state: "linked", transactionId: "missing" }),
  ];
  assert.equal(estimate(data).personalProvisionCents, 15_000);
});

test("a link to an imported future movement cannot remove current protection", () => {
  const data = state({
    schedules: [schedule()],
    occurrences: [occurrence({ state: "linked", transactionId: "future" })],
  });
  data.transactions.push(
    transaction("expense", 15_000, { id: "future", date: `${month}-28` }),
  );
  const result = estimate(data);
  assert.equal(result.expenseCents, 20_000);
  assert.equal(result.personalProvisionCents, 15_000);
});

test("a valid shared link paid by the partner is not charged again to personal cash", () => {
  const data = state({
    couple,
    schedules: [schedule({ scope: "couple" })],
    occurrences: [
      occurrence({ state: "linked", transactionId: "partner-paid" }),
    ],
  });
  data.partnerTransactions.push(
    transaction("expense", 15_000, {
      id: "partner-paid",
      ownerId: "partner",
      shared: true,
      sourceId: "hidden",
    }),
  );
  const result = estimate(data);
  assert.equal(result.sharedProvisionCents, 0);
  assert.equal(result.expenseCents, 20_000);
  assert.equal(result.bankBalanceCents, 130_000);
});

test("expected recurring income is context only and cannot finance a suggested contribution", () => {
  const data = state({
    transactions: [],
    schedules: [schedule({ kind: "income", amountCents: 500_000 })],
  });
  const result = estimate(data);
  assert.equal(result.pendingIncomeCents, 500_000);
  assert.equal(result.incomeCents, 0);
  assert.equal(result.monthlyMarginCents, 0);
  assert.equal(result.suggestedCents, 0);
});

test("archived personal reserves and own share of joint reserves reduce cash, not partner contributions", () => {
  const data = state({
    couple,
    goals: [goal({ archived: true }), goal({ id: "joint", scope: "couple" })],
    goalMovements: [
      movement(10_000, { date: "2026-10-01" }),
      movement(20_000, { goalId: "joint", date: "2026-10-01" }),
      movement(40_000, {
        goalId: "joint",
        ownerId: "partner",
        date: "2026-10-01",
      }),
    ],
  });
  const result = estimate(data);
  assert.equal(result.defaultGoalReserveCents, 30_000);
  assert.equal(result.goalContributionsCents, 0);
  assert.equal(result.cashCapacityCents, 100_000);
  assert.equal(result.monthlyMarginCents, 80_000);
  data.goalMovements?.push(
    movement(50_000, {
      kind: "withdrawal",
      goalId: "joint",
      ownerId: "partner",
    }),
  );
  assert.equal(estimate(data).defaultGoalReserveCents, 20_000);
  assert.equal(estimate(data, { goalReserveCents: 0 }).goalReserveCents, 0);
});

test("current own net contributions reduce only additional monthly capacity and future movements are excluded", () => {
  const data = state({
    goals: [goal()],
    goalMovements: [
      movement(30_000),
      movement(5_000, { kind: "withdrawal" }),
      movement(500_000, { date: `${month}-30` }),
    ],
  });
  const result = estimate(data);
  assert.equal(result.goalContributionsCents, 25_000);
  assert.equal(result.monthlyMarginCents, 55_000);
  assert.equal(result.goalReserveCents, 25_000);
  assert.equal(result.cashCapacityCents, 105_000);
  data.goalMovements?.push(movement(30_000, { kind: "withdrawal" }));
  assert.equal(estimate(data).goalContributionsCents, 0);
});

test("future transactions cannot inflate current bank cash or monthly income", () => {
  const data = state();
  data.transactions.push(
    transaction("income", 900_000, { date: `${month}-30` }),
    transaction("expense", 50_000, { date: `${month}-29` }),
  );
  const result = estimate(data);
  assert.equal(result.asOf, today);
  assert.equal(result.incomeCents, 100_000);
  assert.equal(result.bankBalanceCents, 130_000);
  assert.equal(result.suggestedCents, 80_000);
  assert.equal(estimate(data, {}, "2026-12").suggestedCents, null);
});

test("historical closing balances are accepted only once that reference date actually exists", () => {
  const data = state({
    sources: [
      source({ balanceDate: "2026-12-01", initialBalanceCents: 12_000 }),
    ],
  });
  assert.equal(estimate(data).balanceComplete, false);
  assert.equal(estimate(data).suggestedCents, null);
  const historical = estimate(data, {}, month, "2026-12-15");
  assert.equal(historical.asOf, "2026-11-30");
  assert.equal(historical.balanceComplete, true);
  assert.equal(historical.bankBalanceCents, 12_000);
  assert.equal(historical.suggestedCents, 12_000);
});

test("unknown bank opening balances, missing bank sources and relevant review flags block suggestions", () => {
  const data = state();
  data.sources[0].hasOpeningBalance = false;
  assert.equal(estimate(data).suggestedCents, null);
  data.sources[0].hasOpeningBalance = true;
  data.transactions[0].needsReview = true;
  assert.equal(estimate(data).suggestedCents, null);
  data.transactions[0].needsReview = false;
  data.sources.push(source({ id: "unknown-second", hasOpeningBalance: false }));
  assert.equal(estimate(data).suggestedCents, null);
  assert.equal(estimate(state({ sources: [] })).suggestedCents, null);
});

test("a pending bank movement since the opening balance blocks later months but old settled card review does not", () => {
  const data = state({
    sources: [
      source({ balanceDate: "2026-10-01" }),
      source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
    ],
  });
  const earlier = transaction("expense", 1_000, {
    date: "2026-10-15",
    needsReview: true,
  });
  data.transactions.push(earlier);
  assert.equal(estimate(data).suggestedCents, null);
  earlier.sourceId = "credit";
  assert.equal(estimate(data).suggestedCents, 80_000);
});

test("the known legacy outgoing Pix refund classification blocks estimation without rewriting history", () => {
  const data = state();
  const bad = transaction("refund", 10_000, {
    description: "Devolução Pix enviada",
  });
  data.transactions.push(bad);
  const original = structuredClone(data);
  assert.equal(estimate(data).suggestedCents, null);
  assert.ok(
    estimate(data).issues.some(
      (issue) =>
        issue.code === "ambiguous_refund" && issue.severity === "blocking",
    ),
  );
  assert.deepEqual(data, original);
  bad.description = "Estorno de Pix enviado";
  assert.equal(estimate(data).suggestedCents, 90_000);
});

test("private partner records, unrelated goals and duplicate rows cannot inflate personal capacity", () => {
  const data = state({ couple });
  data.sources.push(
    source({
      id: "foreign",
      ownerId: "partner",
      initialBalanceCents: 9_000_000,
    }),
  );
  data.transactions.push(
    transaction("income", 9_000_000, {
      ownerId: "partner",
      sourceId: "foreign",
    }),
    data.transactions[0],
  );
  data.partnerTransactions.push(
    transaction("income", 9_000_000, { ownerId: "partner", shared: false }),
  );
  data.goals = [goal({ id: "private-partner", ownerId: "partner" })];
  data.goalMovements = [
    movement(9_000_000, { goalId: "private-partner", ownerId: "partner" }),
    movement(9_000_000, { goalId: "missing" }),
  ];
  const result = estimate(data);
  assert.equal(result.incomeCents, 100_000);
  assert.equal(result.bankBalanceCents, 130_000);
  assert.equal(result.goalReserveCents, 0);
  assert.equal(result.suggestedCents, 80_000);
});

test("extra costs and minimum retained balance constrain cash without creating a financial movement", () => {
  const data = state();
  const original = structuredClone(data);
  const result = estimate(data, {
    extraExpenseCents: 10_000,
    minimumBalanceCents: 80_000,
  });
  assert.equal(result.monthlyMarginCents, 70_000);
  assert.equal(result.cashCapacityCents, 40_000);
  assert.equal(result.suggestedCents, 40_000);
  assert.equal(
    estimate(data, { minimumBalanceCents: 500_000 }).suggestedCents,
    0,
  );
  assert.deepEqual(data, original);
});

test("future installments stay contextual instead of becoming current spending and cross a year boundary", () => {
  const data = state({
    transactions: [
      transaction("income", 100_000),
      transaction("expense", 10_000, {
        installmentCurrent: 2,
        installmentTotal: 4,
      }),
    ],
  });
  const result = estimate(data);
  assert.equal(result.expenseCents, 10_000);
  assert.equal(result.nextInstallments[0].month, "2026-12");
  assert.equal(result.nextInstallments[0].amountCents, 10_000);
  assert.equal(result.nextInstallments[1].month, "2027-01");
  assert.equal(result.nextInstallments[1].amountCents, 10_000);
  assert.equal(result.suggestedCents, 90_000);
});

test("unidentified sources and incomplete import coverage are reported rather than silently trusted", () => {
  const data = state();
  assert.ok(estimate(data).issues.some((issue) => issue.code === "no_imports"));
  data.transactions.push(transaction("income", 2_000, { sourceId: "missing" }));
  assert.equal(estimate(data).suggestedCents, null);
  assert.ok(
    estimate(data).issues.some((issue) => issue.code === "unknown_source"),
  );
  data.transactions.pop();
  data.imports.push({
    id: "import",
    createdAt: "2026-11-10T12:00:00Z",
    files: ["test.csv"],
    count: 2,
    incomeCents: 100_000,
    expenseCents: 20_000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-10",
  });
  assert.ok(
    estimate(data).issues.some((issue) => issue.code === "stale_imports"),
  );
  assert.ok(
    estimate(data).issues.some((issue) => issue.code === "coverage_unknown"),
  );
});

test("invalid month and cutoff dates do not silently normalize", () => {
  assert.throws(() => estimateReserve(state(), "2026-13"), RangeError);
  assert.throws(
    () =>
      estimateReserve(state(), month, defaultReservePlan(month), "2026-02-30"),
    RangeError,
  );
});

test("installments anticipated from earlier imports protect the selected month until actually imported", () => {
  const data = state();
  data.sources.push(
    source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
  );
  data.transactions.push(
    transaction("expense", 10_000, {
      sourceId: "credit",
      date: "2026-10-05",
      description: "Notebook parcela 1/4",
      category: "Compras",
      installmentCurrent: 1,
      installmentTotal: 4,
    }),
  );
  const missing = estimate(data);
  assert.equal(missing.personalProvisionCents, 10_000);
  assert.equal(missing.expenseCents, 20_000);
  assert.equal(missing.cardReserveCents, 0);
  assert.equal(missing.cashCapacityCents, 120_000);
  assert.equal(missing.suggestedCents, 70_000);
  assert.ok(
    missing.issues.some((issue) => issue.code === "installment_forecast"),
  );
  data.transactions.push(
    transaction("expense", 10_000, {
      sourceId: "credit",
      description: "Notebook parcela 2/4",
      category: "Compras",
      installmentCurrent: 2,
      installmentTotal: 4,
    }),
  );
  const imported = estimate(data);
  assert.equal(imported.personalProvisionCents, 0);
  assert.equal(imported.expenseCents, 30_000);
  assert.equal(imported.cardReserveCents, 10_000);
  assert.equal(imported.cashCapacityCents, 120_000);
  assert.equal(imported.suggestedCents, 70_000);
  assert.equal(
    imported.issues.some((issue) => issue.code === "installment_forecast"),
    false,
  );
});

test("selected-month missing installments overlap the same category budget instead of doubling it", () => {
  const data = state({
    budgets: [budget({ category: "Compras", limitCents: 15_000 })],
  });
  data.sources.push(
    source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
  );
  data.transactions.push(
    transaction("expense", 10_000, {
      sourceId: "credit",
      date: "2026-10-05",
      category: "Compras",
      installmentCurrent: 1,
      installmentTotal: 4,
    }),
  );
  assert.equal(estimate(data).personalProvisionCents, 15_000);
  data.budgets![0].limitCents = 5_000;
  assert.equal(estimate(data).personalProvisionCents, 10_000);
});

test("shared missing installments stay in the joint provision and follow the user's own-share adjustment", () => {
  const data = state({ couple });
  data.sources.push(
    source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
  );
  data.transactions.push(
    transaction("expense", 10_000, {
      sourceId: "credit",
      date: "2026-10-05",
      category: "Compras",
      shared: true,
      installmentCurrent: 1,
      installmentTotal: 4,
    }),
  );
  const whole = estimate(data);
  assert.equal(whole.personalProvisionCents, 0);
  assert.equal(whole.sharedProvisionCents, 10_000);
  assert.equal(whole.appliedSharedCents, 10_000);
  assert.equal(whole.suggestedCents, 70_000);
  assert.equal(
    estimate(data, { sharedCommitmentCents: 3_000 }).suggestedCents,
    77_000,
  );
});

function missingInvoiceState(): AppState {
  return state({
    sources: [
      source({ initialBalanceCents: 100_000 }),
      source({ id: "credit", type: "credit", initialBalanceCents: 0 }),
    ],
    transactions: [
      transaction("income", 100_000),
      transaction("expense", 10_000, {
        id: "old-purchase",
        sourceId: "credit",
        date: "2026-10-05",
        description: "Notebook 1/4",
        category: "Compras",
        installmentCurrent: 1,
        installmentTotal: 4,
      }),
      transaction("card_payment", 10_000, {
        id: "old-payment",
        date: "2026-10-10",
      }),
    ],
    cardInvoices: [
      {
        id: "old-invoice",
        sourceId: "credit",
        month: "2026-10",
        confirmedTotalCents: 10_000,
      },
      {
        id: "current-invoice",
        sourceId: "credit",
        month,
        confirmedTotalCents: 10_000,
      },
    ],
    invoicePayments: [
      {
        id: "old-link",
        invoiceId: "old-invoice",
        transactionId: "old-payment",
        amountCents: 10_000,
      },
    ],
    cardCycles: [],
  });
}

test("recategorizing or sharing an imported installment does not create another missing payment", () => {
  const data = missingInvoiceState();
  data.couple = couple;
  data.transactions.push(
    transaction("expense", 10_000, {
      id: "new-purchase",
      sourceId: "credit",
      description: "Notebook 2/4",
      category: "Educação",
      shared: true,
      installmentCurrent: 2,
      installmentTotal: 4,
    }),
  );
  const current = estimate(data);
  assert.equal(current.personalProvisionCents, 0);
  assert.equal(current.sharedProvisionCents, 0);
  assert.equal(
    current.issues.some((issue) => issue.code === "installment_forecast"),
    false,
  );
  const next = estimate(data, {}, "2026-12", "2026-12-26");
  assert.equal(next.personalProvisionCents, 0);
  assert.equal(next.sharedProvisionCents, 10_000);
});

test("verified unpaid invoices protect a missing installment once in cash and retain its monthly forecast", () => {
  const data = missingInvoiceState();
  const result = estimate(data, { minimumBalanceCents: 188_000 });
  assert.equal(result.personalProvisionCents, 10_000);
  assert.equal(result.monthlyMarginCents, 90_000);
  assert.equal(result.cardReserveCents, 10_000);
  assert.equal(result.cashPersonalProvisionCents, 0);
  assert.equal(result.cashCapacityCents, 2_000);
  assert.equal(result.suggestedCents, 2_000);
  assert.ok(
    result.issues.some((issue) => issue.code === "installment_invoice_overlap"),
  );
});

test("already paid verified invoices do not reserve their missing purchase again after the bank debit", () => {
  const data = missingInvoiceState();
  data.transactions.push(
    transaction("card_payment", 10_000, {
      id: "current-payment",
      date: `${month}-10`,
    }),
  );
  data.invoicePayments!.push({
    id: "current-link",
    invoiceId: "current-invoice",
    transactionId: "current-payment",
    amountCents: 10_000,
  });
  const result = estimate(data, { minimumBalanceCents: 188_000 });
  assert.equal(result.bankBalanceCents, 190_000);
  assert.equal(result.cardReserveCents, 0);
  assert.equal(result.personalProvisionCents, 10_000);
  assert.equal(result.cashPersonalProvisionCents, 0);
  assert.equal(result.suggestedCents, 2_000);
});

test("partial invoice payment and manual zero preserve the unprotected remainder of missing consumption", () => {
  const data = missingInvoiceState();
  data.transactions.push(
    transaction("card_payment", 6_000, {
      id: "partial-payment",
      date: `${month}-10`,
    }),
  );
  data.invoicePayments!.push({
    id: "partial-link",
    invoiceId: "current-invoice",
    transactionId: "partial-payment",
    amountCents: 6_000,
  });
  const automatic = estimate(data, { minimumBalanceCents: 188_000 });
  assert.equal(automatic.bankBalanceCents, 194_000);
  assert.equal(automatic.cardReserveCents, 4_000);
  assert.equal(automatic.cashPersonalProvisionCents, 0);
  assert.equal(automatic.suggestedCents, 2_000);
  const manual = estimate(data, {
    minimumBalanceCents: 188_000,
    cardReserveCents: 0,
  });
  assert.equal(manual.cardReserveCents, 0);
  assert.equal(manual.cashPersonalProvisionCents, 4_000);
  assert.equal(manual.suggestedCents, 2_000);
  const unpaid = missingInvoiceState();
  assert.equal(
    estimate(unpaid, { cardReserveCents: 0 }).cashPersonalProvisionCents,
    10_000,
  );
});

test("invoice overlap never releases the remaining category budget or unrelated recurrence", () => {
  const data = missingInvoiceState();
  data.budgets = [budget({ category: "Compras", limitCents: 15_000 })];
  assert.equal(estimate(data).cashPersonalProvisionCents, 15_000);
  data.budgets[0].limitCents = 5_000;
  const partialBudget = estimate(data);
  assert.equal(partialBudget.personalProvisionCents, 10_000);
  assert.equal(partialBudget.cashPersonalProvisionCents, 5_000);
  data.budgets = [];
  data.schedules = [schedule({ category: "Compras", amountCents: 7_000 })];
  const recurring = estimate(data);
  assert.equal(recurring.personalProvisionCents, 17_000);
  assert.equal(recurring.cashPersonalProvisionCents, 7_000);
});

test("a verified gap in one card cannot cover the installment forecast from another card", () => {
  const data = missingInvoiceState();
  data.sources.push(
    source({ id: "another-credit", type: "credit", initialBalanceCents: 0 }),
  );
  data.transactions.find((tx) => tx.id === "old-purchase")!.sourceId =
    "another-credit";
  data.cardInvoices!.find((invoice) => invoice.id === "old-invoice")!.sourceId =
    "another-credit";
  const result = estimate(data, { minimumBalanceCents: 188_000 });
  assert.equal(result.cardReserveCents, 10_000);
  assert.equal(result.cashPersonalProvisionCents, 10_000);
  assert.equal(result.suggestedCents, 0);
});

test("same-card verified coverage is consumed once across categories and skips already budgeted portions", () => {
  const data = missingInvoiceState();
  data.transactions.push(
    transaction("expense", 10_000, {
      sourceId: "credit",
      date: "2026-10-05",
      description: "Câmera 1/4",
      category: "Educação",
      installmentCurrent: 1,
      installmentTotal: 4,
    }),
  );
  data.cardInvoices![0].confirmedTotalCents = 20_000;
  data.transactions.find((tx) => tx.id === "old-payment")!.amountCents = 20_000;
  data.invoicePayments![0].amountCents = 20_000;
  const result = estimate(data);
  assert.equal(result.personalProvisionCents, 20_000);
  assert.equal(result.cashPersonalProvisionCents, 10_000);
  data.budgets = [budget({ category: "Compras", limitCents: 10_000 })];
  const budgeted = estimate(data);
  assert.equal(budgeted.personalProvisionCents, 20_000);
  assert.equal(budgeted.cashPersonalProvisionCents, 10_000);
});

test("unverified or zero-total invoices cannot erase an unsupported missing-installment provision", () => {
  const data = missingInvoiceState();
  data.cardInvoices![1].confirmedTotalCents = null;
  assert.equal(estimate(data).cashPersonalProvisionCents, 10_000);
  data.cardInvoices![1].confirmedTotalCents = 0;
  assert.equal(estimate(data).cashPersonalProvisionCents, 10_000);
});

test("manual shared provisions remain literal even when the shared forecast overlaps a verified invoice", () => {
  const data = missingInvoiceState();
  data.couple = couple;
  data.transactions.find((tx) => tx.id === "old-purchase")!.shared = true;
  const automatic = estimate(data);
  assert.equal(automatic.sharedProvisionCents, 10_000);
  assert.equal(automatic.cashSharedProvisionCents, 0);
  const manual = estimate(data, { sharedCommitmentCents: 3_000 });
  assert.equal(manual.appliedSharedCents, 3_000);
  assert.equal(manual.cashSharedProvisionCents, 3_000);
});
