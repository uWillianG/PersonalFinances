import type {
  CardCycle,
  InvoiceInput,
  InvoicePaymentInput,
} from "./invoice-types.ts";
import { validMonth } from "./planning-validation.ts";
import {
  allowedKeys,
  ApiError,
  boundedText,
  money,
  record,
} from "./validation.ts";

function day(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 31
  )
    throw new ApiError(400, "Informe um dia entre 1 e 31.");
  return value;
}
export function validateCardCycle(value: unknown): Omit<CardCycle, "sourceId"> {
  const input = record(value);
  allowedKeys(input, ["closingDay", "dueDay"]);
  return { closingDay: day(input.closingDay), dueDay: day(input.dueDay) };
}
export function validateInvoice(value: unknown): InvoiceInput {
  const input = record(value);
  allowedKeys(input, [
    "sourceId",
    "month",
    "confirmedTotalCents",
    "ensureOnly",
  ]);
  if (input.ensureOnly !== undefined && typeof input.ensureOnly !== "boolean")
    throw new ApiError(400, "A opção de criação deve ser verdadeira ou falsa.");
  const amount =
    input.confirmedTotalCents === null
      ? null
      : money(input.confirmedTotalCents);
  if (amount !== null && amount < 0)
    throw new ApiError(
      400,
      "O total da fatura deve ser igual ou maior que zero.",
    );
  if (input.ensureOnly === true && amount !== null)
    throw new ApiError(
      400,
      "Criar uma fatura pendente não altera o total conferido.",
    );
  return {
    sourceId: boundedText(input.sourceId, "Cartão", 100),
    month: validMonth(input.month),
    confirmedTotalCents: amount,
  };
}
export function validateInvoicePayment(value: unknown): InvoicePaymentInput {
  const input = record(value);
  allowedKeys(input, ["transactionId", "amountCents"]);
  const amountCents = money(input.amountCents);
  if (amountCents <= 0)
    throw new ApiError(400, "Informe um pagamento maior que zero.");
  return {
    transactionId: boundedText(input.transactionId, "Pagamento", 100),
    amountCents,
  };
}
