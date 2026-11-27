import {
  expect,
  test,
  type Page,
  type Request as BrowserRequest,
  type Route,
} from "@playwright/test";
import { demoState } from "../../lib/demo.ts";
import { currentMonth } from "../../lib/finance.ts";
import type { AppState, Source } from "../../lib/types.ts";
import type { BudgetInput, BudgetLimit } from "../../lib/planning-types.ts";

async function navigate(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function openSignedIn(
  page: Page,
  handler: (route: Route) => Promise<void>,
) {
  await page.route("**/api/**", handler);
  const login = await page.request.get("/signin-with-chatgpt?return_to=/", {
    maxRedirects: 0,
  });
  expect(login.status()).toBe(302);
  expect(login.headers()["set-cookie"]).toContain("__sites_local_auth=1");
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("heading", {
      name: "Seu dinheiro, mais claro.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toHaveCount(0);
}
function initialState(): AppState {
  const initial = demoState(currentMonth());
  initial.budgets = [];
  return initial;
}
function budgetCard(page: Page, category: string) {
  return page.locator(".rb-budget-card").filter({
    has: page.getByRole("heading", { name: category, exact: true }),
  });
}
async function createBudget(page: Page, category: string, limit = "250,50") {
  await page.getByRole("button", { name: "Novo limite", exact: true }).click();
  await page.getByLabel("Categoria", { exact: true }).fill(category);
  await page.getByLabel("Limite do mês (R$)", { exact: true }).fill(limit);
  await page
    .getByRole("button", { name: "Salvar limite", exact: true })
    .click();
  await expect(page.locator(".rb-budget-editor")).toHaveCount(0);
}
function valueFromInput(
  input: BudgetInput,
  initial: AppState,
  id: string,
): BudgetLimit {
  return {
    ...input,
    id,
    ownerId: initial.user.id,
    ownerName: initial.user.name,
    canEdit: true,
  };
}

test.describe("Estado confirmado pelo servidor durante falhas de atualização", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.skip(
    ({ baseURL }) =>
      !baseURL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
    "O login fictício usado nestes mocks exige preview local.",
  );

  for (const action of ["create", "join"] as const) {
    test(`casal confirmado ao ${action === "create" ? "criar convite" : "entrar com convite"} continua visível com GET503`, async ({
      page,
    }) => {
      const initial = initialState();
      initial.couple = null;
      initial.partnerTransactions = [];
      initial.transactions = initial.transactions.map((row) => ({
        ...row,
        shared: false,
      }));
      initial.schedules = [];
      initial.occurrences = [];
      initial.goals = [];
      initial.goalMovements = [];
      const couple = {
        id: "audit-confirmed-couple",
        members: [
          { id: initial.user.id, name: initial.user.name },
          ...(action === "join" ? [{ id: "audit-partner", name: "Alex" }] : []),
        ],
      };
      const code = "ABCDEFGHJKLM";
      const writes: Record<string, unknown>[] = [];
      let wrote = false;
      await openSignedIn(page, async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (request.method() === "GET" && path === "/api/state") {
          await route.fulfill(
            wrote
              ? {
                  status: 503,
                  json: { error: "Falha simulada depois de conectar o casal." },
                }
              : { json: initial },
          );
          return;
        }
        if (request.method() === "POST" && path === "/api/couple") {
          writes.push(request.postDataJSON() as Record<string, unknown>);
          wrote = true;
          await route.fulfill({
            json: { couple, ...(action === "create" ? { code } : {}) },
          });
          return;
        }
        await route.abort("blockedbyclient");
      });
      await navigate(page, "Nosso espaço");
      await expect(
        page.getByRole("heading", {
          name: "Um espaço para o que é dos dois.",
          exact: true,
        }),
      ).toBeVisible();
      if (action === "join") {
        await page.getByLabel("Código do casal", { exact: true }).fill(code);
        await page
          .getByRole("button", { name: "Entrar no espaço", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: "Criar espaço do casal", exact: true })
          .click();
      }
      await expect(
        page.getByRole("heading", {
          name: action === "create" ? "Seu espaço está pronto." : "Você & Alex",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".notice.error")).toContainText(
        "Falha simulada depois de conectar o casal.",
      );
      if (action === "create")
        await expect(page.locator(".invite-code code")).toHaveText(code);
      await expect(
        page.getByRole("button", {
          name: "Criar espaço do casal",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(writes).toEqual([{ action, code: action === "join" ? code : "" }]);
    });
  }

  test("conta salva permanece visível se a consulta posterior falhar", async ({
    page,
  }) => {
    const initial = initialState();
    const writes: string[] = [];
    const sourceBodies: Record<string, unknown>[] = [];
    let markPosted: () => void = () => {};
    let releasePost: () => void = () => {};
    const posted = new Promise<void>((resolve) => {
      markPosted = resolve;
    });
    const postRelease = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let saved: Source | null = null;
    await openSignedIn(page, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === "GET" && path === "/api/state") {
        await route.fulfill(
          saved
            ? {
                status: 503,
                json: { error: "Falha simulada depois de salvar a conta." },
              }
            : { json: initial },
        );
        return;
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()))
        writes.push(`${request.method()} ${path}`);
      if (request.method() === "POST" && path === "/api/sources") {
        const body = request.postDataJSON() as Record<string, unknown>;
        sourceBodies.push(body);
        saved = {
          ...body,
          id: "audit-created-source",
          ownerId: initial.user.id,
        } as Source;
        markPosted();
        await postRelease;
        await route.fulfill({ status: 201, json: { source: saved } });
        return;
      }
      await route.abort("blockedbyclient");
    });
    await navigate(page, "Contas e saldos");
    await page
      .getByRole("button", { name: "Adicionar conta", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Adicionar conta",
      exact: true,
    });
    try {
      await form
        .getByLabel("Nome da conta", { exact: true })
        .fill("Conta da auditoria de rede");
      await form
        .getByLabel("Saldo de partida (R$)", { exact: true })
        .fill("1.000");
      await form
        .getByRole("button", { name: "Salvar conta", exact: true })
        .click();
      await posted;
      await expect(
        form.getByRole("button", { name: "Salvar conta", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(form).toBeVisible();
      expect(sourceBodies).toHaveLength(1);
      expect(sourceBodies[0].initialBalanceCents).toBe(100000);
      releasePost();
      await expect(form).toHaveCount(0);
      const card = page.locator(".source-card").filter({
        has: page.getByRole("heading", {
          name: "Conta da auditoria de rede",
          exact: true,
        }),
      });
      await expect(card).toBeVisible();
      await expect(card).toContainText("1.000,00");
      await expect(page.locator(".notice.error")).toContainText(
        "Falha simulada depois de salvar a conta.",
      );
      expect(writes).toEqual(["POST /api/sources"]);
    } finally {
      releasePost();
    }
  });

  test("orçamentos criados, editados, removidos e copiados refletem a resposta mesmo com GET503", async ({
    page,
  }) => {
    const initial = initialState();
    const prior = new Date(`${currentMonth()}-01T12:00:00Z`);
    prior.setUTCMonth(prior.getUTCMonth() - 1);
    initial.budgets = [
      valueFromInput(
        {
          scope: "personal",
          month: prior.toISOString().slice(0, 7),
          category: "Categoria copiada na auditoria",
          limitCents: 42000,
        },
        initial,
        "audit-prior-budget",
      ),
    ];
    let saved: BudgetLimit | null = null,
      wrote = false;
    const writes: string[] = [];
    await openSignedIn(page, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === "GET" && path === "/api/state") {
        await route.fulfill(
          wrote
            ? {
                status: 503,
                json: {
                  error: "Falha simulada na atualização dos orçamentos.",
                },
              }
            : { json: initial },
        );
        return;
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()))
        writes.push(`${request.method()} ${path}`);
      if (request.method() === "POST" && path === "/api/budgets") {
        wrote = true;
        saved = valueFromInput(
          request.postDataJSON() as BudgetInput,
          initial,
          "audit-budget",
        );
        await route.fulfill({ status: 201, json: { budget: saved } });
        return;
      }
      if (
        request.method() === "PATCH" &&
        path === "/api/budgets/audit-budget" &&
        saved
      ) {
        saved = {
          ...saved,
          limitCents: (request.postDataJSON() as { limitCents: number })
            .limitCents,
        };
        await route.fulfill({ json: { budget: saved } });
        return;
      }
      if (
        request.method() === "DELETE" &&
        path === "/api/budgets/audit-budget"
      ) {
        saved = null;
        await route.fulfill({ json: { deleted: true } });
        return;
      }
      if (request.method() === "POST" && path === "/api/budgets/copy") {
        const copied = {
          ...initial.budgets![0],
          id: "audit-copied-budget",
          month: currentMonth(),
        };
        await route.fulfill({
          json: { copied: 1, skipped: 0, budgets: [copied] },
        });
        return;
      }
      await route.abort("blockedbyclient");
    });
    await navigate(page, "Orçamentos");
    const category = "Categoria criada na auditoria";
    await createBudget(page, category);
    const card = budgetCard(page, category);
    await expect(card.locator(".rb-budget-spent")).toContainText("250,50");
    await expect(page.locator(".notice.error")).toContainText(
      "Falha simulada na atualização dos orçamentos.",
    );
    await card
      .getByRole("button", {
        name: `Editar limite de ${category}`,
        exact: true,
      })
      .click();
    await page.getByLabel("Limite do mês (R$)", { exact: true }).fill("350,75");
    await page
      .getByRole("button", { name: "Salvar limite", exact: true })
      .click();
    await expect(page.locator(".rb-budget-editor")).toHaveCount(0);
    await expect(card.locator(".rb-budget-spent")).toContainText("350,75");
    await card
      .getByRole("button", {
        name: `Remover limite de ${category}`,
        exact: true,
      })
      .click();
    await card.getByRole("button", { name: "Remover", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page
      .getByRole("button", { name: "Copiar mês anterior", exact: true })
      .click();
    await expect(
      budgetCard(page, "Categoria copiada na auditoria").locator(
        ".rb-budget-spent",
      ),
    ).toContainText("420,00");
    expect(writes).toEqual([
      "POST /api/budgets",
      "PATCH /api/budgets/audit-budget",
      "DELETE /api/budgets/audit-budget",
      "POST /api/budgets/copy",
    ]);
  });

  test("consulta antiga liberada depois de uma escrita não apaga os registros confirmados", async ({
    page,
  }) => {
    const initial = initialState(),
      writes: string[] = [];
    let wrote = false,
      holdNext = false,
      heldRequest: BrowserRequest | null = null;
    let releaseStale: () => void = () => {};
    let markHeld: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    await openSignedIn(page, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === "GET" && path === "/api/state") {
        if (holdNext) {
          holdNext = false;
          heldRequest = request;
          markHeld();
          await release;
          await route.fulfill({ json: initial });
          return;
        }
        await route.fulfill(
          wrote
            ? {
                status: 503,
                json: {
                  error:
                    "Atualização indisponível na auditoria de concorrência.",
                },
              }
            : { json: initial },
        );
        return;
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()))
        writes.push(`${request.method()} ${path}`);
      if (request.method() === "POST" && path === "/api/budgets") {
        wrote = true;
        const input = request.postDataJSON() as BudgetInput;
        await route.fulfill({
          status: 201,
          json: {
            budget: valueFromInput(
              input,
              initial,
              `audit-concurrent-${writes.length}`,
            ),
          },
        });
        return;
      }
      await route.abort("blockedbyclient");
    });
    try {
      await navigate(page, "Orçamentos");
      await createBudget(page, "Primeiro limite da auditoria", "100,00");
      await expect(page.locator(".notice.error")).toContainText(
        "Atualização indisponível",
      );
      holdNext = true;
      await page
        .locator(".notice.error")
        .getByRole("button", { name: "Tentar novamente", exact: true })
        .click();
      await held;
      await createBudget(page, "Segundo limite da auditoria", "200,00");
      await expect(
        budgetCard(page, "Segundo limite da auditoria"),
      ).toBeVisible();
      await expect(page.locator(".notice.error")).toContainText(
        "Atualização indisponível",
      );
      const staleResponse = page.waitForResponse(
        (response) => response.request() === heldRequest,
      );
      releaseStale();
      await (await staleResponse).finished();
      // Wait for the delivered response and React's next paints, without a
      // timed sleep, before checking that it did not replace the newer cache.
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      await expect(
        budgetCard(page, "Primeiro limite da auditoria"),
      ).toBeVisible();
      await expect(
        budgetCard(page, "Segundo limite da auditoria"),
      ).toBeVisible();
      expect(writes).toEqual(["POST /api/budgets", "POST /api/budgets"]);
    } finally {
      releaseStale();
    }
  });

  test("HTTP200 com erro ou HTML não confirma uma escrita nem apaga o último estado válido", async ({
    page,
  }) => {
    const initial = initialState(),
      writes: string[] = [];
    let attempts = 0,
      brokenReads = 0,
      saved: Source | null = null;
    await openSignedIn(page, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === "GET" && path === "/api/state") {
        if (!saved) {
          await route.fulfill({ json: initial });
          return;
        }
        brokenReads += 1;
        if (brokenReads === 1) {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Entrar</title>",
          });
          return;
        }
        if (brokenReads === 2) {
          await route.fulfill({ status: 200, json: {} });
          return;
        }
        await route.fulfill({
          json: { ...initial, sources: [...initial.sources, saved] },
        });
        return;
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()))
        writes.push(`${request.method()} ${path}`);
      if (request.method() === "POST" && path === "/api/sources") {
        attempts += 1;
        if (attempts === 1) {
          await route.fulfill({
            status: 200,
            json: { error: "Confirmação inválida simulada." },
          });
          return;
        }
        saved = {
          ...request.postDataJSON(),
          id: "audit-recovered-source",
          ownerId: initial.user.id,
        } as Source;
        await route.fulfill({ status: 201, json: { source: saved } });
        return;
      }
      await route.abort("blockedbyclient");
    });
    await navigate(page, "Contas e saldos");
    await page
      .getByRole("button", { name: "Adicionar conta", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Adicionar conta",
      exact: true,
    });
    await form
      .getByLabel("Nome da conta", { exact: true })
      .fill("Conta com resposta protegida");
    await form
      .getByLabel("Saldo de partida (R$)", { exact: true })
      .fill("20,00");
    await form
      .getByRole("button", { name: "Salvar conta", exact: true })
      .click();
    await expect(form).toBeVisible();
    await expect(
      form.getByRole("button", { name: "Salvar conta", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".toast")).toContainText(
      "Confirmação inválida simulada.",
    );
    expect(writes).toEqual(["POST /api/sources"]);
    await form
      .getByRole("button", { name: "Salvar conta", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    const card = page.locator(".source-card").filter({
      has: page.getByRole("heading", {
        name: "Conta com resposta protegida",
        exact: true,
      }),
    });
    await expect(card).toBeVisible();
    await expect(page.locator(".notice.error")).toContainText(
      "Não foi possível ler a resposta do servidor",
    );
    await page
      .locator(".notice.error")
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await expect(page.locator(".notice.error")).toContainText(
      "A resposta do servidor está incompleta",
    );
    await expect(card).toBeVisible();
    await page
      .locator(".notice.error")
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await expect(page.locator(".notice.error")).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(card).toContainText("20,00");
    expect(writes).toEqual(["POST /api/sources", "POST /api/sources"]);
  });
});
