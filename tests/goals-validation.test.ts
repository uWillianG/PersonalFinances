import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateGoal,
  validateGoalMovement,
  validateGoalPatch,
} from "../lib/goals-validation.ts";

const goal = {
  scope: "personal",
  name: "Reserva",
  targetCents: 100000,
  targetDate: null,
  archived: false,
};
const movement = {
  id: "067c99cb-e878-446f-b30d-897e2af7c112",
  kind: "deposit",
  amountCents: 10000,
  date: "2026-11-25",
  note: "",
};

test("metas aceitam prazo opcional ou vencido e preservam centavos inteiros", () => {
  assert.deepEqual(validateGoal(goal), goal);
  assert.equal(
    validateGoal({
      ...goal,
      scope: "couple",
      name: " Viagem ",
      targetDate: "2024-02-29",
    }).name,
    "Viagem",
  );
  for (const targetCents of [0, -1, 0.5, "100", 1_000_000_000_001, NaN])
    assert.throws(() => validateGoal({ ...goal, targetCents }));
  assert.throws(() => validateGoal({ ...goal, targetDate: "2025-02-29" }));
  assert.throws(() => validateGoal({ ...goal, scope: "all" }));
  assert.throws(() => validateGoal({ ...goal, archived: 0 }));
  assert.throws(() => validateGoal({ ...goal, name: " " }));
});

test("edição de meta não permite alterar titular, casal ou escopo", () => {
  assert.deepEqual(validateGoalPatch({ name: "Nova meta", targetDate: null }), {
    name: "Nova meta",
    targetDate: null,
  });
  assert.deepEqual(validateGoalPatch({ archived: true }), { archived: true });
  for (const input of [
    {},
    { scope: "couple" },
    { ownerId: "outro" },
    { coupleId: "outro" },
    { targetCents: 0 },
  ])
    assert.throws(() => validateGoalPatch(input));
});

test("aportes e resgates exigem data realizada e UUID estável para tentativas repetidas", () => {
  assert.deepEqual(validateGoalMovement(movement, "2026-11-25"), movement);
  assert.equal(
    validateGoalMovement(
      {
        ...movement,
        kind: "withdrawal",
        date: "2024-02-29",
        note: " Correção ",
      },
      "2026-11-25",
    ).note,
    "Correção",
  );
  assert.equal(
    validateGoalMovement(
      { ...movement, id: movement.id.toUpperCase() },
      "2026-11-25",
    ).id,
    movement.id,
  );
  for (const patch of [
    { id: "not-uuid" },
    { kind: "expense" },
    { amountCents: 0 },
    { amountCents: -1 },
    { amountCents: 0.1 },
    { date: "2026-11-26" },
    { date: "2026-02-30" },
    { ownerId: "outro" },
    { goalId: "outro" },
    { note: "x".repeat(251) },
  ])
    assert.throws(() =>
      validateGoalMovement({ ...movement, ...patch }, "2026-11-25"),
    );
});
