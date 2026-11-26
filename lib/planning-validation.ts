import type {
  BudgetInput,
  PlanScope,
  ScheduleInput,
} from "./planning-types.ts";
import { categoryKey } from "./planning.ts";
import {
  allowedKeys,
  ApiError,
  boundedText,
  money,
  record,
  validDate,
} from "./validation.ts";

export function validMonth(value: unknown, name = "Mês"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value))
    throw new ApiError(400, `${name} deve usar AAAA-MM.`);
  validDate(`${value}-01`, name);
  return value;
}

function scope(value: unknown): PlanScope {
  if (value !== "personal" && value !== "couple")
    throw new ApiError(400, "Escolha um planejamento pessoal ou do casal.");
  return value;
}

function positiveMoney(value: unknown): number {
  const cents = money(value);
  if (cents <= 0) throw new ApiError(400, "Informe um valor maior que zero.");
  return cents;
}

function category(value: unknown): string {
  const label = boundedText(value, "Categoria", 100);
  if (!categoryKey(label))
    throw new ApiError(400, "Informe uma categoria válida.");
  return label;
}

export function validateBudget(value: unknown): BudgetInput {
  const input = record(value);
  allowedKeys(input, ["scope", "month", "category", "limitCents"]);
  return {
    scope: scope(input.scope),
    month: validMonth(input.month),
    category: category(input.category),
    limitCents: positiveMoney(input.limitCents),
  };
}

export function validateBudgetPatch(value: unknown): { limitCents: number } {
  const input = record(value);
  allowedKeys(input, ["limitCents"]);
  return { limitCents: positiveMoney(input.limitCents) };
}

export function validateBudgetCopy(value: unknown): {
  scope: PlanScope;
  fromMonth: string;
  toMonth: string;
} {
  const input = record(value);
  allowedKeys(input, ["scope", "fromMonth", "toMonth"]);
  const fromMonth = validMonth(input.fromMonth, "Mês de origem");
  const toMonth = validMonth(input.toMonth, "Mês de destino");
  if (fromMonth === toMonth)
    throw new ApiError(400, "Escolha um mês de destino diferente da origem.");
  return { scope: scope(input.scope), fromMonth, toMonth };
}

export type SchedulePatch = Partial<Omit<ScheduleInput, "scope">>;
const scheduleKeys = [
  "name",
  "kind",
  "category",
  "amountCents",
  "frequency",
  "startDate",
  "endDate",
  "active",
];

export function validateScheduleRange(
  startDate: string,
  endDate: string | null,
): void {
  if (endDate !== null && endDate < startDate)
    throw new ApiError(
      400,
      "A data final deve ser igual ou posterior à data inicial.",
    );
}

export function validateSchedule(value: unknown): ScheduleInput;
export function validateSchedule(value: unknown, partial: true): SchedulePatch;
export function validateSchedule(
  value: unknown,
  partial = false,
): ScheduleInput | SchedulePatch {
  const input = record(value);
  allowedKeys(input, partial ? scheduleKeys : ["scope", ...scheduleKeys]);
  const result: SchedulePatch = {};
  const wants = (key: string) => !partial || Object.hasOwn(input, key);
  if (wants("name"))
    result.name = boundedText(input.name, "Nome do compromisso", 160);
  if (wants("category")) result.category = category(input.category);
  if (wants("kind")) {
    if (
      input.kind !== "income" &&
      input.kind !== "expense" &&
      input.kind !== "card_payment"
    )
      throw new ApiError(400, "Tipo de compromisso inválido.");
    result.kind = input.kind;
  }
  if (wants("amountCents"))
    result.amountCents = positiveMoney(input.amountCents);
  if (wants("frequency")) {
    if (
      input.frequency !== "weekly" &&
      input.frequency !== "monthly" &&
      input.frequency !== "yearly"
    )
      throw new ApiError(400, "Frequência inválida.");
    result.frequency = input.frequency;
  }
  if (wants("startDate"))
    result.startDate = validDate(input.startDate, "Data inicial");
  if (wants("endDate"))
    result.endDate =
      input.endDate === null ? null : validDate(input.endDate, "Data final");
  if (wants("active")) {
    if (typeof input.active !== "boolean")
      throw new ApiError(400, "Ativo deve ser verdadeiro ou falso.");
    result.active = input.active;
  }
  if (!Object.keys(result).length)
    throw new ApiError(400, "Informe ao menos um campo para alterar.");
  if (result.startDate && result.endDate !== undefined)
    validateScheduleRange(result.startDate, result.endDate);
  return partial
    ? result
    : {
        ...(result as Omit<ScheduleInput, "scope">),
        scope: scope(input.scope),
      };
}

export type OccurrenceInput = {
  dueDate: string;
  action: "confirm" | "skip" | "reset" | "link";
  transactionId?: string;
};
export function validateOccurrence(value: unknown): OccurrenceInput {
  const input = record(value);
  allowedKeys(input, ["dueDate", "action", "transactionId"]);
  const dueDate = validDate(input.dueDate, "Vencimento");
  if (
    input.action !== "confirm" &&
    input.action !== "skip" &&
    input.action !== "reset" &&
    input.action !== "link"
  )
    throw new ApiError(400, "Ação de compromisso inválida.");
  if (input.action === "link")
    return {
      dueDate,
      action: input.action,
      transactionId: boundedText(input.transactionId, "Lançamento", 100),
    };
  if (Object.hasOwn(input, "transactionId"))
    throw new ApiError(
      400,
      "Informe um lançamento apenas ao vincular uma ocorrência.",
    );
  return { dueDate, action: input.action };
}
