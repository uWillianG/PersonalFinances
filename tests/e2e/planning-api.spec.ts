import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { parseStatement } from "../../lib/import-parser.ts";
import type {
  BudgetLimit,
  RecurringSchedule,
  ScheduleInput,
  ScheduleOccurrence,
} from "../../lib/planning-types.ts";
import type { AppState, Source } from "../../lib/types.ts";

function isLoopback(baseURL: string | undefined): boolean {
  return (
    !!baseURL &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)
  );
}

async function successful<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

async function state(request: APIRequestContext): Promise<AppState> {
  return successful<AppState>(await request.get("/api/state"));
}

async function signIn(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/signin-with-chatgpt?return_to=/", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const initial = await state(request);
  // A loopback URL alone is insufficient if a developer proxies production.
  expect(
    initial.user.id,
    "Execute apenas com a identidade fictícia do D1 local de teste.",
  ).toBe("local_seedy");
  expect(initial.user.email).toBe("seedy@sites.test");
  return initial;
}

function scheduleInput(
  name: string,
  changes: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    scope: "personal",
    name,
    kind: "expense",
    category: "Moradia",
    amountCents: 15000,
    frequency: "monthly",
    startDate: "2026-11-25",
    endDate: null,
    active: true,
    ...changes,
  };
}

test.describe("API de planejamento no banco local de teste", () => {
  test.skip(
    ({ baseURL }) => !isLoopback(baseURL),
    "Estes testes mutam somente o preview local com dados sintéticos.",
  );

  test("orçamento pessoal faz upsert por categoria normalizada, copia sem sobrescrever e permite editar/excluir", async ({
    request,
  }) => {
    const initial = await signIn(request);
    expect(
      initial.couple,
      "Use um banco local de teste sem casal preexistente.",
    ).toBeNull();
    const suffix = randomUUID();
    const category = `Saúde sintética ${suffix}`;
    const otherCategory = `Lazer sintético ${suffix}`;
    const ids = new Set<string>();
    // The copy endpoint intentionally copies a complete month. Reserve two
    // empty months so it cannot also copy an unrelated local test budget.
    const year = Array.from({ length: 100 }, (_, index) => 2090 + index).find(
      (value) =>
        !(initial.budgets ?? []).some(
          (budget) =>
            budget.scope === "personal" &&
            [`${value}-11`, `${value}-12`].includes(budget.month),
        ),
    );
    expect(
      year,
      "O banco local precisa de dois meses vazios para esta cópia.",
    ).toBeDefined();
    const fromMonth = `${year}-11`;
    const toMonth = `${year}-12`;
    try {
      const body = {
        scope: "personal",
        month: fromMonth,
        category,
        limitCents: 10000,
      };
      const first = await successful<{ budget: BudgetLimit }>(
        await request.post("/api/budgets", { data: body }),
        201,
      );
      ids.add(first.budget.id);
      expect(first.budget).toMatchObject({
        ownerId: initial.user.id,
        ownerName: initial.user.name,
        canEdit: true,
        limitCents: 10000,
      });
      const repeated = await successful<{ budget: BudgetLimit }>(
        await request.post("/api/budgets", {
          data: {
            ...body,
            category: category
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toUpperCase(),
            limitCents: 20000,
          },
        }),
        201,
      );
      expect(repeated.budget.id).toBe(first.budget.id);
      const other = await successful<{ budget: BudgetLimit }>(
        await request.post("/api/budgets", {
          data: { ...body, category: otherCategory, limitCents: 30000 },
        }),
        201,
      );
      ids.add(other.budget.id);
      const existing = await successful<{ budget: BudgetLimit }>(
        await request.post("/api/budgets", {
          data: { ...body, month: toMonth, limitCents: 90000 },
        }),
        201,
      );
      ids.add(existing.budget.id);
      const copied = await successful<{ copied: number; skipped: number }>(
        await request.post("/api/budgets/copy", {
          data: { scope: "personal", fromMonth, toMonth },
        }),
      );
      expect(copied).toEqual({ copied: 1, skipped: 1 });
      const afterCopy = await state(request);
      const synthetic =
        afterCopy.budgets?.filter((budget) =>
          budget.category.toLowerCase().includes(suffix),
        ) ?? [];
      for (const budget of synthetic) ids.add(budget.id);
      expect(synthetic).toHaveLength(4);
      expect(
        synthetic.find((budget) => budget.id === existing.budget.id)
          ?.limitCents,
      ).toBe(90000);
      expect(
        synthetic.find(
          (budget) =>
            budget.month === toMonth && budget.category === otherCategory,
        )?.limitCents,
      ).toBe(30000);
      const edited = await successful<{ budget: BudgetLimit }>(
        await request.patch(`/api/budgets/${first.budget.id}`, {
          data: { limitCents: 23456 },
        }),
      );
      expect(edited.budget.limitCents).toBe(23456);
      expect(
        (
          await request.patch(`/api/budgets/${first.budget.id}`, {
            data: { limitCents: 1, ownerId: "forged" },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.post("/api/budgets", {
            data: { ...body, scope: "couple" },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.post("/api/budgets", {
            data: { ...body, month: "2026-13" },
          })
        ).status(),
      ).toBe(400);
    } finally {
      // Copy may have succeeded before a later assertion failed.
      for (const budget of (await state(request)).budgets ?? [])
        if (budget.category.toLowerCase().includes(suffix)) ids.add(budget.id);
      for (const id of ids)
        expect
          .soft((await request.delete(`/api/budgets/${id}`)).ok())
          .toBeTruthy();
    }
    expect((await state(request)).transactions).toEqual(initial.transactions);
  });

  test("confirmar, pular, pausar e limpar compromissos não muda o livro financeiro", async ({
    request,
  }) => {
    const initial = await signIn(request);
    const name = `Compromisso sintético ${randomUUID()}`;
    let id = "";
    try {
      const created = await successful<{ schedule: RecurringSchedule }>(
        await request.post("/api/schedules", { data: scheduleInput(name) }),
        201,
      );
      id = created.schedule.id;
      expect(created.schedule).toMatchObject({
        name,
        ownerId: initial.user.id,
        canEdit: true,
      });
      const mark = (
        action: "confirm" | "skip" | "reset",
        dueDate = "2026-11-25",
      ) =>
        request.post(`/api/schedules/${id}/occurrences`, {
          data: { dueDate, action },
        });
      const confirmed = await successful<{ occurrence: ScheduleOccurrence }>(
        await mark("confirm"),
      );
      expect(confirmed.occurrence).toMatchObject({
        state: "confirmed",
        transactionId: null,
      });
      const repeated = await successful<{ occurrence: ScheduleOccurrence }>(
        await mark("confirm"),
      );
      expect(repeated.occurrence.id).toBe(confirmed.occurrence.id);
      const skipped = await successful<{ occurrence: ScheduleOccurrence }>(
        await mark("skip"),
      );
      expect(skipped.occurrence.state).toBe("skipped");
      await successful(
        await request.patch(`/api/schedules/${id}`, {
          data: { active: false },
        }),
      );
      expect(
        (await state(request)).occurrences?.find(
          (item) => item.scheduleId === id,
        )?.state,
      ).toBe("skipped");
      expect((await mark("confirm", "2026-11-26")).status()).toBe(400);
      expect(
        (
          await request.patch(`/api/schedules/${id}`, {
            data: { scope: "couple" },
          })
        ).status(),
      ).toBe(400);
      // Moving a recurrence retains historical markers and still lets them be cleared.
      await successful(
        await request.patch(`/api/schedules/${id}`, {
          data: { startDate: "2026-11-26", active: true },
        }),
      );
      await successful(await mark("reset"));
      const after = await state(request);
      expect(after.occurrences?.some((item) => item.scheduleId === id)).toBe(
        false,
      );
      expect(after.transactions).toEqual(initial.transactions);
      expect(after.sources).toEqual(initial.sources);
    } finally {
      if (id)
        expect
          .soft((await request.delete(`/api/schedules/${id}`)).ok())
          .toBeTruthy();
    }
  });

  test("vincular usa lançamento existente uma única vez, respeita casal e limpa referência de importação removida", async ({
    request,
  }) => {
    const initial = await signIn(request);
    expect(
      initial.couple,
      "Use um banco local de teste sem casal preexistente.",
    ).toBeNull();
    const suffix = randomUUID();
    const scheduleIds: string[] = [];
    const budgetIds: string[] = [];
    let batchId = "";
    let createdCouple = false;
    const source = (
      await successful<{ source: Source }>(
        await request.post("/api/sources", {
          data: {
            name: `Planning API ${suffix}`,
            institution: "Sintética",
            type: "bank",
            initialBalanceCents: 0,
            balanceDate: "2026-11-01",
            hasOpeningBalance: true,
          },
        }),
        201,
      )
    ).source;
    try {
      expect(
        (
          await request.post("/api/schedules", {
            data: scheduleInput(`Sem casal ${suffix}`, { scope: "couple" }),
          })
        ).status(),
      ).toBe(400);
      const fixture = await readFile(
        new URL("../../fixtures/sample.csv", import.meta.url),
        "utf8",
      );
      const parsed = parseStatement(fixture, {
        fileName: "sample.csv",
        referenceMonth: "2026-11",
        sourceType: "bank",
      });
      const imported = await successful<{ batchId: string; imported: number }>(
        await request.post("/api/imports", {
          data: {
            items: parsed.rows.map((row) => ({
              ...row,
              sourceId: source.id,
              fileName: "sample.csv",
            })),
          },
        }),
        201,
      );
      batchId = imported.batchId;
      expect(imported.imported).toBe(5);
      const ledger = await state(request);
      const purchase = ledger.transactions.find(
        (item) => item.sourceId === source.id && item.kind === "expense",
      )!;
      const income = ledger.transactions.find(
        (item) => item.sourceId === source.id && item.kind === "income",
      )!;
      const personal = (
        await successful<{ schedule: RecurringSchedule }>(
          await request.post("/api/schedules", {
            data: scheduleInput(`Pessoal ${suffix}`, {
              frequency: "weekly",
              startDate: purchase.date,
            }),
          }),
          201,
        )
      ).schedule;
      scheduleIds.push(personal.id);
      const link = (
        id: string,
        transactionId: string,
        dueDate = purchase.date,
      ) =>
        request.post(`/api/schedules/${id}/occurrences`, {
          data: { dueDate, action: "link", transactionId },
        });
      expect((await link(personal.id, income.id)).status()).toBe(409);
      const first = await successful<{ occurrence: ScheduleOccurrence }>(
        await link(personal.id, purchase.id),
      );
      const repeated = await successful<{ occurrence: ScheduleOccurrence }>(
        await link(personal.id, purchase.id),
      );
      expect(repeated.occurrence.id).toBe(first.occurrence.id);
      const nextDate = new Date(`${purchase.date}T12:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 7);
      const nextDue = nextDate.toISOString().slice(0, 10);
      expect((await link(personal.id, purchase.id, nextDue)).status()).toBe(
        409,
      );
      await successful(
        await request.post(`/api/schedules/${personal.id}/occurrences`, {
          data: { dueDate: purchase.date, action: "reset" },
        }),
      );
      await successful(await link(personal.id, purchase.id, nextDue));
      await successful(
        await request.post(`/api/schedules/${personal.id}/occurrences`, {
          data: { dueDate: nextDue, action: "reset" },
        }),
      );
      expect((await state(request)).transactions).toEqual(ledger.transactions);

      await successful(
        await request.post("/api/couple", { data: { action: "create" } }),
      );
      createdCouple = true;
      const shared = (
        await successful<{ schedule: RecurringSchedule }>(
          await request.post("/api/schedules", {
            data: scheduleInput(`Casal ${suffix}`, {
              scope: "couple",
              startDate: purchase.date,
            }),
          }),
          201,
        )
      ).schedule;
      scheduleIds.push(shared.id);
      const sharedBudget = (
        await successful<{ budget: BudgetLimit }>(
          await request.post("/api/budgets", {
            data: {
              scope: "couple",
              month: "2026-11",
              category: `Casal ${suffix}`,
              limitCents: 30000,
            },
          }),
          201,
        )
      ).budget;
      budgetIds.push(sharedBudget.id);
      expect((await link(shared.id, purchase.id)).status()).toBe(409);
      await successful(
        await request.patch(`/api/transactions/${purchase.id}`, {
          data: { shared: true },
        }),
      );
      await successful(await link(shared.id, purchase.id));
      await successful(
        await request.patch(`/api/transactions/${purchase.id}`, {
          data: { shared: false },
        }),
      );
      expect(
        (await state(request)).occurrences?.find(
          (item) => item.scheduleId === shared.id,
        ),
      ).toMatchObject({ state: "confirmed", transactionId: null });
      await successful(
        await request.patch(`/api/transactions/${purchase.id}`, {
          data: { shared: true },
        }),
      );
      await successful(await link(shared.id, purchase.id));
      await successful(await request.delete(`/api/imports/${batchId}`));
      batchId = "";
      const afterDelete = await state(request);
      expect(
        afterDelete.occurrences?.find((item) => item.scheduleId === shared.id),
      ).toMatchObject({ state: "linked", transactionId: null });
      expect(afterDelete.transactions).toEqual(initial.transactions);
      await successful(
        await request.post("/api/couple", { data: { action: "leave" } }),
      );
      createdCouple = false;
      const afterLeave = await state(request);
      expect(afterLeave.schedules?.some((item) => item.id === shared.id)).toBe(
        false,
      );
      expect(
        afterLeave.budgets?.some((item) => item.id === sharedBudget.id),
      ).toBe(false);
      expect(
        afterLeave.schedules?.some((item) => item.id === personal.id),
      ).toBe(true);
    } finally {
      if (createdCouple)
        expect
          .soft(
            (
              await request.post("/api/couple", { data: { action: "leave" } })
            ).ok(),
          )
          .toBeTruthy();
      const remaining = await state(request);
      for (const id of scheduleIds)
        if (remaining.schedules?.some((item) => item.id === id))
          expect
            .soft((await request.delete(`/api/schedules/${id}`)).ok())
            .toBeTruthy();
      for (const id of budgetIds)
        if (remaining.budgets?.some((item) => item.id === id))
          expect
            .soft((await request.delete(`/api/budgets/${id}`)).ok())
            .toBeTruthy();
      if (batchId)
        expect
          .soft((await request.delete(`/api/imports/${batchId}`)).ok())
          .toBeTruthy();
      // The API has no source DELETE operation. This dedicated synthetic source
      // remains empty in the local test database, matching the existing API suite.
    }
  });
});
