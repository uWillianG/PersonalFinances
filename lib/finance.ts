import type { Source, Transaction } from "./types.ts";

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function monthIndex(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError(`Mês inválido: ${month}`);
  }
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber - 1;
}

function monthAt(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(month: string, amount: number): string {
  return monthAt(monthIndex(month) + amount);
}

export function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

export function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

export function monthLabel(month: string, short = false): string {
  monthIndex(month);
  return new Intl.DateTimeFormat("pt-BR", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function transactionsForMonth(
  transactions: readonly Transaction[],
  month: string,
): Transaction[] {
  monthIndex(month);
  return transactions.filter((transaction) => transaction.date.slice(0, 7) === month);
}

export function summarize(transactions: readonly Transaction[], month: string) {
  const selected = transactionsForMonth(transactions, month);
  let incomeCents = 0;
  let expenseCents = 0;
  let pendingCount = 0;
  for (const transaction of selected) {
    if (transaction.kind === "income") incomeCents += transaction.amountCents;
    if (transaction.kind === "expense") expenseCents += transaction.amountCents;
    if (transaction.kind === "refund") expenseCents -= transaction.amountCents;
    if (transaction.needsReview) pendingCount += 1;
  }
  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    count: selected.length,
    pendingCount,
  };
}

function balanceMovement(transaction: Transaction): number {
  switch (transaction.kind) {
    case "income":
    case "refund":
    case "transfer_in":
      return transaction.amountCents;
    case "expense":
    case "transfer_out":
    case "card_payment":
      return -transaction.amountCents;
  }
}

export function balancesForMonth(
  sources: readonly Source[],
  transactions: readonly Transaction[],
  month: string,
): {
  totalCents: number;
  items: { source: Source; balanceCents: number; complete: boolean }[];
  complete: boolean;
} {
  const exclusiveEnd = `${shiftMonth(month, 1)}-01`;
  const items = sources.filter((source) => source.type !== "credit").map((source) => {
    const hasBalanceDate = /^\d{4}-\d{2}-\d{2}$/.test(source.balanceDate);
    const beforeOpeningDate = hasBalanceDate && source.balanceDate > exclusiveEnd;
    const complete = source.hasOpeningBalance && hasBalanceDate && !beforeOpeningDate;
    // A reference at the next month's first day also describes this month's
    // closing balance, before any movements on that next day.
    let balanceCents = complete ? source.initialBalanceCents : 0;
    for (const transaction of transactions) {
      if (
        transaction.sourceId === source.id &&
        transaction.date < exclusiveEnd &&
        (!hasBalanceDate || transaction.date >= source.balanceDate)
      ) {
        balanceCents += balanceMovement(transaction);
      }
    }
    return { source, balanceCents, complete };
  });
  return {
    totalCents: items.reduce((total, item) => total + item.balanceCents, 0),
    items,
    complete: items.length > 0 && items.every((item) => item.complete),
  };
}

export function categoryBreakdown(transactions: readonly Transaction[], month: string) {
  const categories = new Map<string, { category: string; amountCents: number; count: number }>();
  for (const transaction of transactionsForMonth(transactions, month)) {
    if (transaction.kind !== "expense" && transaction.kind !== "refund") continue;
    const category = transaction.category || "Outros";
    const item = categories.get(category) ?? { category, amountCents: 0, count: 0 };
    item.amountCents += transaction.kind === "refund" ? -transaction.amountCents : transaction.amountCents;
    item.count += 1;
    categories.set(category, item);
  }
  return [...categories.values()]
    .filter((item) => item.amountCents !== 0)
    .sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category, "pt-BR"));
}

export function monthlySeries(transactions: readonly Transaction[], month: string, months = 6) {
  monthIndex(month);
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError("A quantidade de meses deve ser um inteiro não negativo.");
  }
  return Array.from({ length: months }, (_, index) => {
    const selectedMonth = shiftMonth(month, index - months + 1);
    const { incomeCents, expenseCents } = summarize(transactions, selectedMonth);
    return { month: selectedMonth, incomeCents, expenseCents };
  });
}

function installmentMerchant(transaction: Transaction): string {
  return transaction.description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\b(?:parcela(?:do)?|parc\.?)[\s.:#-]*\d{1,3}\s*(?:\/|de)\s*\d{1,3}\b/g, " ")
    .replace(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g, (match, current, total) => (
      Number(current) === transaction.installmentCurrent && Number(total) === transaction.installmentTotal ? " " : match
    ))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function installmentForecast(transactions: readonly Transaction[], month: string) {
  const selectedIndex = monthIndex(month);
  const forecast = Array.from({ length: 6 }, (_, index) => ({
    month: monthAt(selectedIndex + index + 1),
    amountCents: 0,
  }));
  const purchases = new Map<string, {
    startIndex: number; total: number; amountCents: number; counts: Map<number, number>;
  }>();
  for (const transaction of transactions) {
    const current = transaction.installmentCurrent;
    const total = transaction.installmentTotal;
    if (
      transaction.kind !== "expense" ||
      current === null || total === null ||
      !Number.isInteger(current) || !Number.isInteger(total) ||
      current < 1 || total < 2 || current > total
    ) continue;
    const startIndex = monthIndex(transaction.date.slice(0, 7)) - current + 1;
    const key = JSON.stringify([
      transaction.sourceId,
      installmentMerchant(transaction),
      transaction.amountCents,
      total,
      startIndex,
    ]);
    const purchase = purchases.get(key) ?? {
      startIndex, total, amountCents: transaction.amountCents, counts: new Map<number, number>(),
    };
    purchase.counts.set(current, (purchase.counts.get(current) ?? 0) + 1);
    purchases.set(key, purchase);
  }
  for (const purchase of purchases.values()) {
    // Different installments identify one schedule; multiple real rows at the
    // same installment number identify multiple otherwise identical purchases.
    // Reimported duplicates have already been removed by the import identity.
    const quantity = Math.max(...purchase.counts.values());
    for (let offset = 1; offset <= forecast.length; offset += 1) {
      const installmentIndex = selectedIndex + offset - purchase.startIndex;
      if (installmentIndex >= 0 && installmentIndex < purchase.total) {
        forecast[offset - 1].amountCents += purchase.amountCents * quantity;
      }
    }
  }
  return forecast;
}
