import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { coupleMembers, goalMovements, savingsGoals, users } from "@/db/schema";
import type { Context } from "./server";
import type {
  GoalMovement,
  GoalMovementInput,
  SavingsGoal,
} from "./goals-types";
import {
  ADD_GOAL_MOVEMENT_SQL,
  CREATE_GOAL_SQL,
  DELETE_EMPTY_GOAL_SQL,
} from "./goals-statements";
import { validateGoal, validateGoalMovement } from "./goals-validation";
import { ApiError, boundedText, readJson } from "./validation";

type GoalRow = typeof savingsGoals.$inferSelect;
type MovementRow = typeof goalMovements.$inferSelect;

function access(viewerId: string, coupleId?: string | null) {
  return or(
    and(eq(savingsGoals.scope, "personal"), eq(savingsGoals.ownerId, viewerId)),
    and(
      eq(savingsGoals.scope, "couple"),
      coupleId === undefined
        ? undefined
        : eq(savingsGoals.coupleId, coupleId ?? ""),
      sql`EXISTS (SELECT 1 FROM couple_members viewer WHERE viewer.user_id = ${viewerId} AND viewer.couple_id = ${savingsGoals.coupleId})`,
    ),
  );
}

function goalValue(row: GoalRow, ownerName: string): SavingsGoal {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName,
    scope: row.scope,
    name: row.name,
    targetCents: row.targetCents,
    targetDate: row.targetDate,
    archived: row.archived,
    canEdit: true,
  };
}

function movementValue(row: MovementRow, ownerName: string): GoalMovement {
  return { ...row, ownerName };
}

async function getGoal(context: Context, id: string) {
  boundedText(id, "Meta", 100);
  const [goal] = await context.db
    .select({ row: savingsGoals, ownerName: users.displayName })
    .from(savingsGoals)
    .innerJoin(users, eq(users.id, savingsGoals.ownerId))
    .where(and(eq(savingsGoals.id, id), access(context.user.userId)))
    .limit(1);
  if (!goal) throw new ApiError(404, "Meta não encontrada.");
  return goal;
}

export async function getGoalsState(context: Context, coupleId: string | null) {
  const [goals, movements] = await Promise.all([
    context.db
      .select({ row: savingsGoals, ownerName: users.displayName })
      .from(savingsGoals)
      .innerJoin(users, eq(users.id, savingsGoals.ownerId))
      .where(access(context.user.userId, coupleId))
      .orderBy(asc(savingsGoals.archived), asc(savingsGoals.name)),
    context.db
      .select({ row: goalMovements, ownerName: users.displayName })
      .from(goalMovements)
      .innerJoin(savingsGoals, eq(savingsGoals.id, goalMovements.goalId))
      .innerJoin(users, eq(users.id, goalMovements.ownerId))
      .where(access(context.user.userId, coupleId))
      .orderBy(
        desc(goalMovements.date),
        desc(goalMovements.createdAt),
        asc(goalMovements.id),
      ),
  ]);
  return {
    goals: goals.map(({ row, ownerName }) => goalValue(row, ownerName)),
    goalMovements: movements.map(({ row, ownerName }) =>
      movementValue(row, ownerName),
    ),
  };
}

export async function createGoal(context: Context, request: Request) {
  const input = validateGoal(await readJson(request));
  let coupleId: string | null = null;
  if (input.scope === "couple") {
    const [member] = await context.db
      .select()
      .from(coupleMembers)
      .where(eq(coupleMembers.userId, context.user.userId))
      .limit(1);
    if (!member)
      throw new ApiError(
        400,
        "Conecte o casal antes de criar uma meta conjunta.",
      );
    coupleId = member.coupleId;
  }
  const id = crypto.randomUUID();
  const row = await context.d1
    .prepare(CREATE_GOAL_SQL)
    .bind(
      id,
      context.user.userId,
      coupleId,
      input.scope,
      input.name,
      input.targetCents,
      input.targetDate,
      input.archived ? 1 : 0,
    )
    .first<{ id: string }>();
  if (!row)
    throw new ApiError(
      409,
      "O casal mudou. Atualize a página e tente novamente.",
    );
  const goal = await getGoal(context, id);
  return { goal: goalValue(goal.row, goal.ownerName) };
}

export async function updateGoal(
  context: Context,
  id: string,
  request: Request,
) {
  boundedText(id, "Meta", 100);
  const patch = validateGoal(await readJson(request), true);
  const [row] = await context.db
    .update(savingsGoals)
    .set(patch)
    .where(and(eq(savingsGoals.id, id), access(context.user.userId)))
    .returning();
  if (!row) throw new ApiError(404, "Meta não encontrada.");
  const goal = await getGoal(context, id);
  return { goal: goalValue(goal.row, goal.ownerName) };
}

export async function deleteGoal(context: Context, id: string) {
  await getGoal(context, id);
  const deleted = await context.d1
    .prepare(DELETE_EMPTY_GOAL_SQL)
    .bind(context.user.userId, id)
    .first<{ id: string }>();
  if (!deleted)
    throw new ApiError(
      409,
      "Metas com movimentações mantêm seu histórico. Arquive a meta para encerrar o planejamento.",
    );
  return { deleted: true };
}

async function existingMovement(context: Context, id: string) {
  const [existing] = await context.db
    .select({ row: goalMovements, ownerName: users.displayName })
    .from(goalMovements)
    .innerJoin(savingsGoals, eq(savingsGoals.id, goalMovements.goalId))
    .innerJoin(users, eq(users.id, goalMovements.ownerId))
    .where(and(eq(goalMovements.id, id), access(context.user.userId)))
    .limit(1);
  return existing;
}

function sameMovement(
  row: MovementRow,
  goalId: string,
  ownerId: string,
  input: GoalMovementInput,
): boolean {
  return (
    row.goalId === goalId &&
    row.ownerId === ownerId &&
    row.kind === input.kind &&
    row.amountCents === input.amountCents &&
    row.date === input.date &&
    row.note === input.note
  );
}

export async function addGoalMovement(
  context: Context,
  id: string,
  request: Request,
) {
  const input = validateGoalMovement(await readJson(request));
  await getGoal(context, id);
  const existing = await existingMovement(context, input.id);
  if (existing) {
    if (!sameMovement(existing.row, id, context.user.userId, input))
      throw new ApiError(
        409,
        "Este identificador já foi usado em outro movimento.",
      );
    return { movement: movementValue(existing.row, existing.ownerName) };
  }
  await context.d1
    .prepare(ADD_GOAL_MOVEMENT_SQL)
    .bind(
      context.user.userId,
      input.id,
      id,
      input.kind,
      input.amountCents,
      input.date,
      input.note,
      new Date().toISOString(),
    )
    .first<{ id: string }>();
  // Also handles concurrent retries of the same id without adding money twice.
  const saved = await existingMovement(context, input.id);
  if (!saved || !sameMovement(saved.row, id, context.user.userId, input))
    throw new ApiError(
      409,
      "O movimento não pôde ser registrado. Confira o saldo reservado, o limite de valor e se a meta está arquivada; depois atualize a página.",
    );
  return { movement: movementValue(saved.row, saved.ownerName) };
}
