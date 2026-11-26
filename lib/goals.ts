import type { GoalMovement, SavingsGoal } from "./goals-types.ts";
import { todayISO } from "./planning.ts";

export interface GoalProgress {
  reservedCents: number;
  remainingCents: number;
  percent: number;
  achieved: boolean;
  overdue: boolean;
  monthsRemaining: number | null;
  monthlyCents: number | null;
}

export interface GoalsSummary {
  reservedCents: number;
  targetCents: number;
  remainingCents: number;
  activeCount: number;
  achievedCount: number;
}

function monthIndex(date: string): number {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new RangeError(`Data inválida: ${date}`);
  return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
}

/** Caixinhas earmark existing money; these values never enter account balances. */
function reservedByGoal(
  movements: readonly GoalMovement[],
): Map<string, number> {
  const totals = new Map<string, number>();
  const seen = new Set<string>();
  for (const movement of movements) {
    if (seen.has(movement.id)) continue;
    seen.add(movement.id);
    totals.set(
      movement.goalId,
      (totals.get(movement.goalId) ?? 0) +
        (movement.kind === "deposit" ? 1 : -1) * movement.amountCents,
    );
  }
  return totals;
}

export function goalProgress(
  goal: SavingsGoal,
  movements: readonly GoalMovement[],
  today = todayISO(),
): GoalProgress {
  const reservedCents = reservedByGoal(movements).get(goal.id) ?? 0;
  const remainingCents = Math.max(0, goal.targetCents - reservedCents);
  const achieved = remainingCents === 0;
  let monthsRemaining: number | null = null;
  if (goal.targetDate !== null)
    monthsRemaining = Math.max(
      1,
      monthIndex(goal.targetDate) - monthIndex(today) + 1,
    );
  return {
    reservedCents,
    remainingCents,
    percent:
      goal.targetCents > 0
        ? Math.max(0, Math.min(100, (reservedCents / goal.targetCents) * 100))
        : 0,
    achieved,
    overdue: !achieved && goal.targetDate !== null && goal.targetDate < today,
    monthsRemaining,
    monthlyCents:
      monthsRemaining === null
        ? null
        : Math.ceil(remainingCents / monthsRemaining),
  };
}

/** Archived reserves remain visible; overfunding one goal never funds another. */
export function goalsSummary(
  goals: readonly SavingsGoal[],
  movements: readonly GoalMovement[],
): GoalsSummary {
  const reserved = reservedByGoal(movements);
  const seen = new Set<string>();
  const result: GoalsSummary = {
    reservedCents: 0,
    targetCents: 0,
    remainingCents: 0,
    activeCount: 0,
    achievedCount: 0,
  };
  for (const goal of goals) {
    if (seen.has(goal.id)) continue;
    seen.add(goal.id);
    const balance = reserved.get(goal.id) ?? 0;
    result.reservedCents += balance;
    if (goal.archived) continue;
    result.activeCount += 1;
    result.targetCents += goal.targetCents;
    result.remainingCents += Math.max(0, goal.targetCents - balance);
    if (balance >= goal.targetCents) result.achievedCount += 1;
  }
  return result;
}
