import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBudget, validateBudgetCopy, validateBudgetPatch, validateOccurrence, validateSchedule, validateScheduleRange, validMonth } from "../lib/planning-validation.ts";

const schedule = { scope: "personal", name: " Aluguel ", kind: "expense", category: " Moradia ", amountCents: 120000, frequency: "monthly", startDate: "2026-01-31", endDate: null, active: true };

test("planejamento valida meses e datas reais, inclusive ano bissexto", () => {
  assert.equal(validMonth("2026-12"), "2026-12");
  for (const month of ["2026-00", "2026-13", "0000-01", "2026-1", "2026-11-01", null]) assert.throws(() => validMonth(month));
  assert.equal(validateSchedule({ ...schedule, startDate: "2028-02-29" }).startDate, "2028-02-29");
  assert.throws(() => validateSchedule({ ...schedule, startDate: "2026-02-29" }));
  assert.throws(() => validateSchedule({ ...schedule, endDate: "2025-12-31" }));
  assert.throws(() => validateScheduleRange("2026-11-25", "2026-11-24"));
});

test("orçamento exige centavos positivos e não aceita identificação ou origem do cliente", () => {
  const input = { scope: "couple", month: "2026-11", category: " Saúde ", limitCents: 10000 };
  assert.deepEqual(validateBudget(input), { ...input, category: "Saúde" });
  for (const limitCents of [0, -1, 0.1, Infinity, 1_000_000_000_001, "100"]) assert.throws(() => validateBudget({ ...input, limitCents }));
  for (const field of ["ownerId", "coupleId", "scopeKey", "categoryKey", "sourceId"]) assert.throws(() => validateBudget({ ...input, [field]: "forged" }));
  assert.throws(() => validateBudget({ ...input, category: " ", scope: "shared" }));
  assert.deepEqual(validateBudgetPatch({ limitCents: 12345 }), { limitCents: 12345 });
  assert.throws(() => validateBudgetPatch({ limitCents: 12345, scope: "couple" }));
  assert.throws(() => validateBudgetCopy({ scope: "personal", fromMonth: "2026-11", toMonth: "2026-11" }));
  assert.deepEqual(validateBudgetCopy({ scope: "couple", fromMonth: "2026-11", toMonth: "2026-12" }), { scope: "couple", fromMonth: "2026-11", toMonth: "2026-12" });
});

test("compromissos restringem tipos, frequência, campos e mudança de escopo", () => {
  assert.deepEqual(validateSchedule(schedule), { ...schedule, name: "Aluguel", category: "Moradia" });
  assert.deepEqual(validateSchedule({ active: false }, true), { active: false });
  assert.deepEqual(validateSchedule({ endDate: null }, true), { endDate: null });
  for (const field of ["scope", "ownerId", "coupleId", "sourceId"]) assert.throws(() => validateSchedule({ [field]: "forged" }, true));
  assert.throws(() => validateSchedule({}, true));
  for (const kind of ["refund", "transfer_out", "transfer_in"]) assert.throws(() => validateSchedule({ ...schedule, kind }));
  assert.throws(() => validateSchedule({ ...schedule, frequency: "daily" }));
  assert.throws(() => validateSchedule({ ...schedule, active: "false" }));
  assert.throws(() => validateSchedule({ ...schedule, name: "x".repeat(161) }));
  assert.throws(() => validateSchedule({ ...schedule, amountCents: 0 }));
});

test("confirmação aceita vínculo explícito sem aceitar dados para criar lançamento", () => {
  assert.deepEqual(validateOccurrence({ dueDate: "2026-11-25", action: "confirm" }), { dueDate: "2026-11-25", action: "confirm" });
  assert.deepEqual(validateOccurrence({ dueDate: "2026-11-25", action: "link", transactionId: " tx-1 " }), { dueDate: "2026-11-25", action: "link", transactionId: "tx-1" });
  assert.throws(() => validateOccurrence({ dueDate: "2026-11-25", action: "link" }));
  assert.throws(() => validateOccurrence({ dueDate: "2026-11-25", action: "confirm", transactionId: "tx-1" }));
  assert.throws(() => validateOccurrence({ dueDate: "2026-11-31", action: "confirm" }));
  assert.throws(() => validateOccurrence({ dueDate: "2026-11-25", action: "pay", amountCents: 100, sourceId: "source-1" }));
});
