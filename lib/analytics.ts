import type { ReportScope } from "./planning-types.ts";
import type { Transaction, TransactionKind } from "./types.ts";
import { categoryKey } from "./planning.ts";

export interface MerchantReportRow {
  key: string;
  name: string;
  expenseCents: number;
  refundCents: number;
  netCents: number;
  /** Purchases in the selected month; refunds do not add visits. */
  count: number;
  averageCents: number;
  lastDate: string;
  previousCents: number;
  changePercent: number | null;
  transactions: Transaction[];
}

export interface MerchantReportOptions {
  search?: string;
  category?: string;
  sort?: "spent" | "visits" | "average" | "name";
}

export interface CategoryComparisonRow {
  category: string;
  currentCents: number;
  previousCents: number;
  differenceCents: number;
  changePercent: number | null;
}

/** Select the visible ledger without exposing the partner's private purchases. */
export function selectReportTransactions(
  own: readonly Transaction[],
  partner: readonly Transaction[],
  scope: ReportScope,
): Transaction[] {
  const selected =
    scope === "mine"
      ? own
      : scope === "personal"
        ? own.filter((transaction) => !transaction.shared)
        : [
            ...own.filter((transaction) => transaction.shared),
            ...partner.filter((transaction) => transaction.shared),
          ];
  const seen = new Set<string>();
  return selected.filter((transaction) => {
    if (seen.has(transaction.id)) return false;
    seen.add(transaction.id);
    return true;
  });
}

function merchantName(description: string, kind?: TransactionKind): string {
  let name = description.normalize("NFC").replace(/\s+/g, " ").trim();
  // Only a refund may remove this prefix: a real merchant may be called Estorno.
  if (kind === "refund")
    name = name.replace(/^estorno\s+(?:(?:da|do|de)\s+)?(?:[-:]\s*)?/iu, "");
  const withoutBankPrefix = name
    .replace(
      /^(?:compra|pagamento)(?:\s+(?:realizad[oa]|efetuad[oa]))?\s+(?:com\s+(?:o\s+)?cart[aã]o(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?|no\s+(?:cr[eé]dito|d[eé]bito)|(?:no\s+)?cart[aã]o(?:\s+(?:de\s+)?(?:cr[eé]dito|d[eé]bito))?)\b\s*[-:*]?\s*/iu,
      "",
    )
    .replace(/^(?:compra|pagamento)\s*[-:]\s*/iu, "")
    .replace(
      /^pix\s+(?:(?:enviado|recebido|efetuado|transferido|pago)(?:\s+para)?|pagamento(?:\s+para)?|para)\b\s*[-:]?\s*/iu,
      "",
    );
  // An incomplete bank label remains distinct instead of collapsing into "Pix".
  if (withoutBankPrefix.trim()) name = withoutBankPrefix;
  name = name.replace(
    /\s+(?:[-–—:]\s*)?(?:(?:parcela(?:do)?|parc\.?)\s*)?(\d{1,3})\s*\/\s*(\d{1,3})\s*$/iu,
    (match, current: string, total: string) =>
      Number(current) > 0 && Number(current) <= Number(total) ? "" : match,
  );
  name = name.replace(
    /\s+(?:[-–—:]\s*)?(?:parcela(?:do)?|parc\.?)\s*(\d{1,3})\s+de\s+(\d{1,3})\s*$/iu,
    (match, current: string, total: string) =>
      Number(current) > 0 && Number(current) <= Number(total) ? "" : match,
  );
  return name.trim() || "Sem descrição";
}

/** Keep branch numbers and merchant punctuation; remove only clear bank metadata. */
export function merchantKey(
  description: string,
  kind?: TransactionKind,
): string {
  return categoryKey(merchantName(description, kind));
}

function previousMonth(month: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
    throw new RangeError(`Mês inválido: ${month}`);
  const [year, number] = month.split("-").map(Number);
  return number === 1
    ? `${String(year - 1).padStart(4, "0")}-12`
    : `${String(year).padStart(4, "0")}-${String(number - 1).padStart(2, "0")}`;
}

function changePercent(current: number, previous: number): number | null {
  return previous === 0
    ? null
    : ((current - previous) / Math.abs(previous)) * 100;
}

function isSpending(transaction: Transaction): boolean {
  return transaction.kind === "expense" || transaction.kind === "refund";
}

/** Current-month merchants with the preceding month's net spend under the same filters. */
export function merchantReport(
  transactions: readonly Transaction[],
  month: string,
  options: MerchantReportOptions = {},
): MerchantReportRow[] {
  const previous = previousMonth(month);
  const search = categoryKey(options.search ?? "");
  const category = categoryKey(options.category ?? "");
  const rows = new Map<string, MerchantReportRow>();
  const previousAmounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (!isSpending(transaction)) continue;
    const transactionMonth = transaction.date.slice(0, 7);
    if (transactionMonth !== month && transactionMonth !== previous) continue;
    if (
      category &&
      categoryKey(transaction.category.trim() || "Outros") !== category
    )
      continue;
    const key = merchantKey(transaction.description, transaction.kind);
    if (
      search &&
      !key.includes(search) &&
      !categoryKey(transaction.description).includes(search)
    )
      continue;
    const net =
      transaction.kind === "refund"
        ? -transaction.amountCents
        : transaction.amountCents;
    if (transactionMonth === previous) {
      previousAmounts.set(key, (previousAmounts.get(key) ?? 0) + net);
      continue;
    }
    const row = rows.get(key) ?? {
      key,
      name: merchantName(transaction.description, transaction.kind),
      expenseCents: 0,
      refundCents: 0,
      netCents: 0,
      count: 0,
      averageCents: 0,
      lastDate: transaction.date,
      previousCents: 0,
      changePercent: null,
      transactions: [],
    };
    if (transaction.kind === "expense") {
      // Prefer the purchase spelling when the first row happened to be a refund.
      if (row.count === 0)
        row.name = merchantName(transaction.description, transaction.kind);
      row.expenseCents += transaction.amountCents;
      row.count += 1;
    } else row.refundCents += transaction.amountCents;
    row.netCents += net;
    if (transaction.date > row.lastDate) row.lastDate = transaction.date;
    row.transactions.push(transaction);
    rows.set(key, row);
  }
  for (const row of rows.values()) {
    row.averageCents =
      row.count === 0 ? 0 : Math.round(row.netCents / row.count);
    row.previousCents = previousAmounts.get(row.key) ?? 0;
    row.changePercent = changePercent(row.netCents, row.previousCents);
    row.transactions.sort(
      (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    );
  }
  const byName = (a: MerchantReportRow, b: MerchantReportRow) =>
    a.name.localeCompare(b.name, "pt-BR") || a.key.localeCompare(b.key);
  return [...rows.values()].sort((a, b) => {
    if (options.sort === "name") return byName(a, b);
    if (options.sort === "visits")
      return b.count - a.count || b.netCents - a.netCents || byName(a, b);
    if (options.sort === "average")
      return b.averageCents - a.averageCents || byName(a, b);
    return b.netCents - a.netCents || byName(a, b);
  });
}

export function categoryComparison(
  transactions: readonly Transaction[],
  month: string,
): CategoryComparisonRow[] {
  const previous = previousMonth(month);
  const rows = new Map<string, CategoryComparisonRow>();
  // Current names take precedence over historical spellings of the same category.
  for (const selectedMonth of [month, previous]) {
    for (const transaction of transactions) {
      if (
        !isSpending(transaction) ||
        transaction.date.slice(0, 7) !== selectedMonth
      )
        continue;
      const category = transaction.category.trim() || "Outros";
      const key = categoryKey(category);
      const row = rows.get(key) ?? {
        category,
        currentCents: 0,
        previousCents: 0,
        differenceCents: 0,
        changePercent: null,
      };
      const net =
        transaction.kind === "refund"
          ? -transaction.amountCents
          : transaction.amountCents;
      if (selectedMonth === month) row.currentCents += net;
      else row.previousCents += net;
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      differenceCents: row.currentCents - row.previousCents,
      changePercent: changePercent(row.currentCents, row.previousCents),
    }))
    .sort(
      (a, b) =>
        b.currentCents - a.currentCents ||
        a.category.localeCompare(b.category, "pt-BR"),
    );
}
