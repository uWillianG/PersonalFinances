import type {
  BudgetLimit,
  RecurringSchedule,
  ScheduleOccurrence,
} from "./planning-types.ts";
import type { Transaction } from "./types.ts";

export interface BudgetProgress {
  spentCents: number;
  remainingCents: number;
  percentage: number;
  overCents: number;
  count: number;
}

export interface CalendarEntry {
  key: string;
  schedule: RecurringSchedule;
  dueDate: string;
  state: "planned" | "confirmed" | "linked" | "skipped";
  transactionId: string | null;
  confirmation?: ScheduleOccurrence;
}

export interface CalendarSummary {
  expenseCents: number;
  incomeCents: number;
  cardPaymentCents: number;
  /** All non-skipped occurrences, including income and card payments. */
  count: number;
  pendingCount: number;
  confirmedCount: number;
  skippedCount: number;
}

export function categoryKey(category: string): string {
  return category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Budgets use imported expenses less refunds; forecasts never enter the ledger. */
export function budgetProgress(
  budget: BudgetLimit,
  ownTransactions: readonly Transaction[],
  partnerTransactions: readonly Transaction[] = [],
): BudgetProgress {
  const transactions =
    budget.scope === "personal"
      ? ownTransactions.filter((transaction) => !transaction.shared)
      : [
          ...ownTransactions.filter((transaction) => transaction.shared),
          ...partnerTransactions.filter((transaction) => transaction.shared),
        ];
  const seen = new Set<string>();
  let spentCents = 0;
  let count = 0;
  for (const transaction of transactions) {
    if (seen.has(transaction.id)) continue;
    seen.add(transaction.id);
    if (
      transaction.date.slice(0, 7) !== budget.month ||
      categoryKey(transaction.category.trim() || "Outros") !==
        categoryKey(budget.category) ||
      (transaction.kind !== "expense" && transaction.kind !== "refund")
    )
      continue;
    spentCents +=
      transaction.kind === "refund"
        ? -transaction.amountCents
        : transaction.amountCents;
    count += 1;
  }
  return {
    spentCents,
    remainingCents: budget.limitCents - spentCents,
    percentage:
      budget.limitCents > 0 ? (spentCents / budget.limitCents) * 100 : 0,
    overCents: Math.max(0, spentCents - budget.limitCents),
    count,
  };
}

function calendarDate(value: string): Date {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value))
    throw new RangeError(`Data inválida: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new RangeError(`Data inválida: ${value}`);
  return date;
}

function calendarMonth(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
    throw new RangeError(`Mês inválido: ${month}`);
  const start = calendarDate(`${month}-01`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function dateAtMonth(start: Date, day: number): string {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const date = new Date(start);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

/** Calendar dates are advanced in UTC; local DST cannot shift a due date. */
export function scheduleDates(
  schedule: RecurringSchedule,
  month: string,
  options: { includeInactive?: boolean } = {},
): string[] {
  const { start: monthStart, end: monthEnd } = calendarMonth(month);
  if (!schedule.active && !options.includeInactive) return [];
  const start = calendarDate(schedule.startDate);
  const end = schedule.endDate === null ? null : calendarDate(schedule.endDate);
  const withinSchedule = (date: string) =>
    date >= schedule.startDate &&
    (schedule.endDate === null || date <= schedule.endDate);
  if (start >= monthEnd || (end !== null && end < monthStart)) return [];
  if (schedule.frequency === "monthly" || schedule.frequency === "yearly") {
    if (
      schedule.frequency === "yearly" &&
      start.getUTCMonth() !== monthStart.getUTCMonth()
    )
      return [];
    const date = dateAtMonth(monthStart, start.getUTCDate());
    return withinSchedule(date) ? [date] : [];
  }
  const week = 7 * 24 * 60 * 60 * 1000;
  const firstWeek = Math.max(
    0,
    Math.ceil((monthStart.getTime() - start.getTime()) / week),
  );
  const dates: string[] = [];
  for (
    let time = start.getTime() + firstWeek * week;
    time < monthEnd.getTime();
    time += week
  ) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (withinSchedule(date)) dates.push(date);
  }
  return dates;
}

export function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

/**
 * Omitting transactions trusts existing links. Passing the visible ledger makes
 * a deleted or unavailable linked transaction pending again, without inventing it.
 */
export function buildCalendar(
  schedules: readonly RecurringSchedule[],
  occurrences: readonly ScheduleOccurrence[],
  month: string,
  transactions?: readonly Transaction[],
): CalendarEntry[] {
  calendarMonth(month);
  const transactionIds =
    transactions === undefined
      ? undefined
      : new Set(transactions.map((transaction) => transaction.id));
  const entries: CalendarEntry[] = [];
  const recorded = new Map<string, Map<string, ScheduleOccurrence>>();
  for (const occurrence of occurrences) {
    if (occurrence.dueDate.slice(0, 7) !== month) continue;
    // Old dates can remain recorded after a schedule is edited or paused.
    try {
      calendarDate(occurrence.dueDate);
    } catch {
      continue;
    }
    const dates =
      recorded.get(occurrence.scheduleId) ??
      new Map<string, ScheduleOccurrence>();
    dates.set(occurrence.dueDate, occurrence);
    recorded.set(occurrence.scheduleId, dates);
  }
  for (const schedule of schedules) {
    const confirmations = recorded.get(schedule.id);
    const dates = new Set(
      schedule.active ? scheduleDates(schedule, month) : [],
    );
    for (const date of confirmations?.keys() ?? []) dates.add(date);
    for (const dueDate of dates) {
      const confirmation = confirmations?.get(dueDate);
      let state: CalendarEntry["state"] = confirmation?.state ?? "planned";
      let transactionId =
        state === "linked" ? (confirmation?.transactionId ?? null) : null;
      if (
        state === "linked" &&
        (transactionId === null ||
          (transactionIds !== undefined && !transactionIds.has(transactionId)))
      ) {
        state = "planned";
        transactionId = null;
      }
      entries.push({
        key: `${schedule.id}:${dueDate}`,
        schedule,
        dueDate,
        state,
        transactionId,
        ...(confirmation ? { confirmation } : {}),
      });
    }
  }
  return entries.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.schedule.name.localeCompare(b.schedule.name, "pt-BR") ||
      a.key.localeCompare(b.key),
  );
}

/** Card bills stay separate from expenses, since they may pay for those purchases. */
export function calendarSummary(
  entries: readonly CalendarEntry[],
): CalendarSummary {
  const summary: CalendarSummary = {
    expenseCents: 0,
    incomeCents: 0,
    cardPaymentCents: 0,
    count: 0,
    pendingCount: 0,
    confirmedCount: 0,
    skippedCount: 0,
  };
  for (const entry of entries) {
    if (entry.state === "skipped") {
      summary.skippedCount += 1;
      continue;
    }
    summary.count += 1;
    if (entry.state === "planned") summary.pendingCount += 1;
    else summary.confirmedCount += 1;
    if (entry.schedule.kind === "expense")
      summary.expenseCents += entry.schedule.amountCents;
    else if (entry.schedule.kind === "income")
      summary.incomeCents += entry.schedule.amountCents;
    else summary.cardPaymentCents += entry.schedule.amountCents;
  }
  return summary;
}
