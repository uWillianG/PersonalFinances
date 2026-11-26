import type { DraftTransaction, SourceType, TransactionKind } from "./types.ts";
import { transactionFingerprint as canonicalFingerprint } from "./transaction-identity.ts";

export interface ParseOptions { fileName: string; referenceMonth: string; sourceType: SourceType }
export interface StatementBalance { amountCents: number; date: string; basis: "opening" | "closing" }
export interface ParseResult { rows: DraftTransaction[]; warnings: string[]; balance?: StatementBalance }

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
const headerKey = (value: string) => normalize(value).replace(/\(?(?:r\$|brl|usd)\)?/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Signed integer cents. Null means an invalid or ambiguous amount, never zero by default. */
export function parseAmountToCents(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : null;
  let raw = value.trim().replace(/\u00a0/g, " ");
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || /-/.test(raw) || /\bD$/i.test(raw);
  raw = raw.replace(/^\((.*)\)$/, "$1").replace(/(?:R\$|BRL|USD|US\$|\$|€)/gi, "").replace(/\s*[CD]\s*$/i, "").replace(/\s/g, "");
  if (!/^[+-]?[\d.,]+[+-]?$/.test(raw)) return null;
  raw = raw.replace(/[+-]/g, "");
  if (!/\d/.test(raw)) return null;
  const comma = raw.lastIndexOf(","), dot = raw.lastIndexOf(".");
  let decimal = "";
  if (comma >= 0 && dot >= 0) decimal = comma > dot ? "," : ".";
  else {
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : "";
    if (separator) {
      const parts = raw.split(separator);
      if (parts.length === 2 && parts[1].length <= 2 && parts[1].length > 0) decimal = separator;
      else if (!/^\d{1,3}([.,]\d{3})+$/.test(raw)) return null;
    }
  }
  let integerPart: string, fraction: string;
  if (decimal) {
    const at = raw.lastIndexOf(decimal);
    integerPart = raw.slice(0, at);
    fraction = raw.slice(at + 1);
    const grouping = decimal === "," ? "." : ",";
    if (integerPart.includes(decimal) || (integerPart.includes(grouping) && !new RegExp(`^\\d{1,3}(\\${grouping}\\d{3})+$`).test(integerPart))) return null;
    integerPart = integerPart.replace(/[.,]/g, "");
  } else { integerPart = raw.replace(/[.,]/g, ""); fraction = ""; }
  const cents = Number(integerPart) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}

const monthNumbers: Record<string, number> = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
/** Brazilian dates, ISO dates and OFX timestamps; missing years use the explicitly chosen reference month. */
export function parseDate(value: string, referenceMonth = ""): string | null {
  const raw = normalize(value).replace(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/, "$1/$2/$3");
  let year = 0, month = 0, day = 0;
  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ t].*)?$/);
  if (match) [, year, month, day] = match.map(Number);
  else if ((match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?(?:\[[^\]]*\])?)?$/))) [, year, month, day] = match.map(Number);
  else {
    match = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (match) { day = Number(match[1]); month = Number(match[2]); year = Number(match[3] || 0); }
    else if ((match = raw.match(/^(\d{1,2})\s+([a-z]{3})(?:\s+(\d{4}))?$/))) { day = Number(match[1]); month = monthNumbers[match[2]] || 0; year = Number(match[3] || 0); }
    else return null;
    if (year && year < 100) year += year >= 70 ? 1900 : 2000;
    if (!year) {
      const reference = referenceMonth.match(/^(\d{4})-(\d{2})$/);
      if (!reference) return null;
      year = Number(reference[1]);
      // A January statement can contain December purchases from the previous year.
      if (month - Number(reference[2]) > 6) year--;
    }
  }
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function categorize(description: string, kind: TransactionKind): { category: string; needsReview: boolean } {
  if (kind === "transfer_in" || kind === "transfer_out") return { category: "Transferências", needsReview: false };
  if (kind === "card_payment") return { category: "Fatura", needsReview: false };
  if (kind === "refund") return { category: "Estornos", needsReview: false };
  const text = normalize(description);
  const rules: [RegExp, string][] = kind === "income" ? [
    [/salario|folha de pagamento|pro labore/, "Salário"], [/beneficio|vale alimentacao|vale refeicao|solides|auxilio/, "Benefícios"],
  ] : [
    [/supermerc|hipermerc|\bmercado\b|atacadao|assai|carrefour|hortifruti|acougue/, "Mercado"],
    [/restaurante|lanchonete|ifood|padaria|pizzaria|cafeteria|\bcafe\b|burger|rappi/, "Alimentação"],
    [/uber|99app|99\*|combustivel|posto |gasolina|estacionamento|pedagio|metro|onibus/, "Transporte"],
    [/farmacia|drogaria|hospital|clinica|consulta|dentista|unimed/, "Saúde"],
    [/aluguel|condominio|energia|eletric|agua e esgoto|internet|copel|enel|sabesp/, "Moradia"],
    [/netflix|spotify|youtube premium|prime video|disney|assinatura|icloud/, "Assinaturas"],
    [/escola|faculdade|curso|livraria|udemy/, "Educação"],
    [/cinema|teatro|ingresso|parque|steam|playstation/, "Lazer"],
    [/amazon|shopee|magalu|mercado livre|renner|roupa|loja/, "Compras"],
    [/tarifa|manutencao|servico|seguro/, "Serviços"],
  ];
  const rule = rules.find(([pattern]) => pattern.test(text));
  return rule ? { category: rule[1], needsReview: true } : { category: kind === "income" ? "Outras entradas" : "Outros", needsReview: true };
}

export function transactionFingerprint(row: DraftTransaction, occurrence = 1): string { return canonicalFingerprint(row, occurrence); }

function classify(description: string, signedCents: number, sourceType: SourceType, direction?: "in" | "out"): TransactionKind {
  const text = normalize(description);
  if (/estorno|reembolso|\brefund\b|devolucao/.test(text)) return "refund";
  if (/pagamento (?:d[aeo] )?(?:fatura|cartao)|pag(?:to|amento)\.?\s*(?:de )?fatura|liquidacao (?:de )?fatura/.test(text) || (sourceType === "credit" && /pagamento recebido|pagamento efetuado|payment received|payment thank/.test(text))) return "card_payment";
  const incoming = direction === "in" || (direction !== "out" && signedCents > 0);
  if (/mesma titularidade|entre (?:as )?(?:minhas|suas|proprias) contas|transferencia interna|(?:para|da|de) (?:a )?(?:minha|sua|propria) conta/.test(text)) return incoming ? "transfer_in" : "transfer_out";
  if (sourceType === "credit") return direction ? (direction === "in" ? "refund" : "expense") : signedCents < 0 ? "refund" : "expense";
  return incoming ? "income" : "expense";
}

function summaryDescription(value: string): boolean {
  return /^(?:saldo(?:\b|$)|total(?:\b|$)|resumo(?:\b|$)|limite(?:\b|$)|valor (?:total|da fatura)|pagamento minimo|vencimento|periodo(?:\b|$)|data de fechamento)/.test(normalize(value));
}

function makeRow(date: string, description: string, signedCents: number, options: ParseOptions, direction?: "in" | "out", externalId?: string, installments?: string): DraftTransaction | null {
  description = description.replace(/\s+/g, " ").trim();
  if (!description || summaryDescription(description) || signedCents === 0) return null;
  const kind = classify(description, signedCents, options.sourceType, direction);
  const category = options.sourceType === "benefit" && kind === "income" ? { category: "Benefícios", needsReview: true } : categorize(description, kind);
  const match = (installments || description).match(/(?:parcela\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i);
  const validInstallment = match && Number(match[1]) >= 1 && Number(match[2]) > 1 && Number(match[1]) <= Number(match[2]) && Number(match[2]) <= 99;
  return { date, description, amountCents: Math.abs(signedCents), kind, ...category, installmentCurrent: validInstallment ? Number(match[1]) : null, installmentTotal: validInstallment ? Number(match[2]) : null, ...(externalId?.trim() ? { externalId: externalId.trim() } : {}), fileName: options.fileName, fingerprint: "" };
}

/** RFC 4180 quoting, including embedded separators, CRLF and line breaks. */
function csvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = []; let record: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || !cell.trim()) quoted = !quoted; else cell += char; }
    else if (char === delimiter && !quoted) { record.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; record.push(cell); if (record.some(value => value.trim())) records.push(record); record = []; cell = ""; }
    else cell += char;
  }
  record.push(cell); if (record.some(value => value.trim())) records.push(record);
  if (quoted) throw new Error("CSV com aspas sem fechamento. Exporte o arquivo novamente.");
  return records;
}

const aliases = {
  date: ["data", "date", "data transacao", "data da transacao", "data de transacao", "data da compra", "data compra", "data lancamento", "data do lancamento", "data de lancamento", "data movimentacao", "data de movimentacao", "release date", "transaction date", "posted date", "dtposted"],
  description: ["descricao", "descricao da transacao", "description", "title", "titulo", "historico", "lancamento", "transacao", "movimentacao", "nome", "estabelecimento", "memo", "transaction type", "tipo de transacao", "detalhes"],
  amount: ["valor", "amount", "valor r", "valor da transacao", "valor transacao", "valor liquido", "transaction net amount", "transaction amount", "valor movimentacao", "valor da movimentacao"],
  credit: ["credito", "credit", "creditos", "entrada", "entradas", "valor credito", "valor de credito"],
  debit: ["debito", "debit", "debitos", "saida", "saidas", "valor debito", "valor de debito"],
  id: ["id", "identificador", "identificador da transacao", "id da transacao", "transaction id", "reference id", "referencia", "fitid", "documento"],
  installments: ["parcela", "parcelas", "parcelamento", "installment", "installments"],
  direction: ["tipo", "type", "natureza", "tipo de movimento", "tipo movimentacao", "credito debito", "c d", "dc"],
};
type Columns = Record<keyof typeof aliases, number>;
function columnsFor(record: string[]): Columns {
  const keys = record.map(headerKey);
  const columns = Object.fromEntries(Object.entries(aliases).map(([name, candidates]) => [name, keys.findIndex(key => candidates.includes(key))])) as Columns;
  // Mercado Pago balance reports can include both gross and net values; import the account movement.
  const net = keys.indexOf("transaction net amount"); if (net >= 0) columns.amount = net;
  return columns;
}
function usableColumns(columns: Columns) { return columns.date >= 0 && columns.description >= 0 && (columns.amount >= 0 || columns.credit >= 0 || columns.debit >= 0); }

function parseCsv(text: string, options: ParseOptions): ParseResult | null {
  let candidate: { records: string[][]; index: number; columns: Columns } | null = null;
  for (const delimiter of [";", ",", "\t", "|"]) {
    let records: string[][]; try { records = csvRecords(text, delimiter); } catch { continue; }
    const index = records.findIndex(record => usableColumns(columnsFor(record)));
    if (index >= 0) { candidate = { records, index, columns: columnsFor(records[index]) }; break; }
  }
  if (!candidate) return null;
  const { records, index, columns } = candidate; const rows: DraftTransaction[] = []; let rejected = 0, inferredYear = false;
  for (const record of records.slice(index + 1)) {
    const description = record[columns.description] || "";
    if (summaryDescription(description) || usableColumns(columnsFor(record))) continue;
    const rawDate = record[columns.date] || "", date = parseDate(rawDate, options.referenceMonth);
    if (!date) { if (record.some(cell => cell.trim())) rejected++; continue; }
    let amount: number | null = null, direction: "in" | "out" | undefined;
    const credit = columns.credit >= 0 ? parseAmountToCents(record[columns.credit] || "") : null;
    const debit = columns.debit >= 0 ? parseAmountToCents(record[columns.debit] || "") : null;
    if (credit && debit) { rejected++; continue; }
    if (debit) { amount = -Math.abs(debit); direction = "out"; }
    else if (credit) { amount = Math.abs(credit); direction = "in"; }
    else if (columns.amount >= 0) amount = parseAmountToCents(record[columns.amount] || "");
    const movement = normalize(record[columns.direction] || "");
    if (/^(?:d|debito|saida|expense|despesa)$/.test(movement)) direction = "out";
    if (/^(?:c|credito|entrada|income|receita|beneficio)$/.test(movement)) direction = "in";
    if (amount === null) { rejected++; continue; }
    const row = makeRow(date, description, amount, options, direction, record[columns.id], record[columns.installments]);
    if (row) {
      if (movement === "pagamento fatura") { row.kind = "card_payment"; row.category = "Fatura"; row.needsReview = false; }
      if (movement === "beneficio") { row.category = "Benefícios"; }
      if (!parseDate(rawDate)) { row.needsReview = true; inferredYear = true; }
      rows.push(row);
    }
  }
  return { rows, warnings: [...(rejected ? [`${rejected} linha(s) do CSV foram ignoradas por dados incompletos, ambíguos ou inválidos.`] : []), ...(inferredYear ? ["Algumas datas não tinham ano; foi usado o mês de referência. Confira o período."] : [])] };
}

function decodeEntities(value: string): string { return value.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))); }
function parseOfx(text: string, options: ParseOptions): ParseResult {
  const rows: DraftTransaction[] = []; let rejected = 0;
  const transactions = text.matchAll(/<STMTTRN\b[^>]*>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN\b)|(?=<\/BANKTRANLIST)|$)/gi);
  for (const [, block] of transactions) {
    const tag = (name: string) => {
      const match = block.match(new RegExp(`<${name}\\b[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<\\r\\n]*))`, "i"));
      return decodeEntities((match?.[1] || match?.[2] || "").trim());
    };
    const date = parseDate(tag("DTPOSTED"), options.referenceMonth), amount = parseAmountToCents(tag("TRNAMT"));
    const name = tag("NAME"), memo = tag("MEMO"), description = name && memo && normalize(name) !== normalize(memo) ? `${name} — ${memo}` : name || memo;
    if (!date || amount === null || !description) { rejected++; continue; }
    const type = tag("TRNTYPE").toUpperCase();
    const direction = ["DEBIT", "PAYMENT", "CHECK", "FEE", "ATM"].includes(type) ? "out" : ["CREDIT", "DEP", "DIRECTDEP", "INT"].includes(type) ? "in" : undefined;
    const row = makeRow(date, description, amount, options, direction, tag("FITID")); if (row) rows.push(row);
  }
  return { rows, warnings: rejected ? [`${rejected} lançamento(s) OFX foram ignorados por dados incompletos ou inválidos.`] : [] };
}

function parseExtractedText(text: string, options: ParseOptions): ParseResult {
  const rows: DraftTransaction[] = []; let rejected = 0, inferredYear = false, hasBalanceColumn = false;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let reference = options.referenceMonth;
  for (const line of lines.slice(0, 35)) {
    if (/periodo|extrato de|fatura|vencimento/i.test(normalize(line))) {
      const fullDates = [...line.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g)];
      const lastDate = fullDates.at(-1)?.[0], date = lastDate && parseDate(lastDate);
      if (date) reference = date.slice(0, 7);
    }
  }
  for (const line of lines) {
    if (/\b(?:data|date)\b.*\b(?:valor|debito|credito|amount)\b.*\bsaldo\b/.test(normalize(line))) hasBalanceColumn = true;
    const dated = line.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-](?:\d{4}|\d{2}))?|\d{1,2}\s+[A-Za-zçÇ]{3}(?:\s+\d{4})?)\s+(.+)$/);
    if (!dated) continue;
    const date = parseDate(dated[1], reference); if (!date) { rejected++; continue; }
    const remainder = dated[2];
    // Require a decimal part: merchant IDs, installment counts and integer balances are not amounts.
    const money = [...remainder.matchAll(/(?:\(\s*)?[+-]?\s*(?:R\$\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}(?:\s*[CD]\b)?(?:\s*\))?(?!\d)/gi)];
    if (!money.length) continue;
    const chosen = hasBalanceColumn && money.length === 2 ? money[0] : money.length === 1 ? money[0] : null;
    if (!chosen || chosen.index === undefined) { rejected++; continue; }
    const amount = parseAmountToCents(chosen[0]);
    const description = remainder.slice(0, chosen.index).trim().replace(/\s+[CD]$/i, "");
    if (!description || summaryDescription(description) || !/[A-Za-zÀ-ÿ]{2}/.test(description) || amount === null) { rejected++; continue; }
    const normalized = normalize(description);
    const explicitSign = /[-+()]|\b[CD]$/i.test(chosen[0]);
    const direction = /recebid|recebimento|deposito|salario|entrada/.test(normalized) ? "in" : /enviad|compra|pagamento|saque|debito|tarifa/.test(normalized) ? "out" : !explicitSign && options.sourceType !== "credit" ? "out" : undefined;
    const row = makeRow(date, description, amount, options, direction);
    if (row) { row.needsReview = true; if (!parseDate(dated[1])) inferredYear = true; rows.push(row); }
  }
  return { rows, warnings: ["Dados extraídos de PDF ou imagem precisam de conferência: o layout e o reconhecimento de texto podem alterar descrições, valores e direção dos movimentos.", ...(inferredYear ? ["Datas sem ano foram completadas com o período do documento ou mês de referência; confira a virada do ano."] : []), ...(rejected ? [`${rejected} linha(s) foram ignoradas por datas inválidas ou valores/colunas ambíguos.`] : [])] };
}

/** Only suggest balances with an explicit date and one unambiguous amount. */
function statementBalance(text: string): { balance?: StatementBalance; warnings: string[] } {
  const candidates: StatementBalance[] = [];
  let invalid = false;
  if (/<(?:OFX|LEDGERBAL)\b/i.test(text)) {
    for (const [, block] of text.matchAll(/<LEDGERBAL\b[^>]*>([\s\S]*?)(?:<\/LEDGERBAL>|(?=<(?:AVAILBAL|LEDGERBAL|\/STMTRS|\/CCSTMTRS)\b)|$)/gi)) {
      const amount = block.match(/<BALAMT\b[^>]*>\s*([^<\r\n]+)/i)?.[1];
      const rawDate = block.match(/<DTASOF\b[^>]*>\s*([^<\r\n]+)/i)?.[1];
      const amountCents = amount === undefined ? null : parseAmountToCents(amount);
      const date = rawDate === undefined ? null : parseDate(rawDate.trim());
      if (date && amountCents !== null) candidates.push({ amountCents, date, basis: "closing" });
      else invalid = true;
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const label = normalize(line).match(/\bsaldo\s+(inicial|anterior|final)\b/);
      if (!label) continue;
      const dateMatches = [...line.matchAll(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b/g)];
      if (dateMatches.length !== 1) { invalid = true; continue; }
      const date = parseDate(dateMatches[0][0]);
      const remaining = line.replace(dateMatches[0][0], " ").replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
      const amounts = [...remaining.matchAll(/(?:\(\s*)?[+-]?\s*(?:R\$\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?(?:\s*[CD]\b)?(?:\s*\))?(?!\d)/gi)];
      const amountCents = amounts.length === 1 ? parseAmountToCents(amounts[0][0]) : null;
      if (!date || amountCents === null) { invalid = true; continue; }
      candidates.push({ amountCents, date, basis: label[1] === "final" ? "closing" : "opening" });
    }
  }
  const opening = candidates.filter(candidate => candidate.basis === "opening");
  const preferred = opening.length ? opening : candidates;
  const unique = new Map(preferred.map(candidate => [JSON.stringify(candidate), candidate]));
  if (unique.size > 1) return { warnings: ["O arquivo contém saldos de datas ou valores diferentes. Informe o saldo inicial manualmente para evitar uma sugestão incorreta."] };
  return { ...(unique.size === 1 ? { balance: [...unique.values()][0] } : {}), warnings: invalid ? ["Um saldo foi ignorado porque a data completa ou o valor não estavam inequívocos. Se necessário, informe o saldo manualmente."] : [] };
}

export function parseStatement(text: string, options: ParseOptions): ParseResult {
  text = text.replace(/^\uFEFF/, "");
  if (!text.trim()) return { rows: [], warnings: ["O arquivo não contém texto legível."] };
  let result: ParseResult;
  if (/<(?:OFX|STMTTRN)\b/i.test(text)) result = parseOfx(text, options);
  else if (/\.ofx$/i.test(options.fileName)) result = { rows: [], warnings: ["O arquivo OFX não contém lançamentos STMTTRN reconhecíveis."] };
  else {
    const csv = parseCsv(text, options);
    if (csv) result = csv;
    else if (/\.(?:csv|tsv)$/i.test(options.fileName)) result = { rows: [], warnings: ["Cabeçalho CSV não reconhecido. São necessárias colunas de data, descrição e valor (ou entradas/saídas). Saldo não é um valor de transação."] };
    else if (/^\d{3}\d{4}[0359]/m.test(text) && text.split(/\r?\n/).some(line => line.length === 240)) result = { rows: [], warnings: ["Arquivo CNAB 240 identificado. Este layout ainda precisa de validação com um arquivo da sua conta; exporte OFX, CSV ou PDF."] };
    else result = parseExtractedText(text, options);
  }
  const balanceMetadata = statementBalance(text);
  if (balanceMetadata.balance) result.balance = balanceMetadata.balance;
  result.warnings.push(...balanceMetadata.warnings);
  const occurrences = new Map<string, number>();
  for (const row of result.rows) {
    const base = transactionFingerprint(row), occurrence = (occurrences.get(base) || 0) + 1; occurrences.set(base, occurrence);
    // An external identifier already identifies a bank transaction; duplicates of that ID share identity.
    row.fingerprint = transactionFingerprint(row, row.externalId ? 1 : occurrence);
  }
  if (!result.rows.length && !result.warnings.some(warning => /não contém|não reconhecido|CNAB/.test(warning))) result.warnings.push("Nenhum lançamento foi identificado com segurança. Tente OFX/CSV ou outro período; nenhum gasto foi criado.");
  return result;
}
