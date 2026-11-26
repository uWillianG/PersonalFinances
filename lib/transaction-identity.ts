import type { TransactionKind } from "./types.ts";

export interface IdentityFields {
  date: string;
  description: string;
  amountCents: number;
  kind: TransactionKind;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
  externalId?: string;
}

export function transactionIdentityKey(row: IdentityFields): string {
  const externalId = row.externalId?.trim();
  if (externalId) return JSON.stringify(["external", externalId]);
  const description = row.description.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  // Amounts are stored as positive magnitudes. Preserve the bank movement's
  // direction while allowing reclassification within the same direction
  // (for example expense -> own-account transfer) without creating duplicates.
  const incoming = row.kind === "income" || row.kind === "refund" || row.kind === "transfer_in";
  const signedCents = Math.abs(row.amountCents) * (incoming ? 1 : -1);
  return JSON.stringify(["content", row.date, description, signedCents,
    row.installmentCurrent ?? null, row.installmentTotal ?? null]);
}

// Stable content identifier, not a security credential. Independent 32-bit
// lanes keep the same synchronous helper usable in browser previews and D1.
export function transactionFingerprint(row: IdentityFields, occurrence = 1): string {
  const value = transactionIdentityKey(row);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const hash = seeds.map((seed, lane) => {
    let result = seed;
    for (let i = 0; i < value.length; i++) {
      result ^= value.charCodeAt(i) + lane * 131;
      result = Math.imul(result, 0x01000193);
      result ^= result >>> 13;
    }
    return (result >>> 0).toString(16).padStart(8, "0");
  }).join("");
  return `v1_${hash}_${row.externalId?.trim() ? 1 : occurrence}`;
}

export function fingerprintOccurrence(fingerprint: string): number | null {
  const match = /^v1_[a-f0-9]{32}_([1-9]\d{0,3})$/.exec(fingerprint);
  const occurrence = match ? Number(match[1]) : 0;
  return occurrence >= 1 && occurrence <= 5000 ? occurrence : null;
}
