import { expect, test, type Page } from "@playwright/test";
import { currentMonth } from "../../lib/finance.ts";
import { demoState } from "../../lib/demo.ts";

const demoMonth = currentMonth();

async function openDemo(page: Page): Promise<string[]> {
  const writes: string[] = [];
  // Keep the existing synthetic payment on day 10 eligible throughout the month.
  // Date advances alone; real browser timers continue to run normally.
  await page.clock.setFixedTime(new Date(`${demoMonth}-26T15:00:00Z`));
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

async function openInvoices(page: Page): Promise<void> {
  await navigate(page, "Faturas");
  await expect(
    page.getByRole("heading", {
      name: "Seus cartões, por fatura.",
      exact: true,
    }),
  ).toBeVisible();
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

test.describe("Faturas no modo demonstração", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("configura o ciclo com dia 31 e confere um total sem alterar compras ou parcelas", async ({
    page,
  }) => {
    const writes = await openDemo(page);
    const before = await ledgerSnapshot(page);
    await openInvoices(page);
    const card = page.getByRole("article", { name: "Meu cartão", exact: true });
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "106,80",
    );
    await expect(card.locator(".invoice-status")).toHaveText(
      "Pagamento parcial",
    );

    // The selected statement month stays explicit. Configuring the card in a
    // leap February must clamp its due date without moving imported purchases.
    await page.getByLabel("Mês de referência", { exact: true }).fill("2028-02");
    await card
      .getByRole("button", {
        name: "Configurar ciclo de Meu cartão",
        exact: true,
      })
      .click();
    const cycle = page.getByRole("dialog", {
      name: "Configurar ciclo do cartão",
      exact: true,
    });
    await cycle.getByLabel("Dia de fechamento", { exact: true }).fill("31");
    await cycle.getByLabel("Dia de vencimento", { exact: true }).fill("31");
    await cycle
      .getByRole("button", { name: "Salvar ciclo", exact: true })
      .click();
    await expect(cycle).toHaveCount(0);
    await expect(card.locator(".invoice-cycle > p").nth(0)).toContainText(
      dateLabel("2028-01-31"),
    );
    await expect(card.locator(".invoice-cycle > p").nth(1)).toContainText(
      dateLabel("2028-02-29"),
    );
    await page.getByLabel("Mês de referência", { exact: true }).fill(demoMonth);
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "106,80",
    );

    await card
      .getByRole("button", { name: "Revisar total conferido", exact: true })
      .click();
    const total = page.getByRole("dialog", {
      name: "Conferir total da fatura",
      exact: true,
    });
    await expect(
      total.getByLabel("Total conferido (R$)", { exact: true }),
    ).toHaveValue("606,80");
    await total
      .getByLabel("Total conferido (R$)", { exact: true })
      .fill("700,25");
    await total
      .getByRole("button", { name: "Salvar total", exact: true })
      .click();
    await expect(total).toHaveCount(0);
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "200,25",
    );
    await expect(card.locator(".invoice-card-totals")).toContainText("700,25");
    await expect(card.locator(".invoice-card-totals")).toContainText("500,00");

    await card.getByRole("button", { name: "Ver fatura", exact: true }).click();
    const detail = page.getByRole("dialog", {
      name: "Detalhes da fatura",
      exact: true,
    });
    const expectedPurchases = demoState(demoMonth).transactions.filter(
      (transaction) =>
        transaction.sourceId === "demo-credit" &&
        transaction.date.slice(0, 7) === demoMonth &&
        ["expense", "refund"].includes(transaction.kind),
    );
    await expect(detail.locator(".invoice-transaction-list > li")).toHaveCount(
      expectedPurchases.length,
    );
    await expect(detail).toContainText("Tênis para corrida");
    await expect(detail).toContainText("Parcela 2 de 4");
    await expect(detail.locator(".invoice-detail-footnote")).toContainText(
      "606,80",
    );
    await expect(detail.locator(".invoice-payment-list > li")).toHaveCount(1);
    await detail
      .getByRole("button", { name: "Fechar janela", exact: true })
      .click();
    await expect(page.locator(".invoices-privacy")).toContainText(
      "espaço pessoal",
    );
    expect(await ledgerSnapshot(page)).toEqual(before);
    expect(
      writes,
      "Configurar o ciclo e conferir totais na demo não escreve na API",
    ).toEqual([]);
  });

  test("no celular atualiza um vínculo parcial, impede excesso e desvincula sem duplicar o extrato", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const writes = await openDemo(page);
    const before = await ledgerSnapshot(page);
    await openInvoices(page);
    const card = page.getByRole("article", { name: "Meu cartão", exact: true });
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "106,80",
    );
    await card
      .getByRole("button", { name: "Vincular pagamento", exact: true })
      .click();
    const payment = page.getByRole("dialog", {
      name: "Vincular pagamento",
      exact: true,
    });
    await expect(
      payment
        .getByLabel("Pagamento do extrato", { exact: true })
        .locator("option"),
    ).toHaveCount(1);
    await expect(
      payment.getByLabel("Valor vinculado (R$)", { exact: true }),
    ).toHaveValue("500,00");
    await payment
      .getByLabel("Valor vinculado (R$)", { exact: true })
      .fill("1.000,00");
    await payment
      .getByRole("button", { name: "Confirmar vínculo", exact: true })
      .click();
    await expect(payment.getByRole("alert")).toContainText(
      "supera a parte disponível",
    );
    await expect(payment).toBeVisible();
    await payment
      .getByLabel("Valor vinculado (R$)", { exact: true })
      .fill("550,00");
    await payment
      .getByRole("button", { name: "Confirmar vínculo", exact: true })
      .click();
    await expect(payment).toHaveCount(0);
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "56,80",
    );
    await expect(card.locator(".invoice-card-totals")).toContainText("550,00");

    await card.getByRole("button", { name: "Ver fatura", exact: true }).click();
    const detail = page.getByRole("dialog", {
      name: "Detalhes da fatura",
      exact: true,
    });
    await expect(detail.locator(".invoice-payment-list > li")).toHaveCount(1);
    await expect(detail.locator(".invoice-payment-list > li b")).toContainText(
      "550,00",
    );
    await detail
      .getByRole("button", {
        name: "Desvincular Pagamento de fatura",
        exact: true,
      })
      .click();
    const unlink = page.getByRole("dialog", {
      name: "Desvincular pagamento?",
      exact: true,
    });
    await expect(unlink).toContainText("continua no seu histórico");
    await unlink
      .getByRole("button", { name: "Desvincular pagamento", exact: true })
      .click();
    await expect(unlink).toHaveCount(0);
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "606,80",
    );
    await expect(card.locator(".invoice-status")).toHaveText("Em aberto");

    await card
      .getByRole("button", { name: "Vincular pagamento", exact: true })
      .click();
    await payment
      .getByLabel("Valor vinculado (R$)", { exact: true })
      .fill("200,00");
    await payment
      .getByRole("button", { name: "Confirmar vínculo", exact: true })
      .click();
    await expect(payment).toHaveCount(0);
    await expect(card.locator(".invoice-card-balance > strong")).toContainText(
      "406,80",
    );
    await expect(card.locator(".invoice-status")).toHaveText(
      "Pagamento parcial",
    );
    expect(await ledgerSnapshot(page)).toEqual(before);
    await openInvoices(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    expect(
      writes,
      "Vincular e desvincular pagamentos na demo altera somente a memória",
    ).toEqual([]);
  });
});
