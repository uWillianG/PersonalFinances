import type { GoalInput, GoalMovementInput, GoalPatch } from "./goals-types.ts";
import { todayISO } from "./planning.ts";
import {
  allowedKeys,
  ApiError,
  boundedText,
  money,
  record,
  validDate,
} from "./validation.ts";

function positiveMoney(value: unknown): number {
  const amount = money(value);
  if (amount <= 0) throw new ApiError(400, "Informe um valor maior que zero.");
  return amount;
}

export function validateGoal(value: unknown): GoalInput;
export function validateGoal(value: unknown, partial: true): GoalPatch;
export function validateGoal(
  value: unknown,
  partial = false,
): GoalInput | GoalPatch {
  const input = record(value);
  const keys = ["name", "targetCents", "targetDate", "archived"];
  allowedKeys(input, partial ? keys : ["scope", ...keys]);
  const output: GoalPatch = {};
  const wants = (key: string) => !partial || Object.hasOwn(input, key);
  if (wants("name")) output.name = boundedText(input.name, "Nome da meta", 160);
  if (wants("targetCents"))
    output.targetCents = positiveMoney(input.targetCents);
  if (wants("targetDate"))
    output.targetDate =
      input.targetDate === null
        ? null
        : validDate(input.targetDate, "Prazo da meta");
  if (wants("archived")) {
    if (typeof input.archived !== "boolean")
      throw new ApiError(400, "Arquivada deve ser verdadeiro ou falso.");
    output.archived = input.archived;
  }
  if (!Object.keys(output).length)
    throw new ApiError(400, "Informe ao menos um campo para alterar.");
  if (partial) return output;
  if (input.scope !== "personal" && input.scope !== "couple")
    throw new ApiError(400, "Escolha uma meta pessoal ou do casal.");
  return { ...output, scope: input.scope } as GoalInput;
}

export function validateGoalMovement(
  value: unknown,
  today = todayISO(),
): GoalMovementInput {
  const input = record(value);
  allowedKeys(input, ["id", "kind", "amountCents", "date", "note"]);
  if (
    typeof input.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.id,
    )
  )
    throw new ApiError(400, "Identificador de movimento inválido.");
  if (input.kind !== "deposit" && input.kind !== "withdrawal")
    throw new ApiError(400, "Escolha um aporte ou resgate.");
  const date = validDate(input.date, "Data do movimento");
  if (date > today)
    throw new ApiError(
      400,
      "Registre apenas aportes e resgates já realizados.",
    );
  return {
    id: input.id.toLowerCase(),
    kind: input.kind,
    amountCents: positiveMoney(input.amountCents),
    date,
    note: boundedText(input.note, "Observação", 250, true),
  };
}

export function validateGoalPatch(value: unknown): GoalPatch {
  return validateGoal(value, true);
}
