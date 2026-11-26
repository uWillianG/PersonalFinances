import assert from "node:assert/strict";
import { test } from "node:test";
import { balancesForMonth, summarize } from "../lib/finance.ts";
import { parseStatement } from "../lib/import-parser.ts";
import type { Source, Transaction } from "../lib/types.ts";

test("devolução Pix enviada reduz saldo e não vira estorno recebido só pela descrição", () => {
  const result = parseStatement(
    "data;descricao;valor;tipo\n2026-11-25;Devolucao Pix enviada;-100,00;saida\n2026-11-26;Reembolso enviado;50,00;debito",
    {
      fileName: "synthetic-refund.csv",
      referenceMonth: "2026-11",
      sourceType: "bank",
    },
  );
  assert.deepEqual(
    result.rows.map((row) => row.kind),
    ["expense", "expense"],
  );
  assert.ok(result.rows.every((row) => row.needsReview));
  const source: Source = {
    id: "bank",
    ownerId: "alice",
    name: "Conta",
    institution: "Teste",
    type: "bank",
    initialBalanceCents: 100000,
    balanceDate: "2026-11-01",
    hasOpeningBalance: true,
  };
  const transactions: Transaction[] = result.rows.map((row, index) => ({
    ...row,
    id: `row-${index}`,
    ownerId: "alice",
    ownerName: "Alice",
    sourceId: source.id,
    shared: false,
    note: "",
    importId: null,
  }));
  assert.equal(
    balancesForMonth([source], transactions, "2026-11").totalCents,
    85000,
  );
  assert.equal(summarize(transactions, "2026-11").expenseCents, 15000);
});

test("estornos recebidos continuam créditos e cartões preservam estornos negativos", () => {
  const bank = parseStatement(
    "data;descricao;valor;tipo\n2026-11-25;Devolucao Pix recebida;100,00;entrada\n2026-11-26;Reembolso de compra;50,00;credito",
    {
      fileName: "synthetic-refund.csv",
      referenceMonth: "2026-11",
      sourceType: "bank",
    },
  );
  assert.deepEqual(
    bank.rows.map((row) => row.kind),
    ["refund", "refund"],
  );
  const card = parseStatement(
    "date,title,amount\n2026-11-25,Estorno da loja,-100.00\n2026-11-26,Ajuste de credito,-20.00\n2026-11-26,Pagamento recebido,-500.00",
    {
      fileName: "synthetic-card.csv",
      referenceMonth: "2026-11",
      sourceType: "credit",
    },
  );
  assert.deepEqual(
    card.rows.map((row) => row.kind),
    ["refund", "refund", "card_payment"],
  );
});
