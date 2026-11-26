import { and, asc, eq, or, sql } from "drizzle-orm";
import {
  budgetLimits,
  coupleMembers,
  recurringSchedules,
  scheduleOccurrences,
  transactions,
  users,
} from "@/db/schema";
import type {
  BudgetLimit,
  PlanScope,
  RecurringSchedule,
  ScheduleOccurrence,
} from "./planning-types";
import type { Context } from "./server";
import { categoryKey, scheduleDates } from "./planning";
import {
  COPY_BUDGETS_SQL,
  RESET_OCCURRENCE_SQL,
  SET_OCCURRENCE_SQL,
} from "./planning-statements";
import {
  validateBudget,
  validateBudgetCopy,
  validateBudgetPatch,
  validateOccurrence,
  validateSchedule,
  validateScheduleRange,
} from "./planning-validation";
import { ApiError, boundedText, readJson } from "./validation";

type BudgetRow = typeof budgetLimits.$inferSelect;
type ScheduleRow = typeof recurringSchedules.$inferSelect;
type PlanningTable = typeof budgetLimits | typeof recurringSchedules;

function access(
  table: PlanningTable,
  ownerId: string,
  coupleId?: string | null,
) {
  return or(
    and(eq(table.scope, "personal"), eq(table.ownerId, ownerId)),
    and(
      eq(table.scope, "couple"),
      coupleId === undefined ? undefined : eq(table.coupleId, coupleId ?? ""),
      sql`EXISTS (SELECT 1 FROM couple_members viewer WHERE viewer.user_id = ${ownerId} AND viewer.couple_id = ${table.coupleId})`,
    ),
  );
}

async function scopeInfo(context: Context, scope: PlanScope) {
  if (scope === "personal")
    return { coupleId: null, scopeKey: `personal:${context.user.userId}` };
  const [member] = await context.db
    .select()
    .from(coupleMembers)
    .where(eq(coupleMembers.userId, context.user.userId))
    .limit(1);
  if (!member)
    throw new ApiError(
      400,
      "Conecte o casal antes de criar um planejamento conjunto.",
    );
  return { coupleId: member.coupleId, scopeKey: `couple:${member.coupleId}` };
}

function budgetValue(row: BudgetRow, ownerName: string): BudgetLimit {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName,
    scope: row.scope,
    month: row.month,
    category: row.category,
    limitCents: row.limitCents,
    canEdit: true,
  };
}

function scheduleValue(row: ScheduleRow, ownerName: string): RecurringSchedule {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName,
    scope: row.scope,
    name: row.name,
    kind: row.kind,
    category: row.category,
    amountCents: row.amountCents,
    frequency: row.frequency,
    startDate: row.startDate,
    endDate: row.endDate,
    active: row.active,
    canEdit: true,
  };
}

async function ownerName(context: Context, id: string): Promise<string> {
  const [owner] = await context.db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return owner?.name ?? "";
}

async function getSchedule(context: Context, id: string): Promise<ScheduleRow> {
  boundedText(id, "Compromisso", 100);
  const [schedule] = await context.db
    .select()
    .from(recurringSchedules)
    .where(
      and(
        eq(recurringSchedules.id, id),
        access(recurringSchedules, context.user.userId),
      ),
    )
    .limit(1);
  if (!schedule) throw new ApiError(404, "Compromisso não encontrado.");
  return schedule;
}

export async function getPlanningState(
  context: Context,
  coupleId: string | null,
) {
  const viewerId = context.user.userId;
  const [budgets, schedules, occurrenceRows] = await Promise.all([
    context.db
      .select({ row: budgetLimits, ownerName: users.displayName })
      .from(budgetLimits)
      .innerJoin(users, eq(users.id, budgetLimits.ownerId))
      .where(access(budgetLimits, viewerId, coupleId))
      .orderBy(asc(budgetLimits.month), asc(budgetLimits.category)),
    context.db
      .select({ row: recurringSchedules, ownerName: users.displayName })
      .from(recurringSchedules)
      .innerJoin(users, eq(users.id, recurringSchedules.ownerId))
      .where(access(recurringSchedules, viewerId, coupleId))
      .orderBy(asc(recurringSchedules.name)),
    context.db
      .select({
        occurrence: scheduleOccurrences,
        schedule: recurringSchedules,
        transaction: transactions,
        transactionOwnerCoupleId: coupleMembers.coupleId,
      })
      .from(scheduleOccurrences)
      .innerJoin(
        recurringSchedules,
        eq(recurringSchedules.id, scheduleOccurrences.scheduleId),
      )
      .leftJoin(
        transactions,
        eq(transactions.id, scheduleOccurrences.transactionId),
      )
      .leftJoin(coupleMembers, eq(coupleMembers.userId, transactions.ownerId))
      .where(access(recurringSchedules, viewerId, coupleId))
      .orderBy(asc(scheduleOccurrences.dueDate)),
  ]);
  const occurrences: ScheduleOccurrence[] = occurrenceRows.map(
    ({ occurrence, schedule, transaction, transactionOwnerCoupleId }) => {
      const visible =
        transaction &&
        transaction.kind === schedule.kind &&
        (schedule.scope === "personal"
          ? transaction.ownerId === viewerId && !transaction.shared
          : transaction.shared &&
            transaction.sharedCoupleId === schedule.coupleId &&
            transactionOwnerCoupleId === schedule.coupleId);
      // If sharing was removed, keep the explicit calendar confirmation without
      // exposing a private financial id. Deleted ledger rows have a NULL FK and
      // remain linked/NULL so the client can display them as planned again.
      return {
        id: occurrence.id,
        scheduleId: occurrence.scheduleId,
        dueDate: occurrence.dueDate,
        state:
          occurrence.state === "linked" &&
          occurrence.transactionId !== null &&
          !visible
            ? "confirmed"
            : occurrence.state,
        transactionId: visible ? occurrence.transactionId : null,
        confirmedBy: occurrence.confirmedBy,
      };
    },
  );
  return {
    budgets: budgets.map(({ row, ownerName }) => budgetValue(row, ownerName)),
    schedules: schedules.map(({ row, ownerName }) =>
      scheduleValue(row, ownerName),
    ),
    occurrences,
  };
}

export async function saveBudget(context: Context, request: Request) {
  const input = validateBudget(await readJson(request));
  const info = await scopeInfo(context, input.scope);
  const [row] = await context.db
    .insert(budgetLimits)
    .values({
      ...input,
      ...info,
      categoryKey: categoryKey(input.category),
      ownerId: context.user.userId,
      id: crypto.randomUUID(),
    })
    .onConflictDoUpdate({
      target: [
        budgetLimits.scopeKey,
        budgetLimits.month,
        budgetLimits.categoryKey,
      ],
      set: { category: input.category, limitCents: input.limitCents },
    })
    .returning();
  return { budget: budgetValue(row, await ownerName(context, row.ownerId)) };
}

export async function updateBudget(
  context: Context,
  request: Request,
  id: string,
) {
  boundedText(id, "Orçamento", 100);
  const patch = validateBudgetPatch(await readJson(request));
  const [row] = await context.db
    .update(budgetLimits)
    .set(patch)
    .where(
      and(eq(budgetLimits.id, id), access(budgetLimits, context.user.userId)),
    )
    .returning();
  if (!row) throw new ApiError(404, "Orçamento não encontrado.");
  return { budget: budgetValue(row, await ownerName(context, row.ownerId)) };
}

export async function deleteBudget(context: Context, id: string) {
  boundedText(id, "Orçamento", 100);
  const rows = await context.db
    .delete(budgetLimits)
    .where(
      and(eq(budgetLimits.id, id), access(budgetLimits, context.user.userId)),
    )
    .returning({ id: budgetLimits.id });
  if (!rows.length) throw new ApiError(404, "Orçamento não encontrado.");
  return { deleted: true };
}

export async function copyBudgets(context: Context, request: Request) {
  const input = validateBudgetCopy(await readJson(request));
  const info = await scopeInfo(context, input.scope);
  const results = await context.d1.batch([
    context.d1
      .prepare(
        `SELECT COUNT(*) AS count FROM budget_limits b WHERE b.scope_key = ? AND b.month = ? AND ((b.scope = 'personal' AND b.owner_id = ?) OR (b.scope = 'couple' AND EXISTS (SELECT 1 FROM couple_members viewer WHERE viewer.user_id = ? AND viewer.couple_id = b.couple_id)))`,
      )
      .bind(
        info.scopeKey,
        input.fromMonth,
        context.user.userId,
        context.user.userId,
      ),
    context.d1
      .prepare(COPY_BUDGETS_SQL)
      .bind(context.user.userId, input.toMonth, info.scopeKey, input.fromMonth),
  ]);
  const count = Number(
    (results[0].results[0] as { count?: number } | undefined)?.count ?? 0,
  );
  const copied = results[1].meta.changes;
  return { copied, skipped: count - copied };
}

export async function createSchedule(context: Context, request: Request) {
  const input = validateSchedule(await readJson(request));
  const info = await scopeInfo(context, input.scope);
  const [row] = await context.db
    .insert(recurringSchedules)
    .values({
      ...input,
      coupleId: info.coupleId,
      ownerId: context.user.userId,
      id: crypto.randomUUID(),
    })
    .returning();
  return { schedule: scheduleValue(row, context.user.displayName) };
}

export async function updateSchedule(
  context: Context,
  request: Request,
  id: string,
) {
  const patch = validateSchedule(await readJson(request), true);
  const current = await getSchedule(context, id);
  validateScheduleRange(
    patch.startDate ?? current.startDate,
    patch.endDate === undefined ? current.endDate : patch.endDate,
  );
  const [row] = await context.db
    .update(recurringSchedules)
    .set(patch)
    .where(
      and(
        eq(recurringSchedules.id, id),
        access(recurringSchedules, context.user.userId),
        eq(recurringSchedules.startDate, current.startDate),
        sql`${recurringSchedules.endDate} IS ${current.endDate}`,
      ),
    )
    .returning();
  if (!row)
    throw new ApiError(
      409,
      "O compromisso mudou. Atualize a página e tente novamente.",
    );
  return {
    schedule: scheduleValue(row, await ownerName(context, row.ownerId)),
  };
}

export async function deleteSchedule(context: Context, id: string) {
  boundedText(id, "Compromisso", 100);
  const rows = await context.db
    .delete(recurringSchedules)
    .where(
      and(
        eq(recurringSchedules.id, id),
        access(recurringSchedules, context.user.userId),
      ),
    )
    .returning({ id: recurringSchedules.id });
  if (!rows.length) throw new ApiError(404, "Compromisso não encontrado.");
  return { deleted: true };
}

function uniqueConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /UNIQUE constraint failed.*schedule_occurrences\.transaction_id/i.test(
      error.message,
    ) ||
    (error.cause !== undefined && uniqueConflict(error.cause))
  );
}

export async function saveOccurrence(
  context: Context,
  request: Request,
  id: string,
) {
  const input = validateOccurrence(await readJson(request));
  const schedule = await getSchedule(context, id);
  const value = scheduleValue(schedule, "");
  const validDueDate = scheduleDates(value, input.dueDate.slice(0, 7), {
    includeInactive: true,
  }).includes(input.dueDate);
  if (!validDueDate) {
    // Editing a recurrence keeps historical markers visible. Allow clearing an
    // existing marker, while never creating one outside the current calendar.
    const [recorded] =
      input.action === "reset"
        ? await context.db
            .select({ id: scheduleOccurrences.id })
            .from(scheduleOccurrences)
            .where(
              and(
                eq(scheduleOccurrences.scheduleId, id),
                eq(scheduleOccurrences.dueDate, input.dueDate),
              ),
            )
            .limit(1)
        : [];
    if (!recorded)
      throw new ApiError(
        400,
        "O vencimento não faz parte do calendário deste compromisso.",
      );
  }
  if (input.action === "reset") {
    await context.d1
      .prepare(RESET_OCCURRENCE_SQL)
      .bind(context.user.userId, id, input.dueDate)
      .run();
    return { reset: true };
  }
  const transactionId = input.transactionId ?? null;
  const state =
    input.action === "link"
      ? "linked"
      : input.action === "skip"
        ? "skipped"
        : "confirmed";
  try {
    const row = await context.d1
      .prepare(SET_OCCURRENCE_SQL)
      .bind(
        context.user.userId,
        crypto.randomUUID(),
        input.dueDate,
        state,
        transactionId,
        id,
        schedule.frequency,
        schedule.startDate,
        schedule.endDate,
        transactionId,
        transactionId,
      )
      .first<ScheduleOccurrence>();
    if (!row)
      throw new ApiError(
        409,
        "O compromisso ou o lançamento não está mais disponível para este planejamento. Atualize a página.",
      );
    return { occurrence: row };
  } catch (error) {
    if (uniqueConflict(error))
      throw new ApiError(
        409,
        "Esse lançamento já está vinculado a outra ocorrência.",
      );
    throw error;
  }
}
