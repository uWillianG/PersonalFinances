import { sql } from "drizzle-orm";
import { todayISO } from "./planning.ts";
import type { TransactionPatch } from "./validation.ts";

/** Recheck links in the UPDATE itself: another request may have allocated the
 * payment after the friendly API precheck read an unlinked transaction. */
export function invoicePaymentEditGuard(
  patch: TransactionPatch,
  today = todayISO(),
) {
  return sql`(
    NOT EXISTS (SELECT 1 FROM invoice_payments linked WHERE linked.transaction_id = transactions.id)
    OR (
      COALESCE(${patch.kind ?? null}, transactions.kind) = 'card_payment'
      AND COALESCE(${patch.amountCents ?? null}, transactions.amount_cents) >= (
        SELECT COALESCE(SUM(linked.amount_cents), 0) FROM invoice_payments linked
        WHERE linked.transaction_id = transactions.id
      )
      AND COALESCE(${patch.date ?? null}, transactions.date) <= ${today}
    )
  )`;
}
