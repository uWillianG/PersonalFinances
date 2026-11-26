import assert from "node:assert/strict";
import test from "node:test";
import { categorize, parseAmountToCents, parseDate, parseStatement, transactionFingerprint } from "../lib/import-parser.ts";
import type { SourceType } from "../lib/types.ts";

const options = (sourceType: SourceType = "bank", fileName = "sintetico.csv") => ({ fileName, referenceMonth: "2026-11", sourceType });

test("amounts parse BR/US grouping, signed credits/debits and exact cents", () => {
  for (const [input, expected] of [["R$ 1.234,56", 123456], ["1,234.56", 123456], ["-0,01", -1], ["(25,90)", -2590], ["1.234", 123400], ["0.10", 10], ["42,50 D", -4250], ["42,50 C", 4250], ["1.234.567,89", 123456789]] as const) assert.equal(parseAmountToCents(input), expected, input);
  for (const input of ["", "banana", "12,3456", "1,2,34", "12.34,56", "--25"]) assert.equal(parseAmountToCents(input), null, input);
});

test("dates validate calendars, leap years, ISO and OFX times without accepting overflow", () => {
  assert.equal(parseDate("29/02/2024"), "2024-02-29");
  assert.equal(parseDate("20261109124500.000[-3:BRT]"), "2026-11-09");
  assert.equal(parseDate("2026-11-09T12:30:00Z"), "2026-11-09");
  assert.equal(parseDate("09/11", "2026-11"), "2026-11-09");
  assert.equal(parseDate("28/12", "2026-01"), "2025-12-28");
  for (const date of ["31/11/2026", "29/02/2026", "2026-13-01", "00/01/2026", "20261131", "09/11"]) assert.equal(parseDate(date), null, date);
});

test("CSV preserves quoted separators, doubled quotes, multiline descriptions and BOM", () => {
  const result = parseStatement('\uFEFFData;Descrição;Valor\r\n09/11/2026;"Mercado; ""Do João""\nCentro";"-1.234,56"\r\n', options());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].description, 'Mercado; "Do João" Centro');
  assert.equal(result.rows[0].amountCents, 123456);
  assert.equal(result.rows[0].kind, "expense");
  assert.equal(result.rows[0].category, "Mercado");
});

test("CSV finds actual headers after summaries and does not use balances as transaction amounts", () => {
  const csv = "Resumo da conta;Saldo\nTotal;5000,00\nData;Histórico;Crédito (R$);Débito (R$);Saldo (R$)\n01/11/2026;Salário;5000,00;;5000,00\n02/11/2026;Farmácia;;19,90;4980,10\n03/11/2026;Saldo final;;;4980,10\n";
  const result = parseStatement(csv, options());
  assert.deepEqual(result.rows.map(row => [row.amountCents, row.kind]), [[500000, "income"], [1990, "expense"]]);
  assert.equal(parseStatement("Data;Descrição;Saldo\n01/11/2026;Saldo;999,99", options()).rows.length, 0);
});

test("CSV rejects invalid dates, malformed amounts and ambiguous incoming/outgoing columns", () => {
  const result = parseStatement("Data;Descrição;Crédito;Débito\n31/11/2026;Compra;;10,00\n01/11/2026;Compra;10,00;20,00\n02/11/2026;Compra;;erro\n03/11/2026;Compra;;0,01", options());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amountCents, 1);
  assert.match(result.warnings.join(" "), /3 linha/);
});

test("Nubank credit purchases are expenses, payments are fatura and negatives are refunds", () => {
  const result = parseStatement('date,title,amount\n2026-11-01,"Loja - Parcela 2/6",123.45\n2026-11-02,Pagamento recebido,-500.00\n2026-11-03,Estorno loja,-20.00\n2026-11-04,Ajuste de crédito,-1.25', options("credit"));
  assert.deepEqual(result.rows.map(row => row.kind), ["expense", "card_payment", "refund", "refund"]);
  assert.equal(result.rows[0].installmentCurrent, 2);
  assert.equal(result.rows[0].installmentTotal, 6);
  assert.equal(result.rows[1].amountCents, 50000);
});

test("generic Pix is a money movement; only explicit own transfers are excluded from expenses", () => {
  const result = parseStatement("Data;Descrição;Valor\n01/11/2026;Pix enviado Ana;-50,00\n02/11/2026;Pix recebido Carlos;70,00\n03/11/2026;Transferência entre minhas contas;-100,00\n04/11/2026;Transferência mesma titularidade;100,00\n05/11/2026;Pagamento de fatura Nubank;-200,00", options());
  assert.deepEqual(result.rows.map(row => row.kind), ["expense", "income", "transfer_out", "transfer_in", "card_payment"]);
});

test("Mercado Pago aliases choose net movement and retain external IDs", () => {
  const result = parseStatement("RELEASE_DATE,TRANSACTION_TYPE,REFERENCE_ID,TRANSACTION_GROSS_AMOUNT,TRANSACTION_NET_AMOUNT,BALANCE\n2026-11-01,Cobrança recebida,abc-001,100.00,98.20,1000.00", options());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amountCents, 9820);
  assert.equal(result.rows[0].externalId, "abc-001");
});

test("CSV template accepts explicit type even when amount has no negative sign", () => {
  const result = parseStatement("data,descricao,valor,tipo\n2026-11-01,Compra,10.25,despesa\n2026-11-02,Crédito mensal,100.00,beneficio\n2026-11-03,Trabalho,120.00,receita\n2026-11-04,Cartão,300.00,pagamento_fatura", options());
  assert.deepEqual(result.rows.map(row => row.kind), ["expense", "income", "income", "card_payment"]);
  assert.equal(result.rows[1].category, "Benefícios");
});

test("OFX accepts SGML missing leaf closing tags and XML entities/CDATA", () => {
  const ofx = 'OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT\n<DTPOSTED>20261109000000[-3:BRT]\n<TRNAMT>-12.34\n<FITID>001\n<NAME>Padaria &amp; Cia\n</STMTTRN><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261110</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>002</FITID><NAME><![CDATA[Salário mensal]]></NAME></STMTTRN></BANKTRANLIST></OFX>';
  const result = parseStatement(ofx, options("bank", "sintetico.ofx"));
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].description, "Padaria & Cia");
  assert.equal(result.rows[1].kind, "income");
  assert.equal(result.rows[1].externalId, "002");
});

test("legitimate identical rows preserve occurrence and remain stable on reimport", () => {
  const csv = "date,title,amount\n2026-11-01,Café,-5.00\n2026-11-01,Café,-5.00";
  const first = parseStatement(csv, options()), second = parseStatement(csv, options("bank", "renomeado.csv"));
  assert.equal(first.rows.length, 2);
  assert.notEqual(first.rows[0].fingerprint, first.rows[1].fingerprint);
  assert.deepEqual(first.rows.map(row => row.fingerprint), second.rows.map(row => row.fingerprint));
  const edited = { ...first.rows[0], category: "Outra", shared: true, kind: "transfer_out" as const };
  // Same-direction expense/transfer reclassification does not change bank identity.
  assert.equal(transactionFingerprint(edited), first.rows[0].fingerprint);
});

test("opposite-direction movements in separate files do not collide or share occurrence counts", () => {
  const header = "date,title,amount\n";
  const incoming = parseStatement(`${header}2026-11-01,Movimentação,25.00`, options("bank", "entrada.csv"));
  const outgoing = parseStatement(`${header}2026-11-01,Movimentação,-25.00`, options("bank", "saida.csv"));
  assert.equal(incoming.rows[0].kind, "income");
  assert.equal(outgoing.rows[0].kind, "expense");
  assert.equal(incoming.rows[0].amountCents, outgoing.rows[0].amountCents);
  assert.notEqual(incoming.rows[0].fingerprint, outgoing.rows[0].fingerprint);
  assert.ok(incoming.rows[0].fingerprint.endsWith("_1"));
  assert.ok(outgoing.rows[0].fingerprint.endsWith("_1"));
  const mixed = parseStatement(`${header}2026-11-01,Movimentação,-25.00\n2026-11-01,Movimentação,25.00\n2026-11-01,Movimentação,-25.00`, options());
  assert.equal(mixed.rows[0].fingerprint, outgoing.rows[0].fingerprint);
  assert.equal(mixed.rows[1].fingerprint, incoming.rows[0].fingerprint);
  assert.ok(mixed.rows[2].fingerprint.endsWith("_2"));
});

test("OFX distinct IDs stay distinct; repeated same bank ID shares a fingerprint", () => {
  const block = (id: string) => `<STMTTRN><DTPOSTED>20261101<TRNAMT>-10.00<FITID>${id}<NAME>Compra</STMTTRN>`;
  const result = parseStatement(`<OFX><BANKTRANLIST>${block("a")}${block("b")}${block("a")}</BANKTRANLIST></OFX>`, options("bank", "sintetico.ofx"));
  assert.equal(result.rows.length, 3);
  assert.notEqual(result.rows[0].fingerprint, result.rows[1].fingerprint);
  assert.equal(result.rows[0].fingerprint, result.rows[2].fingerprint);
});

test("OFX card DEBIT uses its direction even though it has a negative amount", () => {
  const text = "<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261101<TRNAMT>-10.00<FITID>card-a<NAME>Loja</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261102<TRNAMT>10.00<FITID>card-b<NAME>Ajuste da loja</STMTTRN></BANKTRANLIST></OFX>";
  assert.deepEqual(parseStatement(text, options("credit", "sintetico.ofx")).rows.map(row => row.kind), ["expense", "refund"]);
});

test("PDF text recognizes dated rows and explicit balance columns; flags inferred years", () => {
  const text = "Extrato período 01/11/2026 a 30/11/2026\nData Descrição Valor Saldo\n01/11 Saldo anterior 1.000,00\n02/11 Farmácia -20,00 980,00\n03/11 Pix recebido Carlos 50,00 1.030,00\n31/11 Loja -10,00 1.020,00";
  const result = parseStatement(text, options("bank", "sintetico.pdf"));
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(row => [row.date, row.amountCents, row.kind]), [["2026-11-02", 2000, "expense"], ["2026-11-03", 5000, "income"]]);
  assert.ok(result.rows.every(row => row.needsReview));
  assert.match(result.warnings.join(" "), /sem ano/);
});

test("PDF ambiguity and unrecognized documents produce no invented transactions", () => {
  for (const text of ["Bem vindo. Saldo disponível R$ 1.000,00", "01/11 Loja 20,00 100,00", "31/11/2026 Compra 10,00", "01/11 Total da fatura 100,00"]) assert.equal(parseStatement(text, options("credit", "sintetico.pdf")).rows.length, 0, text);
});

test("categorization never treats unlabelled transfer or Pix as own-account transfer", () => {
  assert.deepEqual(categorize("Pix para João", "expense"), { category: "Outros", needsReview: true });
  assert.equal(categorize("qualquer", "card_payment").category, "Fatura");
});

test("OFX suggests dated ledger closing balance, never the available balance", () => {
  const result = parseStatement("<OFX><LEDGERBAL><BALAMT>-123.45<DTASOF>20261125235959.000[-3:BRT]</LEDGERBAL><AVAILBAL><BALAMT>9999.99<DTASOF>20261125</AVAILBAL></OFX>", options("bank", "saldo.ofx"));
  assert.deepEqual(result.balance, { amountCents: -12345, date: "2026-11-25", basis: "closing" });
  assert.equal(result.rows.length, 0);
  assert.equal(parseStatement("<OFX><AVAILBAL><BALAMT>9999.99<DTASOF>20261125</AVAILBAL></OFX>", options("bank", "saldo.ofx")).balance, undefined);
});

test("CSV preamble and dated PDF saldo anterior provide opening balance without creating a transaction", () => {
  const csv = "Saldo inicial;01/11/2026;R$ 1.000,00\nData;Descrição;Valor\n02/11/2026;Compra;-25,00";
  const parsed = parseStatement(csv, options());
  assert.deepEqual(parsed.balance, { amountCents: 100000, date: "2026-11-01", basis: "opening" });
  assert.equal(parsed.rows.length, 1);
  const pdf = parseStatement("01/11/2026 Saldo anterior R$ 0,00\n02/11/2026 Loja -10,00", options("bank", "saldo.pdf"));
  assert.deepEqual(pdf.balance, { amountCents: 0, date: "2026-11-01", basis: "opening" });
  assert.equal(pdf.rows.length, 1);
});

test("undated, invalid, conflicting or multi-value balances produce no suggestion", () => {
  for (const text of ["Saldo inicial R$ 100,00", "31/11/2026 Saldo anterior R$ 100,00", "01/11/2026 Saldo inicial 100,00 200,00", "01/11/2026 Saldo inicial 100,00\n02/11/2026 Saldo inicial 200,00", "<OFX><LEDGERBAL><BALAMT>foo<DTASOF>20261125</LEDGERBAL></OFX>"]) {
    const result = parseStatement(text, options("bank", "saldo.pdf"));
    assert.equal(result.balance, undefined, text);
    assert.match(result.warnings.join(" "), /saldo/i);
  }
});
