import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateCardCycle,
  validateInvoice,
  validateInvoicePayment,
} from "../lib/invoice-validation.ts";

test("ciclo exige dias inteiros reais de 1 a 31 sem aceitar origem enviada", () => {
  assert.deepEqual(validateCardCycle({ closingDay: 31, dueDay: 5 }), {
    closingDay: 31,
    dueDay: 5,
  });
  for (const invalid of [
    { closingDay: 0, dueDay: 1 },
    { closingDay: 1, dueDay: 32 },
    { closingDay: 1.5, dueDay: 2 },
    { closingDay: "10", dueDay: 2 },
    { closingDay: 1, dueDay: 2, sourceId: "forged" },
  ])
    assert.throws(() => validateCardCycle(invalid));
});

test("total conferido distingue automático de zero e criação somente não apaga conferência", () => {
  const base = {
    sourceId: "card",
    month: "2026-11",
    confirmedTotalCents: null,
  };
  assert.deepEqual(validateInvoice(base), base);
  assert.equal(
    validateInvoice({ ...base, confirmedTotalCents: 0 }).confirmedTotalCents,
    0,
  );
  assert.deepEqual(validateInvoice({ ...base, ensureOnly: true }), base);
  for (const invalid of [
    { ...base, confirmedTotalCents: -1 },
    { ...base, confirmedTotalCents: 1.5 },
    { ...base, confirmedTotalCents: 1_000_000_000_001 },
    { ...base, month: "2026-13" },
    { ...base, ownerId: "other" },
    { ...base, ensureOnly: "true" },
    { ...base, confirmedTotalCents: 1, ensureOnly: true },
  ])
    assert.throws(() => validateInvoice(invalid));
});

test("vínculo exige centavos positivos e não aceita dono ou fatura do cliente", () => {
  assert.deepEqual(
    validateInvoicePayment({ transactionId: "payment", amountCents: 1 }),
    { transactionId: "payment", amountCents: 1 },
  );
  for (const invalid of [
    { transactionId: "payment", amountCents: 0 },
    { transactionId: "payment", amountCents: -1 },
    { transactionId: "payment", amountCents: 0.5 },
    { transactionId: "payment", amountCents: 1, invoiceId: "forged" },
    { transactionId: "", amountCents: 1 },
    { transactionId: "payment", amountCents: 1, ownerId: "forged" },
  ])
    assert.throws(() => validateInvoicePayment(invalid));
});
