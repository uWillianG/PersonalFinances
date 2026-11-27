import { expect, test, type Page } from "@playwright/test";
import { currentMonth } from "../../lib/finance.ts";
import type { AppState } from "../../lib/types.ts";

const sections = [
  ["Visão geral", "Seu dinheiro, mais claro."],
  ["Lançamentos", "De perto, cada movimento."],
  ["Importações", "Seu mês começa aqui."],
  ["Relatórios", "Onde seu dinheiro vai."],
  ["Orçamentos", "Seu plano para o mês."],
  ["Calendário", "Uma visão do que vem."],
  ["Metas e caixinhas", "Cada objetivo, mais perto."],
  ["Quanto reservar", "Quanto cabe nos seus planos."],
  ["Faturas", "Seus cartões, por fatura."],
  ["Nosso espaço", "Juntos, com clareza."],
  ["Contas e saldos", "Suas contas, conectadas à vida."],
] as const;

async function openFromMore(page: Page, label: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Navegação no celular", exact: true })
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

async function openDesktop(page: Page, label: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}

test.describe("Auditoria de navegação e troca de modo", () => {
  test.skip(
    ({ baseURL }) =>
      !baseURL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
    "Estes fluxos usam apenas o preview local e sua autenticação fictícia.",
  );

  test("todas as seções e o modal de conta cabem em 320px e Escape devolve o foco", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const pageErrors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
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
    await expect(page.locator(".app-shell")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      page.getByText("Modo demonstração", { exact: true }),
    ).toBeVisible();

    for (const [label, heading] of sections) {
      await openFromMore(page, label);
      await expect(
        page.getByRole("main").getByRole("heading", {
          name: heading,
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `A seção ${label} deve caber na largura de 320px.`,
      ).toBe(true);
    }

    const addAccount = page.getByRole("button", {
      name: "Adicionar conta",
      exact: true,
    });
    await addAccount.click();
    const dialog = page.getByRole("dialog", {
      name: "Adicionar conta",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      "Os campos da conta não podem ultrapassar a largura do modal.",
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(addAccount).toBeFocused();
    expect(pageErrors).toEqual([]);
    expect(
      writes,
      "Explorar a demonstração não grava dados financeiros.",
    ).toEqual([]);
  });

  test("entrar na demonstração limpa o filtro de uma conta privada do modo real", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const writes: string[] = [];
    const data: AppState = {
      user: {
        id: "local_seedy",
        name: "Pessoa de teste",
        email: "seedy@sites.test",
      },
      sources: [
        {
          id: "real-bank",
          ownerId: "local_seedy",
          name: "Conta real sintética",
          institution: "Teste",
          type: "bank",
          initialBalanceCents: 0,
          balanceDate: `${currentMonth()}-01`,
          hasOpeningBalance: true,
        },
      ],
      transactions: [],
      partnerTransactions: [],
      imports: [],
      couple: null,
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "GET" && path === "/api/state") {
        await route.fulfill({ json: data });
        return;
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        writes.push(`${request.method()} ${path}`);
      }
      // Every financial API request is intercepted; the fixture never reaches D1.
      await route.abort("blockedbyclient");
    });
    await page.goto("/signin-with-chatgpt?return_to=/");
    await expect(page.locator(".app-shell")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      page.getByText("Modo demonstração", { exact: true }),
    ).toHaveCount(0);
    await openDesktop(page, "Lançamentos");
    await page.getByLabel("Conta", { exact: true }).selectOption("real-bank");
    await expect(page.getByLabel("Conta", { exact: true })).toHaveValue(
      "real-bank",
    );
    await openDesktop(page, "Visão geral");
    await page
      .getByRole("button", { name: "Ver demonstração", exact: true })
      .click();
    await expect(
      page.getByText("Modo demonstração", { exact: true }),
    ).toBeVisible();
    await openDesktop(page, "Lançamentos");
    await expect(page.getByLabel("Conta", { exact: true })).toHaveValue("");
    await expect(page.locator(".full-panel .transaction-row")).toHaveCount(21);
    await expect(
      page
        .getByLabel("Conta", { exact: true })
        .locator('option[value="real-bank"]'),
    ).toHaveCount(0);
    expect(
      writes,
      "A troca de modo não deve criar ou alterar dados financeiros.",
    ).toEqual([]);
  });
});
