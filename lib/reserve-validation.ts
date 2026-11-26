import type { ReservePlanInput } from "./reserve-types.ts";
import { validMonth } from "./planning-validation.ts";
import { allowedKeys, ApiError, money, record } from "./validation.ts";

function nonnegative(value: unknown): number {
  const result = money(value);
  if (result < 0)
    throw new ApiError(400, "Informe valores iguais ou maiores que zero.");
  return result;
}

export function validateReservePlan(value: unknown): ReservePlanInput {
  const input = record(value);
  allowedKeys(input, [
    "month",
    "minimumBalanceCents",
    "extraExpenseCents",
    "cardReserveCents",
    "goalReserveCents",
    "sharedCommitmentCents",
  ]);
  return {
    month: validMonth(input.month),
    minimumBalanceCents: nonnegative(input.minimumBalanceCents),
    extraExpenseCents: nonnegative(input.extraExpenseCents),
    cardReserveCents:
      input.cardReserveCents === null
        ? null
        : nonnegative(input.cardReserveCents),
    goalReserveCents:
      input.goalReserveCents === null
        ? null
        : nonnegative(input.goalReserveCents),
    sharedCommitmentCents:
      input.sharedCommitmentCents === null
        ? null
        : nonnegative(input.sharedCommitmentCents),
  };
}
