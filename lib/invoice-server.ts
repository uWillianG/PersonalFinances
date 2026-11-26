import type { Context } from "./server";
import type { CardCycle, CardInvoice, InvoicePayment } from "./invoice-types";
import { todayISO } from "./planning";
import {
  validateCardCycle,
  validateInvoice,
  validateInvoicePayment,
} from "./invoice-validation";
import {
  DELETE_INVOICE_PAYMENT_SQL,
  ENSURE_INVOICE_SQL,
  SAVE_CARD_CYCLE_SQL,
  SAVE_INVOICE_PAYMENT_SQL,
  SAVE_INVOICE_SQL,
} from "./invoice-statements";
import { ApiError, boundedText, readJson } from "./validation";
import type { TransactionPatch } from "./validation";
import type { SourceType } from "./types";

export async function ensureSourceTypeAllowed(
  context: Context,
  sourceId: string,
  newType: SourceType,
): Promise<void> {
  const actor = context.user.userId;
  if (newType !== "credit") {
    const configured = await context.d1
      .prepare(
        "SELECT 1 AS found FROM sources s WHERE s.id = ? AND s.owner_id = ? AND (EXISTS (SELECT 1 FROM card_cycles c WHERE c.source_id = s.id AND c.owner_id = s.owner_id) OR EXISTS (SELECT 1 FROM card_invoices i WHERE i.source_id = s.id AND i.owner_id = s.owner_id))",
      )
      .bind(sourceId, actor)
      .first();
    if (configured)
      throw new ApiError(
        400,
        "Este cartão já tem um ciclo ou faturas. Mantenha o tipo cartão de crédito para preservar seus vínculos.",
      );
  }
  if (newType !== "bank") {
    const allocated = await context.d1
      .prepare(
        "SELECT 1 AS found FROM transactions t JOIN invoice_payments p ON p.transaction_id = t.id AND p.owner_id = t.owner_id WHERE t.source_id = ? AND t.owner_id = ? LIMIT 1",
      )
      .bind(sourceId, actor)
      .first();
    if (allocated)
      throw new ApiError(
        400,
        "Esta conta tem pagamentos vinculados a faturas. Desvincule os pagamentos antes de alterar seu tipo.",
      );
  }
}

export async function ensureTransactionPaymentAllowed(
  context: Context,
  id: string,
  patch: TransactionPatch,
): Promise<void> {
  const row = await context.d1
    .prepare(
      "SELECT t.amount_cents AS amountCents, t.kind, t.date, COALESCE(SUM(p.amount_cents),0) AS allocatedCents FROM transactions t LEFT JOIN invoice_payments p ON p.transaction_id = t.id AND p.owner_id = t.owner_id WHERE t.id = ? AND t.owner_id = ? GROUP BY t.id",
    )
    .bind(id, context.user.userId)
    .first<{
      amountCents: number;
      kind: string;
      date: string;
      allocatedCents: number;
    }>();
  if (
    row &&
    row.allocatedCents > 0 &&
    ((patch.kind ?? row.kind) !== "card_payment" ||
      (patch.amountCents ?? row.amountCents) < row.allocatedCents ||
      (patch.date ?? row.date) > todayISO())
  )
    throw new ApiError(
      400,
      "Este pagamento está vinculado a faturas. Preserve o tipo, a data realizada e um valor suficiente, ou desvincule-o antes de corrigir.",
    );
}

export async function getInvoiceState(
  context: Context,
): Promise<{
  cardCycles: CardCycle[];
  cardInvoices: CardInvoice[];
  invoicePayments: InvoicePayment[];
}> {
  const actor = context.user.userId;
  const [cycles, invoices, payments] = await Promise.all([
    context.d1
      .prepare(
        "SELECT c.source_id AS sourceId, c.closing_day AS closingDay, c.due_day AS dueDay FROM card_cycles c JOIN sources s ON s.id = c.source_id AND s.owner_id = c.owner_id WHERE c.owner_id = ? AND s.type = 'credit' ORDER BY c.source_id",
      )
      .bind(actor)
      .all<CardCycle>(),
    context.d1
      .prepare(
        "SELECT i.id, i.source_id AS sourceId, i.month, i.confirmed_total_cents AS confirmedTotalCents FROM card_invoices i JOIN sources s ON s.id = i.source_id AND s.owner_id = i.owner_id WHERE i.owner_id = ? AND s.type = 'credit' ORDER BY i.month, i.source_id",
      )
      .bind(actor)
      .all<CardInvoice>(),
    context.d1
      .prepare(
        "SELECT p.id, p.invoice_id AS invoiceId, p.transaction_id AS transactionId, p.amount_cents AS amountCents FROM invoice_payments p JOIN card_invoices i ON i.id = p.invoice_id AND i.owner_id = p.owner_id JOIN transactions t ON t.id = p.transaction_id AND t.owner_id = p.owner_id JOIN sources s ON s.id = t.source_id AND s.owner_id = t.owner_id WHERE p.owner_id = ? AND t.kind = 'card_payment' AND s.type = 'bank' ORDER BY p.id",
      )
      .bind(actor)
      .all<InvoicePayment>(),
  ]);
  return {
    cardCycles: cycles.results,
    cardInvoices: invoices.results,
    invoicePayments: payments.results,
  };
}
export async function saveCardCycle(
  context: Context,
  sourceId: string,
  request: Request,
) {
  boundedText(sourceId, "Cartão", 100);
  const input = validateCardCycle(await readJson(request));
  const cycle = await context.d1
    .prepare(SAVE_CARD_CYCLE_SQL)
    .bind(input.closingDay, input.dueDay, sourceId, context.user.userId)
    .first<CardCycle>();
  if (!cycle)
    throw new ApiError(
      404,
      "Cartão não encontrado. Escolha um cartão de crédito seu.",
    );
  return { cycle };
}
export async function saveInvoice(context: Context, request: Request) {
  const raw = await readJson(request);
  const input = validateInvoice(raw);
  const invoice = await context.d1
    .prepare(raw.ensureOnly === true ? ENSURE_INVOICE_SQL : SAVE_INVOICE_SQL)
    .bind(
      crypto.randomUUID(),
      input.month,
      input.confirmedTotalCents,
      input.sourceId,
      context.user.userId,
    )
    .first<CardInvoice>();
  if (!invoice)
    throw new ApiError(
      404,
      "Cartão não encontrado. Escolha um cartão de crédito seu.",
    );
  return { invoice };
}
export async function saveInvoicePayment(
  context: Context,
  id: string,
  request: Request,
) {
  boundedText(id, "Fatura", 100);
  const input = validateInvoicePayment(await readJson(request));
  const payment = await context.d1
    .prepare(SAVE_INVOICE_PAYMENT_SQL)
    .bind(
      crypto.randomUUID(),
      context.user.userId,
      id,
      input.transactionId,
      input.amountCents,
      todayISO(),
    )
    .first<InvoicePayment>();
  if (!payment)
    throw new ApiError(
      409,
      "Não foi possível vincular. Escolha um pagamento de fatura já realizado em uma conta bancária sua e confira o valor ainda disponível para vincular.",
    );
  return { payment };
}
export async function deleteInvoicePayment(context: Context, id: string) {
  boundedText(id, "Vínculo", 100);
  const deleted = await context.d1
    .prepare(DELETE_INVOICE_PAYMENT_SQL)
    .bind(id, context.user.userId)
    .first<{ id: string }>();
  if (!deleted) throw new ApiError(404, "Vínculo de pagamento não encontrado.");
  return { deleted: true };
}
