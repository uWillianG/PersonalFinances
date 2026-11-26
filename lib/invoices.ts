import type { AppState, Transaction } from "./types.ts";
import type {
  CardCycle,
  InvoiceKey,
  InvoicePayment,
  InvoiceSummary,
} from "./invoice-types.ts";
import { todayISO } from "./planning.ts";

function unique<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.id) && !!seen.add(row.id));
}
function monthDate(month: string, day: number, offset = 0): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new RangeError("Mês inválido.");
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
export function invoiceDates(
  month: string,
  cycle?: CardCycle,
): { closingDate: string | null; dueDate: string | null } {
  monthDate(month, 1);
  if (!cycle) return { closingDate: null, dueDate: null };
  if (
    !Number.isInteger(cycle.closingDay) ||
    !Number.isInteger(cycle.dueDay) ||
    cycle.closingDay < 1 ||
    cycle.closingDay > 31 ||
    cycle.dueDay < 1 ||
    cycle.dueDay > 31
  )
    throw new RangeError("Dias do cartão inválidos.");
  return {
    closingDate: monthDate(
      month,
      cycle.closingDay,
      cycle.closingDay < cycle.dueDay ? 0 : -1,
    ),
    dueDate: monthDate(month, cycle.dueDay),
  };
}
function ownCards(data: AppState) {
  return data.sources.filter(
    (source) => source.ownerId === data.user.id && source.type === "credit",
  );
}
function bankPayments(data: AppState, asOf: string) {
  const banks = new Set(
    data.sources
      .filter(
        (source) => source.ownerId === data.user.id && source.type === "bank",
      )
      .map((source) => source.id),
  );
  return unique(
    data.transactions.filter(
      (tx) =>
        tx.ownerId === data.user.id &&
        banks.has(tx.sourceId) &&
        tx.kind === "card_payment" &&
        tx.date <= asOf,
    ),
  );
}
/** Validate every link against the current ledger; changed or removed payments
 * cannot continue to make an invoice appear paid. */
export function validInvoicePayments(
  data: AppState,
  asOf = todayISO(),
): InvoicePayment[] {
  const cards = new Set(ownCards(data).map((source) => source.id));
  const invoices = new Set(
    (data.cardInvoices ?? [])
      .filter((invoice) => cards.has(invoice.sourceId))
      .map((invoice) => invoice.id),
  );
  const transactions = new Map(
    bankPayments(data, asOf).map((tx) => [tx.id, tx]),
  );
  const pairs = new Set<string>();
  const links = unique(data.invoicePayments ?? []).filter((link) => {
    const pair = `${link.invoiceId}:${link.transactionId}`;
    if (
      !invoices.has(link.invoiceId) ||
      !transactions.has(link.transactionId) ||
      !Number.isSafeInteger(link.amountCents) ||
      link.amountCents <= 0 ||
      pairs.has(pair)
    )
      return false;
    pairs.add(pair);
    return true;
  });
  const allocated = new Map<string, number>();
  for (const link of links)
    allocated.set(
      link.transactionId,
      (allocated.get(link.transactionId) ?? 0) + link.amountCents,
    );
  return links.filter(
    (link) =>
      (allocated.get(link.transactionId) ?? 0) <=
      transactions.get(link.transactionId)!.amountCents,
  );
}
export function invoiceSummaries(
  data: AppState,
  month: string,
  asOf = todayISO(),
): InvoiceSummary[] {
  monthDate(month, 1);
  const transactions = unique(
    data.transactions.filter((tx) => tx.ownerId === data.user.id),
  );
  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  const links = validInvoicePayments(data, asOf);
  return ownCards(data).map((source) => {
    const invoice = (data.cardInvoices ?? []).find(
      (row) => row.sourceId === source.id && row.month === month,
    );
    const rows = transactions.filter(
      (tx) =>
        tx.sourceId === source.id &&
        tx.date.slice(0, 7) === month &&
        (tx.kind === "expense" || tx.kind === "refund"),
    );
    const computedTotalCents = rows.reduce(
      (total, tx) =>
        total + (tx.kind === "refund" ? -tx.amountCents : tx.amountCents),
      0,
    );
    const confirmed =
      invoice?.confirmedTotalCents !== null &&
      invoice?.confirmedTotalCents !== undefined;
    const totalCents = confirmed
      ? invoice!.confirmedTotalCents!
      : Math.max(0, computedTotalCents);
    const payments = links
      .filter((link) => link.invoiceId === invoice?.id)
      .map((link) => ({ ...link, transaction: byId.get(link.transactionId)! }));
    const paidCents = payments.reduce(
      (total, link) => total + link.amountCents,
      0,
    );
    const remainingCents = Math.max(0, totalCents - paidCents);
    const cycle = data.cardCycles?.find(
      (cycle) => cycle.sourceId === source.id,
    );
    const dates = invoiceDates(month, cycle);
    return {
      id: invoice?.id ?? null,
      sourceId: source.id,
      month,
      source,
      ...dates,
      transactions: rows,
      computedTotalCents,
      totalCents,
      confirmed,
      paidCents,
      remainingCents,
      creditCents:
        Math.max(0, paidCents - totalCents) +
        (confirmed ? 0 : Math.max(0, -computedTotalCents)),
      status: !confirmed
        ? "unverified"
        : remainingCents === 0
          ? "paid"
          : paidCents > 0
            ? "partial"
            : "open",
      pastDue:
        remainingCents > 0 && dates.dueDate !== null && dates.dueDate < asOf,
      payments,
    };
  });
}
export function paymentCandidates(
  data: AppState,
  key: InvoiceKey,
  asOf = todayISO(),
) {
  const invoice = (data.cardInvoices ?? []).find(
    (row) => row.sourceId === key.sourceId && row.month === key.month,
  );
  const links = validInvoicePayments(data, asOf);
  return bankPayments(data, asOf)
    .map((transaction) => {
      const ownLinks = links.filter(
        (link) => link.transactionId === transaction.id,
      );
      const allocatedCents = ownLinks.reduce(
        (sum, link) => sum + link.amountCents,
        0,
      );
      const currentAllocationCents =
        ownLinks.find((link) => link.invoiceId === invoice?.id)?.amountCents ??
        0;
      return {
        transaction,
        allocatedCents,
        availableCents: Math.max(0, transaction.amountCents - allocatedCents),
        currentAllocationCents,
      };
    })
    .filter(
      (candidate) =>
        candidate.availableCents + candidate.currentAllocationCents > 0,
    )
    .sort(
      (a, b) =>
        b.transaction.date.localeCompare(a.transaction.date) ||
        a.transaction.id.localeCompare(b.transaction.id),
    );
}
/** Unpaid balances through the selected month include older reconciled bills.
 * Payment month alone never identifies the bill that was settled. */
export function invoiceProtection(
  data: AppState,
  month: string,
  asOf = todayISO(),
) {
  monthDate(month, 1);
  const cards = new Set(ownCards(data).map((source) => source.id));
  const known = {
    ...data,
    transactions: data.transactions.filter((tx) => tx.date <= asOf),
  };
  const months = new Set<string>([month]);
  for (const tx of known.transactions)
    if (
      tx.ownerId === data.user.id &&
      cards.has(tx.sourceId) &&
      tx.date.slice(0, 7) <= month &&
      (tx.kind === "expense" || tx.kind === "refund")
    )
      months.add(tx.date.slice(0, 7));
  for (const invoice of data.cardInvoices ?? [])
    if (cards.has(invoice.sourceId) && invoice.month <= month)
      months.add(invoice.month);
  const summaries = [...months]
    .flatMap((selected) => invoiceSummaries(known, selected, asOf))
    .filter((row) => row.totalCents > 0 || row.id !== null);
  const pendingCents = summaries.reduce(
    (sum, row) => sum + row.remainingCents,
    0,
  );
  const unverifiedCount = summaries.filter(
    (row) => !row.confirmed && row.remainingCents > 0,
  ).length;
  const links = validInvoicePayments(known, asOf);
  const unallocatedPaymentCents = bankPayments(known, asOf)
    .filter((tx) => tx.date.slice(0, 7) <= month)
    .reduce(
      (sum, tx) =>
        sum +
        Math.max(
          0,
          tx.amountCents -
            links
              .filter((link) => link.transactionId === tx.id)
              .reduce((value, link) => value + link.amountCents, 0),
        ),
      0,
    );
  const differingTotals = summaries.filter(
    (row) =>
      row.confirmed && row.totalCents !== Math.max(0, row.computedTotalCents),
  ).length;
  return {
    pendingCents,
    unverifiedCount,
    unallocatedPaymentCents,
    differingTotals,
    invoiceCount: summaries.length,
  };
}
