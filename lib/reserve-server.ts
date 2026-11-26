import type { Context } from "./server";
import type { ReservePlan } from "./reserve-types";
import {
  READ_RESERVE_PLANS_SQL,
  SAVE_RESERVE_PLAN_SQL,
  DELETE_RESERVE_PLAN_SQL,
} from "./reserve-statements";
import { validateReservePlan } from "./reserve-validation";
import { validMonth } from "./planning-validation";
import { ApiError, readJson } from "./validation";

export async function getReserveState(
  context: Context,
): Promise<{ reservePlans: ReservePlan[] }> {
  const result = await context.d1
    .prepare(READ_RESERVE_PLANS_SQL)
    .bind(context.user.userId)
    .all<ReservePlan>();
  return { reservePlans: result.results };
}

export async function saveReservePlan(context: Context, request: Request) {
  const input = validateReservePlan(await readJson(request));
  const plan = await context.d1
    .prepare(SAVE_RESERVE_PLAN_SQL)
    .bind(
      crypto.randomUUID(),
      context.user.userId,
      input.month,
      input.minimumBalanceCents,
      input.extraExpenseCents,
      input.cardReserveCents,
      input.goalReserveCents,
      input.sharedCommitmentCents,
    )
    .first<ReservePlan>();
  if (!plan)
    throw new ApiError(
      409,
      "Não foi possível salvar os ajustes. Tente novamente.",
    );
  return { plan };
}

export async function deleteReservePlan(context: Context, month: string) {
  const selected = validMonth(month);
  await context.d1
    .prepare(DELETE_RESERVE_PLAN_SQL)
    .bind(context.user.userId, selected)
    .run();
  return { deleted: true };
}
