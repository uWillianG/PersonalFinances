import { expect, test, type APIResponse } from "@playwright/test";
import type { AppState } from "../../lib/types";
import type { ReservePlan } from "../../lib/reserve-types";

async function success<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
test("ajustes de reserva persistem por mês sem alterar contas, metas ou lançamentos", async ({
  request,
  baseURL,
}) => {
  test.skip(
    !baseURL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
    "Usar somente o banco local sintético.",
  );
  expect(
    (
      await request.get("/signin-with-chatgpt?return_to=/", { maxRedirects: 0 })
    ).status(),
  ).toBe(302);
  const before = await success<AppState>(await request.get("/api/state"));
  expect(before.user.id).toBe("local_seedy");
  expect(before.user.email).toBe("seedy@sites.test");
  const month = Array.from({ length: 100 }, (_, i) => `${2090 + i}-08`).find(
    (month) =>
      !(before.reservePlans ?? []).some((plan) => plan.month === month),
  );
  expect(month).toBeTruthy();
  const input = {
    month: month!,
    minimumBalanceCents: 50000,
    extraExpenseCents: 10000,
    cardReserveCents: null,
    goalReserveCents: 0,
    sharedCommitmentCents: null,
  };
  try {
    const first = await success<{ plan: ReservePlan }>(
      await request.post("/api/reserve-plans", { data: input }),
      201,
    );
    expect(first.plan).toMatchObject({ ...input, ownerId: before.user.id });
    const second = await success<{ plan: ReservePlan }>(
      await request.post("/api/reserve-plans", {
        data: { ...input, minimumBalanceCents: 60000, cardReserveCents: 25000 },
      }),
      201,
    );
    expect(second.plan.id).toBe(first.plan.id);
    const after = await success<AppState>(await request.get("/api/state"));
    expect(
      after.reservePlans?.filter((plan) => plan.month === month),
    ).toHaveLength(1);
    expect(
      after.reservePlans?.find((plan) => plan.month === month),
    ).toMatchObject({
      minimumBalanceCents: 60000,
      cardReserveCents: 25000,
      goalReserveCents: 0,
    });
    expect(after.sources).toEqual(before.sources);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.goalMovements).toEqual(before.goalMovements);
    for (const bad of [
      { ...input, ownerId: "forged" },
      { ...input, extraExpenseCents: -1 },
      { ...input, month: "2026-13" },
      { ...input, cardReserveCents: 0.1 },
    ])
      expect(
        (await request.post("/api/reserve-plans", { data: bad })).status(),
      ).toBe(400);
  } finally {
    await success(await request.delete(`/api/reserve-plans/${month}`));
  }
  expect(
    (
      await success<AppState>(await request.get("/api/state"))
    ).reservePlans?.some((plan) => plan.month === month),
  ).toBe(false);
});
