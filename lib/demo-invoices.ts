import type { CardCycle, CardInvoice, InvoicePayment } from "./invoice-types";
import type { Transaction } from "./types";

export function demoInvoices(
  month: string,
  transactions: Transaction[],
): {
  cardCycles: CardCycle[];
  cardInvoices: CardInvoice[];
  invoicePayments: InvoicePayment[];
} {
  const total = transactions
    .filter(
      (tx) => tx.sourceId === "demo-credit" && tx.date.slice(0, 7) === month,
    )
    .reduce(
      (sum, tx) =>
        sum +
        (tx.kind === "expense"
          ? tx.amountCents
          : tx.kind === "refund"
            ? -tx.amountCents
            : 0),
      0,
    );
  return {
    cardCycles: [{ sourceId: "demo-credit", closingDay: 3, dueDay: 10 }],
    cardInvoices: [
      {
        id: "demo-invoice-current",
        sourceId: "demo-credit",
        month,
        confirmedTotalCents: Math.max(0, total),
      },
    ],
    invoicePayments: [
      {
        id: "demo-invoice-payment",
        invoiceId: "demo-invoice-current",
        transactionId: "demo-tx-9",
        amountCents: Math.min(50000, Math.max(0, total)),
      },
    ],
  };
}
