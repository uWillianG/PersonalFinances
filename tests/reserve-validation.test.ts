import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultReservePlan } from "../lib/reserve-types.ts";
import { validateReservePlan } from "../lib/reserve-validation.ts";

test("ajustes distinguem cálculo automático de zero informado e exigem centavos não negativos", () => {
  const input = defaultReservePlan("2026-11");
  assert.deepEqual(validateReservePlan(input), input);
  assert.deepEqual(
    validateReservePlan({
      ...input,
      cardReserveCents: 0,
      goalReserveCents: 0,
      sharedCommitmentCents: 0,
    }),
    {
      ...input,
      cardReserveCents: 0,
      goalReserveCents: 0,
      sharedCommitmentCents: 0,
    },
  );
  for (const key of [
    "minimumBalanceCents",
    "extraExpenseCents",
    "cardReserveCents",
    "goalReserveCents",
    "sharedCommitmentCents",
  ])
    for (const invalid of [
      -1,
      0.5,
      1_000_000_000_001,
      Number.NaN,
      "100",
      undefined,
    ])
      assert.throws(
        () => validateReservePlan({ ...input, [key]: invalid }),
        `${key}: ${String(invalid)}`,
      );
  assert.throws(() =>
    validateReservePlan({ ...input, minimumBalanceCents: null }),
  );
  assert.throws(() =>
    validateReservePlan({ ...input, extraExpenseCents: null }),
  );
});

test("ajustes restringem mês e rejeitam proprietário ou identificadores enviados pelo cliente", () => {
  const input = defaultReservePlan("2026-11");
  for (const month of [
    "2026-00",
    "2026-13",
    "2026-1",
    "2026-11-01",
    "0000-01",
    null,
  ])
    assert.throws(() => validateReservePlan({ ...input, month }));
  for (const key of ["ownerId", "id", "scope", "coupleId", "suggestedCents"])
    assert.throws(() => validateReservePlan({ ...input, [key]: "forged" }));
  assert.throws(() => validateReservePlan([]));
});
