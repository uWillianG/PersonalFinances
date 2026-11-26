import type { Source, Transaction } from "./types";

export interface CardCycle {
  sourceId: string;
  closingDay: number;
  dueDay: number;
}
export interface CardInvoice {
  id: string;
  sourceId: string;
  month: string;
  confirmedTotalCents: number | null;
}
export interface InvoicePayment {
  id: string;
  invoiceId: string;
  transactionId: string;
  amountCents: number;
}
export type InvoiceKey = Pick<CardInvoice, "sourceId" | "month">;
export type InvoiceInput = InvoiceKey &
  Pick<CardInvoice, "confirmedTotalCents">;
export type InvoicePaymentInput = Pick<
  InvoicePayment,
  "transactionId" | "amountCents"
>;
export interface InvoiceSummary extends InvoiceKey {
  id: string | null;
  source: Source;
  closingDate: string | null;
  dueDate: string | null;
  transactions: Transaction[];
  computedTotalCents: number;
  totalCents: number;
  confirmed: boolean;
  paidCents: number;
  remainingCents: number;
  creditCents: number;
  status: "unverified" | "open" | "partial" | "paid";
  pastDue: boolean;
  payments: (InvoicePayment & { transaction: Transaction })[];
}
