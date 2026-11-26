import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetProgress, buildCalendar, calendarSummary, categoryKey, scheduleDates, todayISO } from "../lib/planning.ts";
import { summarize } from "../lib/finance.ts";
import type { BudgetLimit, RecurringSchedule, ScheduleOccurrence } from "../lib/planning-types.ts";
import type { Transaction } from "../lib/types.ts";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "purchase", ownerId: "me", ownerName: "Pessoa", sourceId: "bank", date: "2026-11-10",
    description: "Mercado", amountCents: 10_000, kind: "expense", category: "Mercado",
    shared: false, installmentCurrent: null, installmentTotal: null, needsReview: false,
    note: "", importId: null, fingerprint: "purchase", ...overrides,
  };
}

function budget(overrides: Partial<BudgetLimit> = {}): BudgetLimit {
  return { id: "budget", ownerId: "me", ownerName: "Pessoa", scope: "personal", month: "2026-11", category: "Mercado", limitCents: 50_000, canEdit: true, ...overrides };
}

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    id: "schedule", ownerId: "me", ownerName: "Pessoa", scope: "personal", name: "Aluguel", kind: "expense",
    category: "Moradia", amountCents: 100_000, frequency: "monthly", startDate: "2026-01-31",
    endDate: null, active: true, canEdit: true, ...overrides,
  };
}

function occurrence(overrides: Partial<ScheduleOccurrence> = {}): ScheduleOccurrence {
  return { id: "occurrence", scheduleId: "schedule", dueDate: "2026-11-30", state: "confirmed", transactionId: null, confirmedBy: "me", ...overrides };
}

test("category keys normalize case, diacritics, and repeated whitespace consistently", () => {
  assert.equal(categoryKey("  ALIMENTAÇÃO   fora "), "alimentacao fora");
  assert.equal(categoryKey("Saúde"), categoryKey("SAUDE"));
});

test("personal budgets include only private imported spending net of refunds", () => {
  const own = [
    transaction({ id: "expense", category: "MÉRCADO", amountCents: 40_000 }),
    transaction({ id: "refund", category: " mercado ", kind: "refund", amountCents: 5_000 }),
    transaction({ id: "shared", amountCents: 999_999, shared: true }),
    transaction({ id: "old", date: "2026-10-31", amountCents: 999_999 }),
    transaction({ id: "different-category", category: "Compras", amountCents: 999_999 }),
    ...(["income", "transfer_in", "transfer_out", "card_payment"] as const).map((kind) => transaction({ id: kind, kind, amountCents: 999_999 })),
  ];
  const partner = [transaction({ id: "partner-private", ownerId: "partner", amountCents: 999_999 })];
  const original = structuredClone(own);
  assert.deepEqual(budgetProgress(budget(), own, partner), {
    spentCents: 35_000, remainingCents: 15_000, percentage: 70, overCents: 0, count: 2,
  });
  assert.deepEqual(own, original);
});

test("couple budgets use only shared transactions, deduplicate IDs, and expose the exceeded limit", () => {
  const shared = transaction({ id: "mine-shared", shared: true, amountCents: 40_000 });
  const own = [shared, transaction({ id: "mine-private", amountCents: 999_999 })];
  const partner = [shared, transaction({ id: "theirs-shared", ownerId: "partner", shared: true, amountCents: 20_000 }), transaction({ id: "theirs-private", ownerId: "partner", amountCents: 999_999 })];
  assert.deepEqual(budgetProgress(budget({ scope: "couple" }), own, partner), {
    spentCents: 60_000, remainingCents: -10_000, percentage: 120, overCents: 10_000, count: 2,
  });
});

test("refund-only budgets retain a negative expense and zero limits never yield Infinity", () => {
  assert.deepEqual(budgetProgress(budget(), [transaction({ kind: "refund", amountCents: 5_000 })]), {
    spentCents: -5_000, remainingCents: 55_000, percentage: -10, overCents: 0, count: 1,
  });
  assert.deepEqual(budgetProgress(budget({ limitCents: 0 }), [transaction()]), {
    spentCents: 10_000, remainingCents: -10_000, percentage: 0, overCents: 10_000, count: 1,
  });
});

test("monthly schedules clamp the original day per month without drifting after February", () => {
  const item = schedule({ startDate: "2024-01-31" });
  const original = structuredClone(item);
  assert.deepEqual(scheduleDates(item, "2023-12"), []);
  assert.deepEqual(scheduleDates(item, "2024-01"), ["2024-01-31"]);
  assert.deepEqual(scheduleDates(item, "2024-02"), ["2024-02-29"]);
  assert.deepEqual(scheduleDates(item, "2024-03"), ["2024-03-31"]);
  assert.deepEqual(scheduleDates(item, "2025-02"), ["2025-02-28"]);
  assert.deepEqual(scheduleDates(item, "2026-11"), ["2026-11-30"]);
  assert.deepEqual(item, original);
});

test("monthly start and end dates are inclusive even when the last day is clamped", () => {
  assert.deepEqual(scheduleDates(schedule({ startDate: "2026-01-31", endDate: "2026-02-28" }), "2026-02"), ["2026-02-28"]);
  assert.deepEqual(scheduleDates(schedule({ startDate: "2026-01-31", endDate: "2026-02-27" }), "2026-02"), []);
  assert.deepEqual(scheduleDates(schedule({ startDate: "2026-01-31", endDate: "2026-01-31" }), "2026-01"), ["2026-01-31"]);
  assert.deepEqual(scheduleDates(schedule({ endDate: "2026-10-31" }), "2026-11"), []);
});

test("weekly schedules cross leap days and the year boundary in seven calendar days", () => {
  assert.deepEqual(scheduleDates(schedule({ frequency: "weekly", startDate: "2024-02-22" }), "2024-02"), ["2024-02-22", "2024-02-29"]);
  assert.deepEqual(scheduleDates(schedule({ frequency: "weekly", startDate: "2024-02-22", endDate: "2024-03-07" }), "2024-03"), ["2024-03-07"]);
  assert.deepEqual(scheduleDates(schedule({ frequency: "weekly", startDate: "2026-12-28", endDate: "2027-01-18" }), "2027-01"), ["2027-01-04", "2027-01-11", "2027-01-18"]);
  assert.deepEqual(scheduleDates(schedule({ frequency: "weekly", startDate: "2026-12-28", endDate: "2027-01-17" }), "2027-01"), ["2027-01-04", "2027-01-11"]);
});

test("weekly schedules preserve dates across historical São Paulo DST changes", () => {
  assert.deepEqual(scheduleDates(schedule({ frequency: "weekly", startDate: "2018-11-01" }), "2018-11"), ["2018-11-01", "2018-11-08", "2018-11-15", "2018-11-22", "2018-11-29"]);
});

test("yearly leap-day schedules clamp February and never appear in other months", () => {
  const item = schedule({ frequency: "yearly", startDate: "2024-02-29", endDate: "2028-02-29" });
  assert.deepEqual(scheduleDates(item, "2024-02"), ["2024-02-29"]);
  assert.deepEqual(scheduleDates(item, "2025-02"), ["2025-02-28"]);
  assert.deepEqual(scheduleDates(item, "2028-02"), ["2028-02-29"]);
  assert.deepEqual(scheduleDates(item, "2025-03"), []);
  assert.deepEqual(scheduleDates(item, "2023-02"), []);
  assert.deepEqual(scheduleDates(item, "2029-02"), []);
});

test("paused schedules have no generated dates unless explicitly requested for validation", () => {
  const paused = schedule({ active: false });
  assert.deepEqual(scheduleDates(paused, "2026-11"), []);
  assert.deepEqual(scheduleDates(paused, "2026-11", { includeInactive: true }), ["2026-11-30"]);
  assert.throws(() => scheduleDates(schedule(), "2026-00"), RangeError);
  assert.throws(() => scheduleDates(schedule({ startDate: "2026-02-31" }), "2026-11"), RangeError);
});

test("calendar preserves only recorded paused occurrences and historical confirmations after edits", () => {
  const paused = schedule({ active: false });
  assert.deepEqual(buildCalendar([paused], [], "2026-11"), []);
  const entries = buildCalendar([paused], [occurrence(), occurrence({ id: "old", dueDate: "2026-10-31" })], "2026-11", []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, "confirmed");
  assert.equal(entries[0].key, "schedule:2026-11-30");
  const edited = buildCalendar([schedule({ startDate: "2026-11-15" })], [occurrence()], "2026-11", []);
  assert.deepEqual(edited.map((entry) => [entry.dueDate, entry.state]), [["2026-11-15", "planned"], ["2026-11-30", "confirmed"]]);
});

test("linked calendar entries reopen when the referenced transaction is deleted or unavailable", () => {
  const linked = occurrence({ state: "linked", transactionId: "purchase" });
  const present = buildCalendar([schedule()], [linked], "2026-11", [transaction()])[0];
  assert.equal(present.state, "linked");
  assert.equal(present.transactionId, "purchase");
  const deleted = buildCalendar([schedule()], [linked], "2026-11", [])[0];
  assert.equal(deleted.state, "planned");
  assert.equal(deleted.transactionId, null);
  assert.equal(buildCalendar([schedule()], [linked], "2026-11")[0].state, "linked");
  assert.equal(buildCalendar([schedule()], [occurrence({ state: "linked", transactionId: null })], "2026-11")[0].state, "planned");
});

test("calendar sorts dates, retains skipped states, and does not mutate schedules or occurrences", () => {
  const schedules = [schedule(), schedule({ id: "salary", name: "Salário", kind: "income", startDate: "2026-01-05" })];
  const occurrences = [occurrence({ state: "skipped" }), occurrence({ id: "orphan", scheduleId: "missing", dueDate: "2026-11-01" })];
  const original = structuredClone({ schedules, occurrences });
  const entries = buildCalendar(schedules, occurrences, "2026-11");
  assert.deepEqual(entries.map((entry) => [entry.dueDate, entry.state]), [["2026-11-05", "planned"], ["2026-11-30", "skipped"]]);
  assert.deepEqual({ schedules, occurrences }, original);
});

test("calendar keeps expenses, expected income, and card bills separate and never creates spending", () => {
  const schedules = [
    schedule({ id: "subscription", amountCents: 2_000 }),
    schedule({ id: "bill", kind: "card_payment", amountCents: 2_000 }),
    schedule({ id: "salary", kind: "income", amountCents: 100_000 }),
    schedule({ id: "skipped", amountCents: 999_999 }),
  ];
  const entries = buildCalendar(schedules, [
    occurrence({ scheduleId: "subscription", state: "confirmed" }),
    occurrence({ id: "bill-mark", scheduleId: "bill", state: "linked", transactionId: "purchase" }),
    occurrence({ id: "skip-mark", scheduleId: "skipped", state: "skipped" }),
  ], "2026-11", [transaction()]);
  assert.deepEqual(calendarSummary(entries), {
    expenseCents: 2_000, incomeCents: 100_000, cardPaymentCents: 2_000,
    count: 3, pendingCount: 1, confirmedCount: 2, skippedCount: 1,
  });
  assert.equal(summarize([], "2026-11").expenseCents, 0);
  assert.equal(budgetProgress(budget(), []).spentCents, 0);
});

test("today uses São Paulo's calendar date around UTC midnight and month boundaries", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-01T01:30:00Z") });
  assert.equal(todayISO(), "2026-12-31");
  context.mock.timers.setTime(new Date("2027-01-01T03:30:00Z").getTime());
  assert.equal(todayISO(), "2027-01-01");
});
