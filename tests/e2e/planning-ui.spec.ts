import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/** Demo actions must stay in browser memory, even if a callback regresses. */
async function openDemo(page: Page): Promise<string[]> {
  const apiWrites: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      apiWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
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
  return apiWrites;
}

async function navigate(page: Page, label: string): Promise<void> {
  const desktop = page
    .getByRole("navigation", {
      name: "Navegação principal",
      exact: true,
    })
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
  await expect(
    page.getByRole("heading", {
      name: "De perto, cada movimento.",
      exact: true,
    }),
  ).toBeVisible();
  const rows = page.locator(".full-panel .transaction-row");
  await expect(rows).toHaveCount(21);
  // Includes date, category, bank, amount and personal/shared designation.
  return rows.allTextContents();
}

test.describe("Relatórios e planejamento em modo demonstração", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("ranking reúne compras do mesmo estabelecimento e abre os dois lançamentos", async ({
    page,
  }) => {
    const apiWrites = await openDemo(page);
    await navigate(page, "Relatórios");
    await expect(
      page.getByRole("heading", {
        name: "Onde seu dinheiro vai.",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Buscar estabelecimento", { exact: true })
      .fill("Supermercado São João");
    await expect(page.locator(".rb-merchant-list > li")).toHaveCount(1);
    const merchant = page.locator(".rb-merchant-row");
    await expect(merchant.locator(".rb-merchant-count > strong")).toHaveText(
      "2",
    );
    await expect(
      merchant.locator(".rb-merchant-average > strong"),
    ).toContainText("272,65");
    await expect(merchant.locator(".rb-merchant-total > strong")).toContainText(
      "545,30",
    );
    await page
      .getByLabel("Ordenar estabelecimentos", { exact: true })
      .selectOption("visits");
    await merchant.click();
    const detail = page.getByRole("region", {
      name: "Lançamentos em Supermercado São João",
      exact: true,
    });
    await expect(detail).toBeVisible();
    await expect(detail.locator(".rb-detail-list > li")).toHaveCount(2);
    await expect(detail).toContainText("326,40");
    await expect(detail).toContainText("218,90");

    const scope = page.getByRole("group", {
      name: "Visão do relatório",
      exact: true,
    });
    await scope
      .getByRole("button", { name: "Só pessoais", exact: true })
      .click();
    await expect(page.locator(".rb-merchant-row")).toHaveCount(0);
    await scope.getByRole("button", { name: "Casal", exact: true }).click();
    await expect(
      page.locator(".rb-merchant-row .rb-merchant-total > strong"),
    ).toContainText("545,30");
    await page
      .getByLabel("Buscar estabelecimento", { exact: true })
      .fill("Jantar de sexta");
    await expect(page.locator(".rb-merchant-row")).toContainText("164,00");
    expect(
      apiWrites,
      "Consultar relatórios em demo não deve escrever na API",
    ).toEqual([]);
  });

  test("limites pessoais podem ser criados, editados e removidos; casal soma apenas gastos compartilhados", async ({
    page,
  }) => {
    const apiWrites = await openDemo(page);
    await navigate(page, "Orçamentos");
    await expect(
      page.getByRole("heading", { name: "Seu plano para o mês.", exact: true }),
    ).toBeVisible();
    const category = `Categoria E2E ${randomUUID().slice(0, 8)}`;
    await page
      .getByRole("button", { name: "Novo limite", exact: true })
      .click();
    await page.getByLabel("Categoria", { exact: true }).fill(category);
    await page.getByLabel("Limite do mês (R$)", { exact: true }).fill("250,50");
    await page
      .getByRole("button", { name: "Salvar limite", exact: true })
      .click();
    await expect(page.locator(".rb-budget-editor")).toHaveCount(0);
    const budget = page
      .locator(".rb-budget-card")
      .filter({
        has: page.getByRole("heading", { name: category, exact: true }),
      });
    await expect(budget).toBeVisible();
    await expect(budget.locator(".rb-budget-spent")).toContainText("250,50");
    await expect(budget.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    await budget
      .getByRole("button", {
        name: `Editar limite de ${category}`,
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Categoria", { exact: true })).toBeDisabled();
    await page.getByLabel("Limite do mês (R$)", { exact: true }).fill("350,75");
    await page
      .getByRole("button", { name: "Salvar limite", exact: true })
      .click();
    await expect(budget.locator(".rb-budget-spent")).toContainText("350,75");
    await budget
      .getByRole("button", {
        name: `Remover limite de ${category}`,
        exact: true,
      })
      .click();
    await expect(
      budget.getByRole("group", {
        name: `Confirmar remoção de ${category}`,
        exact: true,
      }),
    ).toBeVisible();
    await budget.getByRole("button", { name: "Remover", exact: true }).click();
    await expect(budget).toHaveCount(0);

    const foodBudget = page
      .locator(".rb-budget-card")
      .filter({
        has: page.getByRole("heading", { name: "Alimentação", exact: true }),
      });
    await expect(foodBudget.locator(".rb-budget-spent > strong")).toContainText(
      "101,20",
    );
    await page
      .getByRole("group", { name: "Visão do orçamento", exact: true })
      .getByRole("button", { name: "Casal", exact: true })
      .click();
    await expect(foodBudget).toHaveCount(0);
    await expect(
      page
        .locator(".rb-budget-card")
        .filter({
          has: page.getByRole("heading", { name: "Mercado", exact: true }),
        })
        .locator(".rb-budget-spent > strong"),
    ).toContainText("713,80");
    await page
      .getByRole("button", { name: "Novo limite", exact: true })
      .click();
    await page.getByLabel("Categoria", { exact: true }).fill("Alimentação");
    await page.getByLabel("Limite do mês (R$)", { exact: true }).fill("500,00");
    await page
      .getByRole("button", { name: "Salvar limite", exact: true })
      .click();
    // 128,00 próprios compartilhados + 164,00 de Alex; exclui os 101,20 pessoais.
    await expect(foodBudget.locator(".rb-budget-spent > strong")).toContainText(
      "292,00",
    );
    expect(
      apiWrites,
      "Salvar, editar e remover limites em demo não deve escrever na API",
    ).toEqual([]);
  });

  test("no celular a agenda cria e confirma uma recorrência sem alterar os lançamentos", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const apiWrites = await openDemo(page);
    const before = await ledgerSnapshot(page);
    const month = await page
      .getByLabel("Mês de referência", { exact: true })
      .inputValue();
    await navigate(page, "Calendário");
    const name = `Internet E2E ${randomUUID().slice(0, 8)}`;
    await page
      .getByRole("button", { name: "Nova recorrência", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Nova recorrência",
      exact: true,
    });
    await form.getByLabel("Nome do compromisso", { exact: true }).fill(name);
    await form
      .getByLabel("Visibilidade", { exact: true })
      .selectOption("personal");
    await form
      .getByLabel("Tipo de compromisso", { exact: true })
      .selectOption("expense");
    await form
      .getByLabel("Valor previsto (R$)", { exact: true })
      .fill("123,45");
    await form.getByLabel("Repetição", { exact: true }).selectOption("monthly");
    await form.getByLabel("Categoria", { exact: true }).fill("Serviços");
    await form
      .getByLabel("Primeiro vencimento", { exact: true })
      .fill(`${month}-26`);
    await form.getByLabel("Repetir até", { exact: true }).fill(`${month}-26`);
    await form
      .getByRole("button", { name: "Salvar recorrência", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    await expect(
      page.locator(".calendar-schedule-row").filter({ hasText: name }),
    ).toHaveCount(1);
    await page
      .locator(".calendar-grid")
      .getByRole("button", { name: /^26 / })
      .click();
    const agenda = page.locator(".calendar-agenda");
    await expect(agenda.locator(".calendar-entry")).toHaveCount(1);
    const occurrence = agenda.getByRole("button").filter({ hasText: name });
    await expect(occurrence).toContainText("123,45");
    await occurrence.click();
    const details = page.getByRole("dialog", { name, exact: true });
    await details
      .getByRole("button", { name: "Marcar como pago", exact: true })
      .click();
    await expect(details).toHaveCount(0);
    await expect(occurrence).toContainText("Confirmado");
    await occurrence.click();
    await expect(details.locator(".calendar-status")).toHaveText("Confirmado");
    await details
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
    expect(
      await ledgerSnapshot(page),
      "Confirmação manual não cria nem muda movimentos, contas ou valores",
    ).toEqual(before);
    expect(
      apiWrites,
      "Recorrências e confirmações em demo não devem escrever na API",
    ).toEqual([]);
  });

  test("Spotify pode ser vinculado ao lançamento importado e reaberto sem mudar o extrato", async ({
    page,
  }) => {
    const apiWrites = await openDemo(page);
    const before = await ledgerSnapshot(page);
    await navigate(page, "Calendário");
    const occurrence = page
      .locator(".calendar-agenda .calendar-entry")
      .filter({ hasText: "Spotify" });
    await occurrence.click();
    const details = page.getByRole("dialog", { name: "Spotify", exact: true });
    const imported = details.getByLabel("Lançamento importado", {
      exact: true,
    });
    await expect(imported.locator('option[value="demo-tx-10"]')).toContainText(
      "Spotify",
    );
    await imported.selectOption("demo-tx-10");
    await details
      .getByRole("button", { name: "Vincular ao extrato", exact: true })
      .click();
    await expect(details).toHaveCount(0);
    await expect(occurrence).toContainText("Vinculado ao extrato");
    await occurrence.click();
    await expect(details.locator(".calendar-status")).toHaveText(
      "Vinculado ao extrato",
    );
    await expect(details.locator(".notice")).toContainText(
      "Vinculado a Spotify",
    );
    await expect(details.locator(".notice")).toContainText("21,90");
    await details
      .getByRole("button", { name: "Reabrir este compromisso", exact: true })
      .click();
    await expect(details).toHaveCount(0);
    await expect(occurrence).not.toContainText("Vinculado ao extrato");
    await occurrence.click();
    await expect(details.locator(".calendar-status")).toHaveText("Previsto");
    await expect(
      details.getByLabel("Lançamento importado", { exact: true }),
    ).toBeVisible();
    await expect(
      details.getByRole("button", { name: "Marcar como pago", exact: true }),
    ).toBeVisible();
    await details
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
    expect(
      await ledgerSnapshot(page),
      "Vincular e reabrir só altera o calendário",
    ).toEqual(before);
    expect(
      apiWrites,
      "Vincular e reabrir em demo não deve escrever na API",
    ).toEqual([]);
  });
});
