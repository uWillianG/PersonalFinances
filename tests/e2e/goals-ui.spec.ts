import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { demoState } from "../../lib/demo.ts";
import { currentMonth } from "../../lib/finance.ts";
import type { GoalMovement, GoalMovementInput } from "../../lib/goals-types.ts";

/** Demo writes must stay in memory, including every goal and contribution. */
async function openDemo(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  return writes;
}

async function navigate(page: Page, label: string): Promise<void> {
  const desktop = page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("button", { name: label, exact: true });
  if (await desktop.isVisible()) {
    await desktop.click();
    return;
  }
  const mobile = page.getByRole("navigation", {
    name: "Navegação no celular",
    exact: true,
  });
  const direct = mobile.getByRole("button", { name: label, exact: true });
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await mobile
    .getByRole("button", { name: "Mais opções", exact: true })
    .click();
  const menu = page.getByRole("dialog", {
    name: "Explorar o Clara",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await menu
    .getByRole("navigation", { name: "Todas as seções", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(menu).toHaveCount(0);
}

async function ledgerSnapshot(page: Page): Promise<string[]> {
  await navigate(page, "Lançamentos");
  const rows = page.locator(".full-panel .transaction-row");
  await expect(rows).toHaveCount(21);
  return rows.allTextContents();
}

async function openGoals(page: Page): Promise<void> {
  await navigate(page, "Metas e caixinhas");
  await expect(
    page.getByRole("heading", {
      name: "Cada objetivo, mais perto.",
      exact: true,
    }),
  ).toBeVisible();
}

test.describe("Metas e caixinhas em modo demonstração", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("cria e edita uma meta pessoal e registra um aporte sem duplicar o extrato", async ({
    page,
  }) => {
    const writes = await openDemo(page);
    const before = await ledgerSnapshot(page);
    await openGoals(page);
    const initialName = `Objetivo E2E ${randomUUID().slice(0, 8)}`;
    const finalName = `${initialName} revisado`;
    await page.getByRole("button", { name: "Nova meta", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Nova meta", exact: true });
    await form.getByLabel("Nome da meta", { exact: true }).fill(initialName);
    await form
      .getByLabel("Visibilidade", { exact: true })
      .selectOption("personal");
    await form
      .getByLabel("Valor desejado (R$)", { exact: true })
      .fill("1.000,00");
    await form
      .getByLabel("Prazo (opcional)", { exact: true })
      .fill(`${new Date().getUTCFullYear() + 1}-12-31`);
    await form.getByRole("button", { name: "Criar meta", exact: true }).click();
    await expect(form).toHaveCount(0);
    const initialCard = page.getByRole("article", {
      name: initialName,
      exact: true,
    });
    await expect(initialCard).toBeVisible();
    await expect(initialCard.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    await expect(
      initialCard.getByRole("button", { name: "Resgatar", exact: true }),
    ).toBeDisabled();
    await initialCard
      .getByRole("button", { name: `Editar ${initialName}`, exact: true })
      .click();
    const edit = page.getByRole("dialog", { name: "Editar meta", exact: true });
    await expect(
      edit.getByLabel("Visibilidade", { exact: true }),
    ).toBeDisabled();
    await edit.getByLabel("Nome da meta", { exact: true }).fill(finalName);
    await edit
      .getByLabel("Valor desejado (R$)", { exact: true })
      .fill("1.500,00");
    await edit
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    await expect(initialCard).toHaveCount(0);
    const card = page.getByRole("article", { name: finalName, exact: true });
    await expect(card.locator(".goals-card-values")).toContainText("1.500,00");
    await card.getByRole("button", { name: "Aportar", exact: true }).click();
    const contribution = page.getByRole("dialog", {
      name: "Registrar aporte",
      exact: true,
    });
    await contribution
      .getByLabel("Valor do aporte (R$)", { exact: true })
      .fill("300,25");
    await contribution
      .getByLabel("Observação (opcional)", { exact: true })
      .fill("Primeira reserva de teste");
    await contribution
      .getByRole("button", { name: "Confirmar aporte", exact: true })
      .click();
    await expect(contribution).toHaveCount(0);
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "300,25",
    );
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    await card
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    const history = page.getByRole("dialog", {
      name: "Histórico da caixinha",
      exact: true,
    });
    await expect(history.locator(".goals-history-list > li")).toHaveCount(1);
    await expect(history).toContainText("Primeira reserva de teste");
    await expect(
      history.getByRole("button", { name: "Excluir meta", exact: true }),
    ).toHaveCount(0);
    await history
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
    expect(await ledgerSnapshot(page)).toEqual(before);
    expect(
      writes,
      "Criar, editar e aportar na demo deve permanecer em memória",
    ).toEqual([]);
  });

  test("no celular resgates respeitam a reserva e arquivar preserva saldo e histórico", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const writes = await openDemo(page);
    const before = await ledgerSnapshot(page);
    await openGoals(page);
    const card = page.getByRole("article", {
      name: "Novo notebook",
      exact: true,
    });
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "1.800,00",
    );
    await card.getByRole("button", { name: "Aportar", exact: true }).click();
    const contribution = page.getByRole("dialog", {
      name: "Registrar aporte",
      exact: true,
    });
    await contribution
      .getByLabel("Valor do aporte (R$)", { exact: true })
      .fill("200,25");
    await contribution
      .getByRole("button", { name: "Confirmar aporte", exact: true })
      .click();
    await expect(contribution).toHaveCount(0);
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "2.000,25",
    );
    await card.getByRole("button", { name: "Resgatar", exact: true }).click();
    const withdrawal = page.getByRole("dialog", {
      name: "Registrar resgate",
      exact: true,
    });
    await withdrawal
      .getByLabel("Valor do resgate (R$)", { exact: true })
      .fill("2.500,00");
    await withdrawal
      .getByRole("button", { name: "Confirmar resgate", exact: true })
      .click();
    await expect(withdrawal.getByRole("alert")).toContainText(
      "O resgate não pode ultrapassar",
    );
    await expect(withdrawal).toBeVisible();
    await withdrawal
      .getByLabel("Valor do resgate (R$)", { exact: true })
      .fill("500,25");
    await withdrawal
      .getByLabel("Observação (opcional)", { exact: true })
      .fill("Ajuste da reserva");
    await withdrawal
      .getByRole("button", { name: "Confirmar resgate", exact: true })
      .click();
    await expect(withdrawal).toHaveCount(0);
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "1.500,00",
    );
    const total = page.locator(".goals-total > strong");
    await expect(total).toContainText("6.000,00");
    await card
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    const history = page.getByRole("dialog", {
      name: "Histórico da caixinha",
      exact: true,
    });
    await expect(history.locator(".goals-history-list > li")).toHaveCount(3);
    await expect(history).toContainText("Ajuste da reserva");
    await history
      .getByRole("button", { name: "Arquivar meta", exact: true })
      .click();
    await expect(history).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await expect(total).toContainText("6.000,00");
    await page
      .getByRole("checkbox", { name: "Mostrar arquivadas (1)", exact: true })
      .check();
    await expect(card).toBeVisible();
    await expect(card.locator(".goals-status")).toHaveText("Arquivada");
    await expect(
      card.getByRole("button", { name: "Aportar", exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByRole("button", { name: "Resgatar", exact: true }),
    ).toBeEnabled();
    await card
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    await expect(history.locator(".goals-history-list > li")).toHaveCount(3);
    await expect(
      history.getByRole("button", { name: "Excluir meta", exact: true }),
    ).toHaveCount(0);
    await history
      .getByRole("button", { name: "Reativar meta", exact: true })
      .click();
    await expect(history).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Aportar", exact: true }),
    ).toBeEnabled();
    await expect(card.locator(".goals-status")).toHaveText("Em construção");
    expect(await ledgerSnapshot(page)).toEqual(before);
    expect(
      writes,
      "Aportes, resgates e arquivamento na demo não escrevem na API",
    ).toEqual([]);
  });

  test("caixinha conjunta soma os dois autores e mantém metas pessoais separadas", async ({
    page,
  }) => {
    const writes = await openDemo(page);
    const before = await ledgerSnapshot(page);
    await openGoals(page);
    await expect(page.locator(".goals-total > strong")).toContainText(
      "6.300,00",
    );
    await page
      .getByRole("group", { name: "Metas pessoais ou do casal", exact: true })
      .getByRole("button", { name: "Do casal", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Reserva de emergência", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("article", { name: "Novo notebook", exact: true }),
    ).toHaveCount(0);
    const card = page.getByRole("article", {
      name: "Nossa próxima viagem",
      exact: true,
    });
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "2.700,00",
    );
    await expect(page.locator(".goals-total > strong")).toContainText(
      "2.700,00",
    );
    await card
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    const history = page.getByRole("dialog", {
      name: "Histórico da caixinha",
      exact: true,
    });
    await expect(history.locator(".goals-history-list > li")).toHaveCount(2);
    await expect(history.locator(".goals-history-list")).toContainText("Alex");
    await expect(history.locator(".goals-history-list")).toContainText("Você");
    await history
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
    await card.getByRole("button", { name: "Aportar", exact: true }).click();
    const contribution = page.getByRole("dialog", {
      name: "Registrar aporte",
      exact: true,
    });
    await expect(contribution).toContainText("O casal verá este movimento");
    await contribution
      .getByLabel("Valor do aporte (R$)", { exact: true })
      .fill("125,50");
    await contribution
      .getByLabel("Observação (opcional)", { exact: true })
      .fill("Mais perto das férias");
    await contribution
      .getByRole("button", { name: "Confirmar aporte", exact: true })
      .click();
    await expect(contribution).toHaveCount(0);
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "2.825,50",
    );
    await card
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    await expect(history.locator(".goals-history-list > li")).toHaveCount(3);
    await expect(history.locator(".goals-history-list")).toContainText(
      "Mais perto das férias",
    );
    await history
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Metas pessoais ou do casal", exact: true })
      .getByRole("button", { name: "Pessoais", exact: true })
      .click();
    await expect(page.locator(".goals-total > strong")).toContainText(
      "6.300,00",
    );
    expect(await ledgerSnapshot(page)).toEqual(before);
    expect(
      writes,
      "Movimentos conjuntos da demo não enviam dados à API",
    ).toEqual([]);
  });

  test("aporte salvo continua visível quando a atualização posterior falha", async ({
    page,
    baseURL,
  }) => {
    test.skip(
      !baseURL ||
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(baseURL).hostname,
        ),
      "A autenticação fictícia deste teste exige o preview local em loopback.",
    );
    const initial = demoState(currentMonth());
    const goalId = "demo-goal-notebook";
    const movementPath = `/api/goals/${goalId}/movements`;
    const writes: string[] = [];
    let saved: GoalMovement | null = null;
    let failedRefreshes = 0;
    // Every API call is fulfilled locally; even the successful POST never reaches D1.
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "GET" && path === "/api/state") {
        if (saved) {
          failedRefreshes += 1;
          await route.fulfill({
            status: 503,
            json: { error: "Falha simulada na atualização." },
          });
        } else {
          await route.fulfill({ status: 200, json: initial });
        }
        return;
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        writes.push(`${request.method()} ${path}`);
        if (request.method() === "POST" && path === movementPath) {
          const input = request.postDataJSON() as GoalMovementInput;
          saved = {
            ...input,
            goalId,
            ownerId: initial.user.id,
            ownerName: initial.user.name,
            createdAt: new Date().toISOString(),
          };
          await route.fulfill({ status: 201, json: { movement: saved } });
          return;
        }
      }
      await route.abort("blockedbyclient");
    });
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
      page.getByText("Modo demonstração", { exact: true }),
    ).toHaveCount(0);
    await openGoals(page);
    const card = page.getByRole("article", {
      name: "Novo notebook",
      exact: true,
    });
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "1.800,00",
    );
    await card.getByRole("button", { name: "Aportar", exact: true }).click();
    const form = page.getByRole("dialog", {
      name: "Registrar aporte",
      exact: true,
    });
    await form
      .getByLabel("Valor do aporte (R$)", { exact: true })
      .fill("250,25");
    await form
      .getByLabel("Observação (opcional)", { exact: true })
      .fill("Aporte salvo antes da falha de atualização");
    await form
      .getByRole("button", { name: "Confirmar aporte", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    await expect(card.locator(".goals-card-values > strong")).toContainText(
      "2.050,25",
    );
    await expect(page.locator(".notice.error")).toContainText(
      "Falha simulada na atualização.",
    );
    await expect(
      page
        .locator(".notice.error")
        .getByRole("button", { name: "Tentar novamente", exact: true }),
    ).toBeVisible();
    await card
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    const history = page.getByRole("dialog", {
      name: "Histórico da caixinha",
      exact: true,
    });
    await expect(history.locator(".goals-history-list > li")).toHaveCount(2);
    await expect(history.locator(".goals-history-list")).toContainText(
      "Aporte salvo antes da falha de atualização",
    );
    await expect(
      history.locator(".goals-detail-balance > strong"),
    ).toContainText("2.050,25");
    expect(failedRefreshes).toBeGreaterThan(0);
    expect(writes).toEqual([`POST ${movementPath}`]);
  });
});
