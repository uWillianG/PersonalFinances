import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAmountToCents, parseStatement } from "../lib/import-parser.ts";
import {
  balancesForMonth,
  installmentForecast,
  summarize,
} from "../lib/finance.ts";
import type { Source, SourceType, Transaction } from "../lib/types.ts";

const options = (sourceType: SourceType = "bank") => ({
  fileName: "synthetic-audit.csv",
  referenceMonth: "2026-11",
  sourceType,
});
const source: Source = {
  id: "bank",
  ownerId: "alice",
  name: "Conta de teste",
  institution: "Teste",
  type: "bank",
  initialBalanceCents: 100000,
  balanceDate: "2026-11-01",
  hasOpeningBalance: true,
};
function ledger(result: ReturnType<typeof parseStatement>): Transaction[] {
  return result.rows.map((row, index) => ({
    ...row,
    id: `row-${index}`,
    ownerId: "alice",
    ownerName: "Alice",
    sourceId: source.id,
    shared: false,
    note: "",
    importId: null,
  }));
}

test("sufixo D junto ao valor preserva a saída e o saldo, com a mesma identidade do formato espaçado", () => {
  for (const [raw, cents] of [
    ["42,50D", -4250],
    ["42,50 D", -4250],
    ["1.234,56d", -123456],
    ["42,50C", 4250],
    ["42,50 C", 4250],
  ] as const)
    assert.equal(parseAmountToCents(raw), cents, raw);
  const row = (amount: string) =>
    `Data;Descrição;Valor\n2026-11-01;Compra supermercado;${amount}`;
  const compact = parseStatement(row("42,50D"), options());
  const spaced = parseStatement(row("42,50 D"), options());
  assert.equal(compact.rows[0].kind, "expense");
  assert.equal(compact.rows[0].fingerprint, spaced.rows[0].fingerprint);
  assert.equal(
    balancesForMonth([source], ledger(compact), "2026-11").totalCents,
    95750,
  );
  assert.equal(summarize(ledger(compact), "2026-11").expenseCents, 4250);
});

test("datas nos históricos bancários e do benefício não inventam parcelas futuras", () => {
  for (const type of ["bank", "benefit"] as const) {
    const result = parseStatement(
      "Data;Descrição;Valor\n2026-11-01;Pix enviado 05/11;-50,00\n2026-11-02;Mercado dia 02/06;-20,00",
      options(type),
    );
    assert.ok(
      result.rows.every(
        (row) =>
          row.installmentCurrent === null && row.installmentTotal === null,
      ),
    );
    assert.ok(
      installmentForecast(ledger(result), "2026-11").every(
        (month) => month.amountCents === 0,
      ),
    );
  }
});

test("coluna de parcelas e rótulos explícitos continuam aceitos em contas e benefícios", () => {
  for (const type of ["bank", "benefit"] as const) {
    const explicitColumn = parseStatement(
      "Data;Descrição;Valor;Parcela\n2026-11-01;Compra;-50,00;2/6",
      options(type),
    );
    assert.deepEqual(
      [
        explicitColumn.rows[0].installmentCurrent,
        explicitColumn.rows[0].installmentTotal,
      ],
      [2, 6],
    );
    for (const label of [
      "Parcela 2/6",
      "Parc. 2/6",
      "Parcelamento 2 de 6",
      "Compra parcelada 2/6",
    ]) {
      const result = parseStatement(
        `Data;Descrição;Valor\n2026-11-01;${label};-50,00`,
        options(type),
      );
      assert.deepEqual(
        [result.rows[0].installmentCurrent, result.rows[0].installmentTotal],
        [2, 6],
        `${type}: ${label}`,
      );
    }
  }
});

test("cartão preserva parcela sem rótulo e prioriza rótulo explícito sobre data na descrição", () => {
  const result = parseStatement(
    "date,title,amount\n2026-11-01,Loja 01/03,50.00\n2026-11-02,Compra dia 05/11 - Parcela 2/6,70.00",
    options("credit"),
  );
  assert.deepEqual(
    result.rows.map((row) => [row.installmentCurrent, row.installmentTotal]),
    [
      [1, 3],
      [2, 6],
    ],
  );
});

test("uma célula inválida de crédito ou débito não é tratada como se estivesse vazia", () => {
  const result = parseStatement(
    "Data;Descrição;Crédito;Débito\n2026-11-01;Compra;erro;42,50\n2026-11-02;Entrada;10,00;inválido\n2026-11-03;Compra válida;0,00;42,50\n2026-11-04;Entrada válida;10,00;",
    options(),
  );
  assert.deepEqual(
    result.rows.map((row) => [row.description, row.amountCents, row.kind]),
    [
      ["Compra válida", 4250, "expense"],
      ["Entrada válida", 1000, "income"],
    ],
  );
  assert.match(result.warnings.join(" "), /2 linha/);
});

test("valores explicitamente em moeda estrangeira não entram no CSV como se fossem reais", () => {
  const result = parseStatement(
    "Data;Descrição;Valor\n2026-11-01;Compra;USD 1.00\n2026-11-02;Compra;1.00 USD\n2026-11-03;Compra;US$ 1.00\n2026-11-04;Compra;€ 1,00\n2026-11-05;Loja USD produtos;-R$ 12,34",
    options(),
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].description, "Loja USD produtos");
  assert.equal(result.rows[0].amountCents, 1234);
  assert.match(result.warnings.join(" "), /moeda diferente de real/);
  assert.match(result.warnings.join(" "), /4 linha/);
});

test("coluna de moeda distingue BRL de USD sem rejeitar a descrição de compra internacional", () => {
  const result = parseStatement(
    "date,title,amount,currency\n2026-11-01,Loja internacional USD,25.00,BRL\n2026-11-02,Loja internacional,10.00,USD\n2026-11-03,Loja internacional,12.00,EUR\n2026-11-04,Compra local,5.00,R$",
    options("credit"),
  );
  assert.deepEqual(
    result.rows.map((row) => row.amountCents),
    [2500, 500],
  );
  assert.ok(result.rows.every((row) => row.kind === "expense"));
  assert.match(result.warnings.join(" "), /2 linha/);
});

test("CSV com valor original e valor convertido escolhe a coluna explícita em reais", () => {
  for (const headerAndRow of [
    "Data;Descrição;Valor (USD);Valor (BRL);Moeda\n2026-11-01;Compra internacional;10.00;55,00;USD",
    "Data;Descrição;Valor (BRL);Valor (USD);Moeda\n2026-11-01;Compra internacional;55,00;10.00;USD",
    "Data;Descrição;Valor;Valor em reais;Moeda\n2026-11-01;Compra internacional;10.00;55,00;USD",
  ]) {
    const result = parseStatement(headerAndRow, options("credit"));
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].amountCents, 5500);
    assert.equal(result.rows[0].kind, "expense");
    assert.deepEqual(result.warnings, []);
  }
});

test("duas colunas BRL sem prioridade inequívoca não escolhem um valor arbitrário", () => {
  const result = parseStatement(
    "Data;Descrição;Valor (BRL);Amount (BRL)\n2026-11-01;Compra;10,00;20,00",
    options(),
  );
  assert.equal(result.rows.length, 0);
  assert.match(result.warnings.join(" "), /ambíguos/);
  const conflicting = parseStatement(
    "Data;Descrição;Valor (BRL)\n2026-11-01;Compra;USD 10.00",
    options(),
  );
  assert.equal(conflicting.rows.length, 0);
  assert.match(conflicting.warnings.join(" "), /moeda/);
});

test("OFX em USD não importa transações nem sugere saldo USD como BRL", () => {
  const result = parseStatement(
    "<OFX><CURDEF>USD<STMTTRN><DTPOSTED>20261101<TRNAMT>-10.00<FITID>foreign<NAME>Compra</STMTTRN><LEDGERBAL><BALAMT>100.00<DTASOF>20261101</LEDGERBAL></OFX>",
    { ...options(), fileName: "synthetic.ofx" },
  );
  assert.equal(result.rows.length, 0);
  assert.equal(result.balance, undefined);
  assert.match(result.warnings.join(" "), /moeda diferente de real/);
});

test("OFX com moeda principal BRL preserva compra internacional já convertida", () => {
  const result = parseStatement(
    "<OFX><CURDEF>BRL<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261101<TRNAMT>-55.00<FITID>converted<NAME>Loja USD<CURRENCY><CURSYM>USD</CURRENCY></STMTTRN><LEDGERBAL><BALAMT>945.00<DTASOF>20261101</LEDGERBAL></OFX>",
    { ...options(), fileName: "synthetic.ofx" },
  );
  assert.equal(result.rows[0].amountCents, 5500);
  assert.equal(result.rows[0].kind, "expense");
  assert.equal(result.balance?.amountCents, 94500);
});

test("texto extraído rejeita moedas explícitas no valor e saldo mas mantém BRL e nome de loja", () => {
  const result = parseStatement(
    "2026-11-01 Compra USD 10.00\n2026-11-02 Compra 10,00 €\n2026-11-03 Loja USD produtos R$ 55,00\n2026-11-01 Saldo inicial USD 100.00",
    { ...options(), fileName: "synthetic.pdf" },
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amountCents, 5500);
  assert.equal(result.rows[0].description, "Loja USD produtos");
  assert.equal(result.balance, undefined);
  assert.match(result.warnings.join(" "), /outra moeda/);
});
