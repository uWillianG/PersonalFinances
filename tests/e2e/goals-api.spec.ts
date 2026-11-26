import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import type { AppState } from "../../lib/types";
import type { SavingsGoal, GoalMovement } from "../../lib/goals-types";

async function success<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function state(request: APIRequestContext) {
  return success<AppState>(await request.get("/api/state"));
}
async function signIn(request: APIRequestContext) {
  expect(
    (
      await request.get("/signin-with-chatgpt?return_to=/", { maxRedirects: 0 })
    ).status(),
  ).toBe(302);
  const initial = await state(request);
  expect(
    initial.user.id,
    "Use somente a identidade fictícia do D1 local.",
  ).toBe("local_seedy");
  expect(initial.user.email).toBe("seedy@sites.test");
  return initial;
}
const input = (name: string, scope = "personal") => ({
  name,
  scope,
  targetCents: 100000,
  targetDate: null,
  archived: false,
});

test.describe("Metas persistidas no D1 local de teste", () => {
  test.skip(
    ({ baseURL }) =>
      !baseURL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
    "Não mutar bancos hospedados.",
  );

  test("cria, edita e exclui meta vazia sem mudar contas ou lançamentos", async ({
    request,
  }) => {
    const before = await signIn(request);
    let id = "";
    try {
      const created = await success<{ goal: SavingsGoal }>(
        await request.post("/api/goals", {
          data: input(`Meta sintética ${randomUUID()}`),
        }),
        201,
      );
      id = created.goal.id;
      expect(created.goal).toMatchObject({
        scope: "personal",
        ownerId: before.user.id,
        targetCents: 100000,
      });
      await success(
        await request.patch(`/api/goals/${id}`, {
          data: { targetCents: 120000, targetDate: "2028-06-30" },
        }),
      );
      expect(
        (await state(request)).goals?.find((goal) => goal.id === id),
      ).toMatchObject({ targetCents: 120000, targetDate: "2028-06-30" });
      expect(
        (
          await request.patch(`/api/goals/${id}`, { data: { scope: "couple" } })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.patch(`/api/goals/${id}`, { data: { targetCents: 0 } })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.post("/api/goals", {
            data: { ...input("Inválida"), ownerId: "forged" },
          })
        ).status(),
      ).toBe(400);
    } finally {
      if (id) await success(await request.delete(`/api/goals/${id}`));
    }
    const after = await state(request);
    expect(after.sources).toEqual(before.sources);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.goalMovements).toEqual(before.goalMovements);
  });

  test("aportes idempotentes e resgates concorrentes preservam reservas e livro financeiro", async ({
    request,
  }) => {
    const before = await signIn(request);
    expect(
      before.couple,
      "Use um banco local sem vínculo preexistente.",
    ).toBeNull();
    let groupCreated = false;
    let id = "";
    try {
      await success(
        await request.post("/api/couple", { data: { action: "create" } }),
      );
      groupCreated = true;
      id = (
        await success<{ goal: SavingsGoal }>(
          await request.post("/api/goals", {
            data: input(`Caixinha sintética ${randomUUID()}`, "couple"),
          }),
          201,
        )
      ).goal.id;
      const body = {
        id: randomUUID(),
        kind: "deposit",
        amountCents: 10000,
        date: "2026-01-01",
        note: "Separado fora do aplicativo",
      };
      const add = (data: unknown) =>
        request.post(`/api/goals/${id}/movements`, { data });
      const movement = await success<{ movement: GoalMovement }>(
        await add(body),
        201,
      );
      expect(movement.movement).toMatchObject({
        id: body.id,
        ownerId: before.user.id,
        goalId: id,
        amountCents: 10000,
      });
      await success(await add(body), 201);
      expect(
        (await state(request)).goalMovements?.filter(
          (item) => item.goalId === id,
        ),
      ).toHaveLength(1);
      expect([400, 409]).toContain(
        (await add({ ...body, amountCents: 20000 })).status(),
      );
      const simultaneous = await Promise.all(
        [1, 2].map(() =>
          add({
            ...body,
            id: randomUUID(),
            kind: "withdrawal",
            amountCents: 7000,
          }),
        ),
      );
      expect(
        simultaneous.filter((result) => result.status() === 201),
      ).toHaveLength(1);
      expect(
        simultaneous.filter((result) => [400, 409].includes(result.status())),
      ).toHaveLength(1);
      await success(
        await request.patch(`/api/goals/${id}`, { data: { archived: true } }),
      );
      expect([400, 409]).toContain(
        (await add({ ...body, id: randomUUID() })).status(),
      );
      await success(
        await add({
          ...body,
          id: randomUUID(),
          kind: "withdrawal",
          amountCents: 3000,
        }),
        201,
      );
      expect([400, 409]).toContain(
        (await request.delete(`/api/goals/${id}`)).status(),
      );
      const after = await state(request);
      expect(
        after.goalMovements?.filter((item) => item.goalId === id),
      ).toHaveLength(3);
      expect(after.sources).toEqual(before.sources);
      expect(after.transactions).toEqual(before.transactions);
    } finally {
      // This test owns only the temporary couple it just created. Leaving
      // removes its shared planning through the schema's cascade.
      if (groupCreated)
        await success(
          await request.post("/api/couple", { data: { action: "leave" } }),
        );
    }
    const afterLeave = await state(request);
    expect(afterLeave.goals?.some((goal) => goal.id === id)).toBe(false);
    expect(afterLeave.goalMovements?.some((item) => item.goalId === id)).toBe(
      false,
    );
  });
});
