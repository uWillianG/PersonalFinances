import type { DraftTransaction } from "./types.ts";
import { transactionFingerprint } from "./transaction-identity.ts";

/** Preserve the selected invoice month and count identities after date clamping.
 * Several real purchases on days 29–31 can otherwise collapse to the same day. */
export function mapBillingRows<T extends DraftTransaction>(
  rows: readonly T[],
  referenceMonth: string,
): T[] {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(referenceMonth) ||
    Number(referenceMonth.slice(0, 4)) < 1
  )
    throw new RangeError("Escolha um mês de fatura válido.");
  const lastDay = new Date(`${referenceMonth}-01T12:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  const occurrences = new Map<string, number>();
  return rows.map((original) => {
    const day = Math.min(Number(original.date.slice(-2)), lastDay.getUTCDate());
    const date = `${referenceMonth}-${String(day).padStart(2, "0")}`;
    const row = {
      ...original,
      date,
      ...(date === original.date
        ? {}
        : {
            note: `Data informada no arquivo: ${original.date}. Competência da fatura: ${referenceMonth}.`,
          }),
    };
    const base = transactionFingerprint(row);
    const occurrence = original.externalId?.trim()
      ? 1
      : (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { ...row, fingerprint: transactionFingerprint(row, occurrence) };
  });
}
