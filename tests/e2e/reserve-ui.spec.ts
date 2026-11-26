import { expect, test, type Page } from "@playwright/test";
import { currentMonth } from "../../lib/finance.ts";
import { todayISO } from "../../lib/planning.ts";
import type { AppState, Transaction } from "../../lib/types.ts";
import type { ReservePlanInput } from "../../lib/reserve-types.ts";

async function navigate(page: Page, label: string) {
  const desktop = page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("button", { name: label, exact: true });
  if (await desktop.isVisible()) {
    await desktop.click();
    return;
  }
  await page
    .getByRole("navigation", { name: "Navegação no celular", exact: true })
    .getByRole("button", { name: "Mais opções", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Explorar o Clara", exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
}
function fixture(): AppState {
  const month = currentMonth(),
    user = { id: "local_seedy", name: "Teste", email: "seedy@sites.test" };
  const previous = new Date(`${month}-01T12:00:00Z`);
  previous.setUTCDate(0);
  const next = new Date(`${month}-01T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const row = (
    id: string,
    sourceId: string,
    kind: Transaction["kind"],
    amountCents: number,
    category = "Outros",
    date = `${month}-01`,
  ): Transaction => ({
    id,
    sourceId,
    kind,
    amountCents,
    category,
    date,
    ownerId: user.id,
    ownerName: user.name,
    description: id,
    shared: false,
    installmentCurrent: null,
    installmentTotal: null,
    needsReview: false,
    note: "",
    importId: null,
    fingerprint: id,
  });
  return {
    user,
    sources: [
      {
        id: "bank",
        ownerId: user.id,
        name: "Conta teste",
        institution: "Teste",
        type: "bank",
        initialBalanceCents: 100000,
        balanceDate: `${month}-01`,
        hasOpeningBalance: true,
      },
      {
        id: "card",
        ownerId: user.id,
        name: "Cartão teste",
        institution: "Teste",
        type: "credit",
        initialBalanceCents: 0,
        balanceDate: `${month}-01`,
        hasOpeningBalance: true,
      },
      {
        id: "benefit",
        ownerId: user.id,
        name: "Vale teste",
        institution: "Teste",
        type: "benefit",
        initialBalanceCents: 9999999,
        balanceDate: `${month}-01`,
        hasOpeningBalance: true,
      },
    ],
    transactions: [
      row("Salário teste", "bank", "income", 500000, "Salário"),
      row("Aluguel teste", "bank", "expense", 200000, "Moradia"),
      row("Fatura paga teste", "bank", "card_payment", 50000, "Fatura"),
      row("Compra teste", "card", "expense", 50000, "Compras"),
      row("Recarga VA teste", "benefit", "income", 900000, "Benefícios"),
      row("Mercado VA teste", "benefit", "expense", 500000, "Mercado"),
      row(
        "Receita futura teste",
        "bank",
        "income",
        99999999,
        "Salário",
        next.toISOString().slice(0, 10),
      ),
    ],
    partnerTransactions: [],
    couple: null,
    rules: [],
    imports: [
      {
        id: "batch",
        createdAt: new Date().toISOString(),
        files: ["sintetico.csv"],
        count: 6,
        incomeCents: 1400000,
        expenseCents: 750000,
        periodStart: `${month}-01`,
        periodEnd: todayISO(),
      },
    ],
    budgets: [
      {
        id: "budget",
        ownerId: user.id,
        ownerName: user.name,
        scope: "personal",
        month,
        category: "Moradia",
        limitCents: 250000,
        canEdit: true,
      },
    ],
    schedules: [],
    occurrences: [],
    reservePlans: [],
    goals: [
      {
        id: "goal",
        ownerId: user.id,
        ownerName: user.name,
        scope: "personal",
        name: "Reserva teste",
        targetCents: 500000,
        targetDate: null,
        archived: false,
        canEdit: true,
      },
    ],
    goalMovements: [
      {
        id: "movement",
        goalId: "goal",
        ownerId: user.id,
        ownerName: user.name,
        kind: "deposit",
        amountCents: 100000,
        date: previous.toISOString().slice(0, 10),
        note: "",
        createdAt: previous.toISOString(),
      },
    ],
  };
}
async function openMock(page: Page, data: AppState) {
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/state") {
      await route.fulfill({ json: data });
      return;
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()))
      writes.push(`${request.method()} ${path}`);
    if (request.method() === "POST" && path === "/api/reserve-plans") {
      const input = request.postDataJSON() as ReservePlanInput;
      const plan = { ...input, id: "plan", ownerId: data.user.id };
      data.reservePlans = [
        ...(data.reservePlans ?? []).filter(
          (item) => item.month !== plan.month,
        ),
        plan,
      ];
      await route.fulfill({ status: 201, json: { plan } });
      return;
    }
    if (
      request.method() === "DELETE" &&
      path.startsWith("/api/reserve-plans/")
    ) {
      data.reservePlans = (data.reservePlans ?? []).filter(
        (item) => item.month !== path.split("/").at(-1),
      );
      await route.fulfill({ json: { deleted: true } });
      return;
    }
    await route.abort("blockedbyclient");
  });
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await navigate(page, "Quanto reservar");
  await expect(
    page.getByRole("heading", {
      name: "Quanto cabe nos seus planos.",
      exact: true,
    }),
  ).toBeVisible();
  return writes;
}
test.describe("Estimativa pessoal de reserva", () => {
  test.skip(
    ({ baseURL }) =>
      !baseURL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
    "Login fictício apenas no preview local.",
  );
  test("no celular simula, salva e restaura sem alterar o histórico financeiro", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const data = fixture(),
      before = structuredClone(data.transactions);
    const writes = await openMock(page, data);
    await expect(page.locator(".reserve-suggestion")).toContainText("1.500,00");
    await expect(page.locator(".reserve-advanced")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.locator(".reserve-advanced > summary").click();
    await page
      .getByRole("checkbox", {
        name: "Usar estimativa automática para faturas",
        exact: true,
      })
      .uncheck();
    await page
      .getByLabel("Faturas ainda a pagar", { exact: true })
      .fill("0,00");
    await expect(page.locator(".reserve-suggestion")).toContainText("2.000,00");
    await page
      .getByRole("checkbox", {
        name: "Usar estimativa automática para faturas",
        exact: true,
      })
      .check();
    await expect(page.locator(".reserve-suggestion")).toContainText("1.500,00");
    await page.locator(".reserve-advanced > summary").click();
    await page
      .getByLabel("Manter disponível na conta", { exact: true })
      .fill("300,00");
    await page
      .getByLabel("Outros gastos previstos", { exact: true })
      .fill("200,00");
    await expect(page.locator(".reserve-suggestion")).toContainText("1.000,00");
    expect(writes).toEqual([]);
    await page
      .getByRole("button", { name: "Salvar ajustes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Salvar ajustes", exact: true }),
    ).toBeDisabled();
    expect(writes).toEqual(["POST /api/reserve-plans"]);
    await navigate(page, "Lançamentos");
    await expect(page.locator(".full-panel .transaction-row")).toHaveCount(6);
    await navigate(page, "Quanto reservar");
    await expect(
      page.getByLabel("Manter disponível na conta", { exact: true }),
    ).toHaveValue("300,00");
    await expect(page.locator(".reserve-suggestion")).toContainText("1.000,00");
    await page
      .getByRole("button", { name: "Restaurar automático", exact: true })
      .click();
    await expect(page.locator(".reserve-suggestion")).toContainText("1.500,00");
    expect(writes).toEqual([
      "POST /api/reserve-plans",
      `DELETE /api/reserve-plans/${currentMonth()}`,
    ]);
    expect(data.transactions).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
  });
  test("saldo desconhecido mantém valor a conferir e leva à correção das contas", async ({
    page,
  }) => {
    const data = fixture();
    data.sources[0].hasOpeningBalance = false;
    const writes = await openMock(page, data);
    await expect(page.locator(".reserve-suggestion")).toContainText(
      "A conferir",
    );
    await expect(
      page.getByText("Saldo bancário incompleto", { exact: true }),
    ).toBeVisible();
    await page
      .locator(".reserve-hero")
      .getByRole("button", { name: "Conferir saldos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Suas contas, conectadas à vida.",
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toEqual([]);
  });
});
