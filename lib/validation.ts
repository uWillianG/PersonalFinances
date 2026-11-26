import type { DraftTransaction, Source, Transaction } from "./types.ts";
import type { ImportBalanceUpdate } from "./import-balances.ts";
import { fingerprintOccurrence, transactionFingerprint } from "./transaction-identity.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "Envie um objeto JSON válido.");
  return value as Record<string, unknown>;
}

export function allowedKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new ApiError(400, "O pedido contém campos não permitidos.");
}

export function boundedText(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new ApiError(400, `${name} deve ser um texto.`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
    throw new ApiError(400, `${name} deve ter ${allowEmpty ? "até" : "entre 1 e"} ${max} caracteres.`);
  }
  return result;
}

export function validDate(value: unknown, name = "Data"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, `${name} deve usar AAAA-MM-DD.`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (year < 1 || !Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new ApiError(400, `${name} não existe no calendário.`);
  }
  return value;
}

export function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ApiError(400, "Valores devem ser números inteiros de centavos.");
  // A complete import must also have totals that remain exact JS integers.
  if (Math.abs(value) > 1_000_000_000_000) throw new ApiError(400, "O valor excede o limite permitido.");
  return value;
}

function transactionMoney(value: unknown): number {
  const cents = money(value);
  if (cents < 0) throw new ApiError(400, "Use um valor de lançamento positivo. O tipo informa se é entrada ou saída.");
  return cents;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new ApiError(400, `${name} deve ser verdadeiro ou falso.`);
  return value;
}

const sourceTypes = ["bank", "credit", "benefit"] as const;
const kinds = ["income", "expense", "transfer_in", "transfer_out", "card_payment", "refund"] as const;
function enumValue<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new ApiError(400, `${name} inválido.`);
  return value as T;
}

export type SourceInput = Omit<Source, "id" | "ownerId">;
const sourceKeys = ["name", "institution", "type", "initialBalanceCents", "balanceDate", "hasOpeningBalance"];
export function validateSource(value: unknown, partial = false): Partial<SourceInput> {
  const input = record(value);
  allowedKeys(input, sourceKeys);
  const output: Partial<SourceInput> = {};
  const wants = (key: string) => !partial || Object.hasOwn(input, key);
  if (wants("name")) output.name = boundedText(input.name, "Nome da conta", 100);
  if (wants("institution")) output.institution = boundedText(input.institution, "Instituição", 100);
  if (wants("type")) output.type = enumValue(input.type, sourceTypes, "Tipo de conta");
  if (wants("initialBalanceCents")) output.initialBalanceCents = money(input.initialBalanceCents);
  if (wants("balanceDate")) output.balanceDate = validDate(input.balanceDate);
  if (wants("hasOpeningBalance")) output.hasOpeningBalance = booleanValue(input.hasOpeningBalance, "Saldo inicial informado");
  if (!Object.keys(output).length) throw new ApiError(400, "Informe ao menos um campo para alterar.");
  return output;
}

function installment(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 600) throw new ApiError(400, "Número de parcela inválido.");
  return value;
}

export type ValidDraft = DraftTransaction & { sourceId: string; fileName: string; shared: boolean; note: string };
export function validateImport(value: unknown): ValidDraft[] {
  const body = record(value);
  allowedKeys(body, ["items", "balanceUpdates"]);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 5000) throw new ApiError(400, "Importe entre 1 e 5.000 lançamentos por vez.");
  return body.items.map((raw) => {
    const item = record(raw);
    allowedKeys(item, ["date", "description", "amountCents", "kind", "category", "installmentCurrent", "installmentTotal", "needsReview", "externalId", "fingerprint", "sourceId", "fileName", "shared", "note"]);
    const current = installment(item.installmentCurrent);
    const total = installment(item.installmentTotal);
    if ((current === null) !== (total === null) || (current !== null && total !== null && current > total)) throw new ApiError(400, "Parcela atual e total devem formar uma sequência válida.");
    const row: ValidDraft = {
      date: validDate(item.date),
      description: boundedText(item.description, "Descrição", 500),
      amountCents: transactionMoney(item.amountCents),
      kind: enumValue(item.kind, kinds, "Tipo de lançamento"),
      category: boundedText(item.category, "Categoria", 100),
      installmentCurrent: current, installmentTotal: total,
      needsReview: booleanValue(item.needsReview, "Revisão"),
      sourceId: boundedText(item.sourceId, "Conta de origem", 100),
      fileName: boundedText(item.fileName, "Nome do arquivo", 240),
      shared: item.shared === undefined ? false : booleanValue(item.shared, "Compartilhamento"),
      note: item.note === undefined ? "" : boundedText(item.note, "Observação", 2000, true),
      fingerprint: boundedText(item.fingerprint, "Identificador do lançamento", 100),
      ...(item.externalId === undefined ? {} : { externalId: boundedText(item.externalId, "Identificador externo", 250) }),
    };
    const occurrence = fingerprintOccurrence(row.fingerprint);
    if (occurrence === null || row.fingerprint !== transactionFingerprint(row, occurrence)) throw new ApiError(400, "O identificador do lançamento não corresponde aos dados. Revise a importação.");
    row.fingerprint = transactionFingerprint(row, occurrence);
    return row;
  });
}

export function validateImportBalances(value: unknown): ImportBalanceUpdate[] {
  const body = record(value);
  allowedKeys(body, ["items", "balanceUpdates"]);
  if (body.balanceUpdates === undefined) return [];
  if (!Array.isArray(body.balanceUpdates) || body.balanceUpdates.length > 100)
    throw new ApiError(
      400,
      "Informe até 100 saldos de referência por importação.",
    );
  const seen = new Set<string>();
  return body.balanceUpdates.map((value) => {
    const input = record(value);
    allowedKeys(input, ["sourceId", "amountCents", "date"]);
    const sourceId = boundedText(
      input.sourceId,
      "Conta do saldo de referência",
      100,
    );
    if (seen.has(sourceId))
      throw new ApiError(
        400,
        "Informe somente um saldo de referência para cada conta.",
      );
    seen.add(sourceId);
    return {
      sourceId,
      amountCents: money(input.amountCents),
      date: validDate(input.date, "Data do saldo de referência"),
    };
  });
}

export type TransactionPatch = Partial<Pick<Transaction, "date" | "description" | "amountCents" | "kind" | "category" | "shared" | "needsReview" | "note" | "installmentCurrent" | "installmentTotal">>;
export function validateTransactionPatch(value: unknown): TransactionPatch {
  const input = record(value);
  allowedKeys(input, ["date", "description", "amountCents", "kind", "category", "shared", "needsReview", "note", "installmentCurrent", "installmentTotal"]);
  const result: TransactionPatch = {};
  if (Object.hasOwn(input, "date")) result.date = validDate(input.date);
  if (Object.hasOwn(input, "description")) result.description = boundedText(input.description, "Descrição", 500);
  if (Object.hasOwn(input, "amountCents")) result.amountCents = transactionMoney(input.amountCents);
  if (Object.hasOwn(input, "kind")) result.kind = enumValue(input.kind, kinds, "Tipo de lançamento");
  if (Object.hasOwn(input, "category")) result.category = boundedText(input.category, "Categoria", 100);
  if (Object.hasOwn(input, "shared")) result.shared = booleanValue(input.shared, "Compartilhamento");
  if (Object.hasOwn(input, "needsReview")) result.needsReview = booleanValue(input.needsReview, "Revisão");
  if (Object.hasOwn(input, "note")) result.note = boundedText(input.note, "Observação", 2000, true);
  const hasCurrent = Object.hasOwn(input, "installmentCurrent");
  const hasTotal = Object.hasOwn(input, "installmentTotal");
  if (hasCurrent || hasTotal) {
    if (!hasCurrent || !hasTotal) throw new ApiError(400, "Informe a parcela atual e o total juntos.");
    const current = installment(input.installmentCurrent);
    const total = installment(input.installmentTotal);
    if ((current === null) !== (total === null) || (current !== null && total !== null && current > total)) throw new ApiError(400, "Parcela atual e total devem formar uma sequência válida.");
    result.installmentCurrent = current;
    result.installmentTotal = total;
  }
  if (!Object.keys(result).length) throw new ApiError(400, "Informe ao menos um campo para alterar.");
  return result;
}

export function validateOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) throw new ApiError(403, "Origem do pedido não permitida.");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Origem do pedido não permitida.");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "Envie o pedido como application/json.");
  const maxBytes = 16 * 1024 * 1024;
  const size = request.headers.get("content-length");
  if (size && Number(size) > maxBytes) throw new ApiError(413, "O arquivo enviado é grande demais.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new ApiError(413, "O arquivo enviado é grande demais.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ApiError(400, "O corpo do pedido não contém JSON válido."); }
  return record(value);
}
