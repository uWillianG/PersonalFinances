import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { parseStatement } from "../../lib/import-parser.ts";
import type { AppState, Source, Transaction } from "../../lib/types.ts";

function isLoopback(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(baseURL).hostname,
  );
}

async function signIn(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/signin-with-chatgpt?return_to=/", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/");
  return readState(request);
}

async function readState(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<AppState>;
}

test.describe("API com login local", () => {
  test.skip(
    ({ baseURL }) => !isLoopback(baseURL),
    "O mock de identidade requer o preview de desenvolvimento em loopback.",
  );

  test("regras pessoais de categoria podem ser salvas, atualizadas e removidas", async ({
    request,
  }) => {
    await signIn(request);
    const description = `Comércio sintético ${randomUUID()}`;
    let id = "";
    try {
      const response = await request.post("/api/rules", {
        data: { description, category: "Categoria pessoal" },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const created = await response.json();
      id = created.rule.id;
      const updated = await request.post("/api/rules", {
        data: { description: description.toUpperCase(), category: "Mercado" },
      });
      expect(updated.ok(), await updated.text()).toBeTruthy();
      expect((await updated.json()).rule.id).toBe(id);
      expect(
        (await readState(request)).rules?.filter((rule) => rule.id === id),
      ).toMatchObject([{ category: "Mercado" }]);
    } finally {
      if (id)
        expect((await request.delete(`/api/rules/${id}`)).ok()).toBeTruthy();
    }
    expect(
      (await readState(request)).rules?.some((rule) => rule.id === id),
    ).toBe(false);
  });

  test("estado exige autenticação e login local estabelece a identidade", async ({
    request,
  }) => {
    const anonymous = await request.get("/api/state");
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.json()).toEqual({ error: expect.any(String) });

    const state = await signIn(request);
    expect(state.user.id).toBe("local_seedy");
    expect(state.user.email).toBe("seedy@sites.test");
    expect(
      state.sources.every((source) => source.ownerId === state.user.id),
    ).toBeTruthy();
    expect(
      state.transactions.every(
        (transaction) => transaction.ownerId === state.user.id,
      ),
    ).toBeTruthy();
    expect(
      state.partnerTransactions.every(
        (transaction) =>
          transaction.ownerId !== state.user.id && transaction.shared,
      ),
    ).toBeTruthy();
  });

  test("importação mantém duplicatas fora dos totais e compartilhar exige vínculo de casal", async ({
    request,
  }) => {
    const initial = await signIn(request);
    expect(
      initial.couple,
      "Use um D1 local de teste sem vínculo de casal preexistente.",
    ).toBeNull();
    const batchIds: string[] = [];
    let createdCouple = false;
    const createSource = await request.post("/api/sources", {
      data: {
        name: `Teste sintético ${randomUUID()}`,
        institution: "Instituição sintética",
        type: "bank",
        initialBalanceCents: 0,
        balanceDate: "2026-11-01",
        hasOpeningBalance: true,
      },
    });
    expect(createSource.status(), await createSource.text()).toBe(201);
    const { source } = (await createSource.json()) as { source: Source };
    expect(source.ownerId).toBe(initial.user.id);

    try {
      const fixture = await readFile(
        new URL("../../fixtures/sample.csv", import.meta.url),
        "utf8",
      );
      const parsed = parseStatement(fixture, {
        fileName: "sample.csv",
        referenceMonth: "2026-11",
        sourceType: "bank",
      });
      expect(parsed.rows).toHaveLength(5);
      const items = parsed.rows.map((row) => ({
        ...row,
        sourceId: source.id,
        fileName: "sample.csv",
      }));

      const firstImport = await request.post("/api/imports", {
        data: { items },
      });
      expect(firstImport.status(), await firstImport.text()).toBe(201);
      const imported = (await firstImport.json()) as {
        imported: number;
        duplicates: number;
        batchId: string;
      };
      batchIds.push(imported.batchId);
      expect(imported.imported).toBe(5);
      expect(imported.duplicates).toBe(0);

      const repeatImport = await request.post("/api/imports", {
        data: { items },
      });
      expect(repeatImport.status(), await repeatImport.text()).toBe(201);
      const repeated = (await repeatImport.json()) as {
        imported: number;
        duplicates: number;
        batchId: string;
      };
      batchIds.push(repeated.batchId);
      expect(repeated.imported).toBe(0);
      expect(repeated.duplicates).toBe(5);

      const afterImport = await readState(request);
      expect(afterImport.transactions).toHaveLength(
        initial.transactions.length + 5,
      );
      const ownRows = afterImport.transactions.filter(
        (transaction) => transaction.sourceId === source.id,
      );
      expect(ownRows).toHaveLength(5);
      expect(ownRows.every((transaction) => !transaction.shared)).toBeTruthy();
      const purchase = ownRows.find(
        (transaction) => transaction.kind === "expense",
      )!;

      const edited = await request.patch(`/api/transactions/${purchase.id}`, {
        data: {
          category: "Lazer",
          needsReview: false,
        },
      });
      expect(edited.status(), await edited.text()).toBe(200);
      expect(
        ((await edited.json()) as { transaction: Transaction }).transaction
          .category,
      ).toBe("Lazer");

      const sharingWithoutCouple = await request.patch(
        `/api/transactions/${purchase.id}`,
        { data: { shared: true } },
      );
      expect([400, 409]).toContain(sharingWithoutCouple.status());
      expect(await sharingWithoutCouple.json()).toEqual({
        error: expect.any(String),
      });
      expect(
        (await readState(request)).transactions.find(
          (transaction) => transaction.id === purchase.id,
        )?.shared,
      ).toBe(false);

      const createCouple = await request.post("/api/couple", {
        data: { action: "create" },
      });
      expect(createCouple.status(), await createCouple.text()).toBe(200);
      createdCouple = true;
      expect(((await createCouple.json()) as { code: string }).code).toMatch(
        /^[A-HJ-NP-Z2-9]{12}$/,
      );

      const sharingWithCouple = await request.patch(
        `/api/transactions/${purchase.id}`,
        { data: { shared: true } },
      );
      expect(sharingWithCouple.status(), await sharingWithCouple.text()).toBe(
        200,
      );
      expect(
        ((await sharingWithCouple.json()) as { transaction: Transaction })
          .transaction.shared,
      ).toBe(true);

      const finalState = await readState(request);
      expect(finalState.couple?.members.map((member) => member.id)).toContain(
        initial.user.id,
      );
      expect(finalState.transactions).toHaveLength(
        initial.transactions.length + 5,
      );
      expect(
        finalState.transactions.every(
          (transaction) => transaction.ownerId === finalState.user.id,
        ),
      ).toBeTruthy();
      expect(
        finalState.sources.every((item) => item.ownerId === finalState.user.id),
      ).toBeTruthy();
      expect(finalState.partnerTransactions).toEqual([]);
      expect(
        finalState.transactions.find(
          (transaction) => transaction.id === purchase.id,
        ),
      ).toMatchObject({
        shared: true,
        category: "Lazer",
        needsReview: false,
      });
    } finally {
      // Only remove the relationship created by this test, never a preexisting one.
      if (createdCouple) {
        const left = await request.post("/api/couple", {
          data: { action: "leave" },
        });
        expect.soft(left.ok(), await left.text()).toBeTruthy();
      }
      for (const batchId of batchIds.reverse()) {
        const deleted = await request.delete(`/api/imports/${batchId}`);
        expect.soft(deleted.ok(), await deleted.text()).toBeTruthy();
      }
      // There is deliberately no source DELETE endpoint; the synthetic empty
      // source remains in the dedicated local test database after cleanup.
    }
  });
});

const emptyState: AppState = {
  user: {
    id: "local_seedy",
    name: "Pessoa de teste",
    email: "seedy@sites.test",
  },
  sources: [],
  transactions: [],
  partnerTransactions: [],
  imports: [],
  couple: null,
};

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "celular", width: 390, height: 844 },
]) {
  test.describe(`Interface vazia — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test.skip(
      ({ baseURL }) => !isLoopback(baseURL),
      "A sessão deste smoke usa o login fictício do preview local.",
    );

    test("navegação é acessível e permanece utilizável sem lançamentos", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/state", (route) =>
        route.fulfill({ json: emptyState }),
      );
      // Top-level navigation exercises the same local sign-in link as the UI.
      await page.goto("/signin-with-chatgpt?return_to=/");
      const main = page.getByRole("main");
      await expect(main).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Seu dinheiro, mais claro." }),
      ).toBeVisible();
      await expect(
        page.getByText("Modo demonstração", { exact: true }),
      ).toHaveCount(0);

      const navigation = page.locator(
        `nav[aria-label="${viewport.name === "celular" ? "Navegação no celular" : "Navegação principal"}"]:visible`,
      );
      await expect(navigation).toBeVisible();
      for (const [name, heading] of [
        ["Lançamentos", "De perto, cada movimento."],
        ["Importações", "Seu mês começa aqui."],
        ["Relatórios", "Onde seu dinheiro vai."],
        ["Orçamentos", "Seu plano para o mês."],
        ["Calendário", "Uma visão do que vem."],
        ["Metas e caixinhas", "Cada objetivo, mais perto."],
        ["Nosso espaço", "Juntos, com clareza."],
        ["Contas e saldos", "Suas contas, conectadas à vida."],
        ["Visão geral", "Seu dinheiro, mais claro."],
      ]) {
        const navigationButton = navigation.getByRole("button", {
          name,
          exact: true,
        });
        if (
          viewport.name === "celular" &&
          !(await navigationButton.isVisible())
        ) {
          await navigation
            .getByRole("button", { name: "Mais opções", exact: true })
            .click();
          await page
            .getByRole("dialog", { name: "Explorar o Clara" })
            .getByRole("button", { name, exact: true })
            .click();
          await expect(
            navigation.getByRole("button", {
              name: "Mais opções",
              exact: true,
            }),
          ).toHaveAttribute("aria-current", "page");
        } else {
          await expect(navigationButton).toBeVisible();
          await navigationButton.click();
          await expect(navigationButton).toHaveAttribute(
            "aria-current",
            "page",
          );
        }
        await expect(
          main.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
      }

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(hasHorizontalOverflow).toBe(false);
      expect(errors).toEqual([]);
    });
  });
}
