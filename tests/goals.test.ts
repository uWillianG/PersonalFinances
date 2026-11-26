import assert from "node:assert/strict";
import { test } from "node:test";
import type { GoalMovement, SavingsGoal } from "../lib/goals-types.ts";
import { goalProgress, goalsSummary } from "../lib/goals.ts";

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "trip",
    ownerId: "me",
    ownerName: "Você",
    scope: "personal",
    name: "Viagem",
    targetCents: 100_000,
    targetDate: "2027-01-31",
    archived: false,
    canEdit: true,
    ...overrides,
  };
}

function movement(
  id: string,
  amountCents: number,
  overrides: Partial<GoalMovement> = {},
): GoalMovement {
  return {
    id,
    goalId: "trip",
    ownerId: "me",
    ownerName: "Você",
    kind: "deposit",
    amountCents,
    date: "2026-11-25",
    note: "",
    createdAt: "2026-11-25T12:00:00Z",
    ...overrides,
  };
}

test("goal progress uses lifetime deposits less withdrawals and isolates goal IDs", () => {
  const records = [
    movement("earlier", 35_000, { date: "2025-01-01" }),
    movement("now", 5_000),
    movement("withdrawal", 10_000, { kind: "withdrawal" }),
    movement("another", 999_999, { goalId: "other-goal" }),
  ];
  const original = structuredClone(records);
  assert.deepEqual(goalProgress(goal(), records, "2026-11-25"), {
    reservedCents: 30_000,
    remainingCents: 70_000,
    percent: 30,
    achieved: false,
    overdue: false,
    monthsRemaining: 3,
    monthlyCents: 23_334,
  });
  assert.deepEqual(records, original);
});

test("monthly suggestion rounds up to whole cents and includes this calendar month", () => {
  const records = [movement("first", 99_999)];
  const progress = goalProgress(goal(), records, "2026-11-30");
  assert.equal(progress.remainingCents, 1);
  assert.equal(progress.monthsRemaining, 3);
  assert.equal(progress.monthlyCents, 1);
  assert.equal(
    goalProgress(goal({ targetDate: "2026-11-30" }), [], "2026-11-25")
      .monthsRemaining,
    1,
  );
  assert.equal(
    goalProgress(goal({ targetDate: "2026-11-30" }), [], "2026-11-25")
      .monthlyCents,
    100_000,
  );
});

test("calendar month counts cross year boundaries and leap days without day-length drift", () => {
  assert.equal(
    goalProgress(goal({ targetDate: "2027-01-01" }), [], "2026-12-31")
      .monthsRemaining,
    2,
  );
  assert.equal(
    goalProgress(goal({ targetDate: "2024-03-01" }), [], "2024-02-29")
      .monthsRemaining,
    2,
  );
  assert.equal(
    goalProgress(goal({ targetDate: "2024-02-29" }), [], "2024-01-31")
      .monthsRemaining,
    2,
  );
  assert.equal(
    goalProgress(goal({ targetDate: "2025-02-28" }), [], "2024-02-29")
      .monthsRemaining,
    13,
  );
});

test("expired deadlines suggest the outstanding amount now and achieved goals stop being overdue", () => {
  const expired = goal({ targetDate: "2025-01-01" });
  assert.deepEqual(
    goalProgress(expired, [movement("first", 25_000)], "2026-11-25"),
    {
      reservedCents: 25_000,
      remainingCents: 75_000,
      percent: 25,
      achieved: false,
      overdue: true,
      monthsRemaining: 1,
      monthlyCents: 75_000,
    },
  );
  assert.equal(goalProgress(expired, [], "2025-01-01").overdue, false);
  const achieved = goalProgress(
    expired,
    [movement("first", 100_000)],
    "2026-11-25",
  );
  assert.equal(achieved.achieved, true);
  assert.equal(achieved.overdue, false);
  assert.equal(achieved.monthlyCents, 0);
});

test("overfunding retains the full reserve while progress and remaining amount stop at the target", () => {
  const result = goalProgress(
    goal(),
    [movement("above", 150_000)],
    "2026-11-25",
  );
  assert.equal(result.reservedCents, 150_000);
  assert.equal(result.remainingCents, 0);
  assert.equal(result.percent, 100);
  assert.equal(result.achieved, true);
  assert.equal(result.monthlyCents, 0);
});

test("goals without a deadline have no invented monthly recommendation", () => {
  const result = goalProgress(goal({ targetDate: null }), [], "2026-11-25");
  assert.equal(result.monthsRemaining, null);
  assert.equal(result.monthlyCents, null);
  assert.equal(result.overdue, false);
  assert.equal(result.reservedCents, 0);
  assert.equal(result.percent, 0);
});

test("a resgate can reopen a previously achieved goal", () => {
  const records = [
    movement("full", 100_000),
    movement("resgate", 40_000, { kind: "withdrawal" }),
  ];
  const result = goalProgress(goal(), records, "2026-11-25");
  assert.equal(result.achieved, false);
  assert.equal(result.reservedCents, 60_000);
  assert.equal(result.remainingCents, 40_000);
  assert.equal(result.monthlyCents, 13_334);
});

test("couple contributions combine both authors without pulling money from personal goals", () => {
  const shared = goal({ id: "joint", scope: "couple" });
  const records = [
    movement("mine", 20_000, { goalId: "joint" }),
    movement("theirs", 30_000, {
      goalId: "joint",
      ownerId: "partner",
      ownerName: "Alex",
    }),
    movement("private", 80_000),
  ];
  assert.equal(
    goalProgress(shared, records, "2026-11-25").reservedCents,
    50_000,
  );
  assert.equal(
    goalProgress(goal(), records, "2026-11-25").reservedCents,
    80_000,
  );
});

test("summary retains archived money and does not offset an unfinished goal with another surplus", () => {
  const list = [
    goal(),
    goal({ id: "reserve", targetCents: 50_000 }),
    goal({ id: "old", targetCents: 900_000, archived: true }),
  ];
  const records = [
    movement("above", 150_000),
    movement("partial", 20_000, { goalId: "reserve" }),
    movement("old-cash", 30_000, { goalId: "old" }),
    movement("hidden", 999_999, { goalId: "unknown" }),
  ];
  assert.deepEqual(goalsSummary(list, records), {
    reservedCents: 200_000,
    targetCents: 150_000,
    remainingCents: 30_000,
    activeCount: 2,
    achievedCount: 1,
  });
});

test("empty summaries and archived-only goals retain accurate zero planning totals", () => {
  assert.deepEqual(goalsSummary([], []), {
    reservedCents: 0,
    targetCents: 0,
    remainingCents: 0,
    activeCount: 0,
    achievedCount: 0,
  });
  assert.deepEqual(
    goalsSummary([goal({ archived: true })], [movement("cash", 30_000)]),
    {
      reservedCents: 30_000,
      targetCents: 0,
      remainingCents: 0,
      activeCount: 0,
      achievedCount: 0,
    },
  );
});

test("repeated IDs from a refreshed state do not duplicate reserves or targets", () => {
  const item = goal();
  const record = movement("cash", 30_000);
  assert.equal(
    goalProgress(item, [record, record], "2026-11-25").reservedCents,
    30_000,
  );
  assert.deepEqual(goalsSummary([item, item], [record, record]), {
    reservedCents: 30_000,
    targetCents: 100_000,
    remainingCents: 70_000,
    activeCount: 1,
    achievedCount: 0,
  });
});

test("invalid calendar dates fail instead of normalizing to a different month", () => {
  assert.throws(
    () => goalProgress(goal({ targetDate: "2025-02-29" }), [], "2026-11-25"),
    RangeError,
  );
  assert.throws(() => goalProgress(goal(), [], "2026-13-01"), RangeError);
});

test("large supported values retain integer cents after deposits and withdrawals", () => {
  const result = goalProgress(
    goal({ targetCents: 1_000_000_000_000 }),
    [
      movement("cash", 1_000_000_000_000),
      movement("resgate", 1, { kind: "withdrawal" }),
    ],
    "2026-11-25",
  );
  assert.equal(result.reservedCents, 999_999_999_999);
  assert.equal(result.remainingCents, 1);
  assert.equal(result.monthlyCents, 1);
});
