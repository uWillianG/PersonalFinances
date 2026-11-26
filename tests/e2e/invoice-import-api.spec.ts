import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import type {
  AppState,
  DraftTransaction,
  Source,
  SourceType,
  TransactionKind,
} from "../../lib/types.ts";
import type { CardInvoice, InvoicePayment } from "../../lib/invoice-types.ts";
import { transactionFingerprint } from "../../lib/transaction-identity.ts";
import { invoiceSummaries } from "../../lib/invoices.ts";

interface Imported {
  imported: number;
  duplicates: number;
  batchId: string;
}
interface Undone {
  deleted: number;
  restoredBalances: number;
  keptBalances: number;
  legacyBaselineUnknown: boolean;
}
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
    "Execute somente com a identidade fictícia do D1 local.",
  ).toBe("local_seedy");
  expect(initial.user.email).toBe("seedy@sites.test");
  return initial;
}
async function createSource(
  request: APIRequestContext,
  name: string,
  type: SourceType,
  initialBalanceCents = 0,
) {
  return (
    await success<{ source: Source }>(
      await request.post("/api/sources", {
        data: {
          name,
          institution: "Instituição sintética",
          type,
          initialBalanceCents,
          balanceDate: "2026-01-01",
          hasOpeningBalance: true,
        },
      }),
      201,
    )
  ).source;
}
function item(
  sourceId: string,
  description: string,
  kind: TransactionKind,
  amountCents: number,
): DraftTransaction {
  const content = {
    sourceId,
    date: "2026-01-15",
    description,
    kind,
    amountCents,
    category: kind === "card_payment" ? "Fatura" : "Compras",
    installmentCurrent: null,
    installmentTotal: null,
    needsReview: false,
    fileName: "fatura-sintetica.csv",
  };
  return { ...content, fingerprint: transactionFingerprint(content) };
}
async function importBatch(
  request: APIRequestContext,
  owned: Set<string>,
  items: DraftTransaction[],
  balanceUpdates: {
    sourceId: string;
    amountCents: number;
    date: string;
  }[] = [],
) {
  const imported = await success<Imported>(
    await request.post("/api/imports", { data: { items, balanceUpdates } }),
    201,
  );
  owned.add(imported.batchId);
  return imported;
}
async function removeBatch(
  request: APIRequestContext,
  owned: Set<string>,
  id: string,
) {
  const result = await success<Undone>(
    await request.delete(`/api/imports/${id}`),
  );
  owned.delete(id);
  return result;
}

test.describe("Faturas e desfazer de importações no banco local sintético", () => {
  test.skip(
    ({ baseURL }) =>
      !baseURL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
    "Estes testes mutam somente o preview local.",
  );

  test("rateio de pagamento respeita o valor bancário, preserva o extrato e reabre faturas ao desfazer o lote", async ({
    request,
  }) => {
    const initial = await signIn(request),
      suffix = randomUUID();
    const bank = await createSource(
      request,
      `Banco de teste ${suffix}`,
      "bank",
    );
    const cardA = await createSource(
      request,
      `Cartão A de teste ${suffix}`,
      "credit",
    );
    const cardB = await createSource(
      request,
      `Cartão B de teste ${suffix}`,
      "credit",
    );
    const batches = new Set<string>(),
      invoices: CardInvoice[] = [];
    const month = "2026-01";
    try {
      await success(
        await request.post(`/api/cards/${cardA.id}/cycle`, {
          data: { closingDay: 28, dueDay: 5 },
        }),
      );
      await success(
        await request.post(`/api/cards/${cardB.id}/cycle`, {
          data: { closingDay: 3, dueDay: 10 },
        }),
      );
      const purchases = await importBatch(request, batches, [
        item(cardA.id, `Compra A ${suffix}`, "expense", 40000),
        item(cardB.id, `Compra B ${suffix}`, "expense", 30000),
      ]);
      expect(purchases.imported).toBe(2);
      const paidBatch = await importBatch(
        request,
        batches,
        [item(bank.id, `Pagamento bancário ${suffix}`, "card_payment", 60000)],
        [{ sourceId: bank.id, amountCents: 700000, date: "2026-01-01" }],
      );
      expect(paidBatch.imported).toBe(1);
      const imported = await state(request),
        payment = imported.transactions.find(
          (tx) => tx.importId === paidBatch.batchId,
        )!;
      expect(payment).toBeTruthy();
      expect(
        imported.sources.find((source) => source.id === bank.id)
          ?.initialBalanceCents,
      ).toBe(700000);
      for (const [card, total] of [
        [cardA, 40000],
        [cardB, 30000],
      ] as const) {
        const saved = await success<{ invoice: CardInvoice }>(
          await request.post("/api/invoices", {
            data: { sourceId: card.id, month, confirmedTotalCents: total },
          }),
          201,
        );
        invoices.push(saved.invoice);
      }
      const ensured = await success<{ invoice: CardInvoice }>(
        await request.post("/api/invoices", {
          data: {
            sourceId: cardA.id,
            month,
            confirmedTotalCents: null,
            ensureOnly: true,
          },
        }),
        201,
      );
      expect(ensured.invoice).toMatchObject({
        id: invoices[0].id,
        confirmedTotalCents: 40000,
      });
      const allocate = async (invoiceId: string, amountCents: number) =>
        success<{ payment: InvoicePayment }>(
          await request.post(`/api/invoices/${invoiceId}/payments`, {
            data: { transactionId: payment.id, amountCents },
          }),
          201,
        );
      const first = await allocate(invoices[0].id, 30000);
      const second = await allocate(invoices[1].id, 30000);
      const repeated = await allocate(invoices[0].id, 30000);
      expect(repeated.payment.id).toBe(first.payment.id);
      const linked = await state(request);
      expect(
        linked.invoicePayments?.filter(
          (link) => link.transactionId === payment.id,
        ),
      ).toHaveLength(2);
      expect(linked.transactions).toEqual(imported.transactions);
      expect(
        (
          await request.post(`/api/invoices/${invoices[0].id}/payments`, {
            data: { transactionId: payment.id, amountCents: 35000 },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await request.patch(`/api/sources/${bank.id}`, {
            data: { type: "benefit" },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.patch(`/api/sources/${cardA.id}`, {
            data: { type: "bank" },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.patch(`/api/transactions/${payment.id}`, {
            data: { kind: "expense" },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.patch(`/api/transactions/${payment.id}`, {
            data: { amountCents: 59999 },
          })
        ).status(),
      ).toBe(400);
      await success(
        await request.delete(`/api/invoice-payments/${first.payment.id}`),
      );
      await success(
        await request.patch(`/api/transactions/${payment.id}`, {
          data: { amountCents: 50000 },
        }),
      );
      await success(
        await request.delete(`/api/invoice-payments/${second.payment.id}`),
      );
      await success(
        await request.patch(`/api/transactions/${payment.id}`, {
          data: { kind: "expense" },
        }),
      );
      await success(
        await request.patch(`/api/sources/${bank.id}`, {
          data: { type: "benefit" },
        }),
      );
      await success(
        await request.patch(`/api/sources/${bank.id}`, {
          data: { type: "bank" },
        }),
      );
      await success(
        await request.patch(`/api/transactions/${payment.id}`, {
          data: { kind: "card_payment", amountCents: 60000 },
        }),
      );
      await allocate(invoices[0].id, 40000);
      await allocate(invoices[1].id, 20000);
      const beforeUndo = await state(request);
      expect(beforeUndo.transactions).toEqual(imported.transactions);
      const summaries = invoiceSummaries(beforeUndo, month);
      expect(
        summaries.find((invoice) => invoice.sourceId === cardA.id),
      ).toMatchObject({ remainingCents: 0, status: "paid" });
      expect(
        summaries.find((invoice) => invoice.sourceId === cardB.id),
      ).toMatchObject({ remainingCents: 10000, status: "partial" });
      const removed = await removeBatch(request, batches, paidBatch.batchId);
      expect(removed).toMatchObject({
        restoredBalances: 1,
        keptBalances: 0,
        legacyBaselineUnknown: false,
      });
      const afterUndo = await state(request);
      expect(
        afterUndo.invoicePayments?.filter(
          (link) => link.transactionId === payment.id,
        ),
      ).toHaveLength(0);
      expect(afterUndo.transactions.some((tx) => tx.id === payment.id)).toBe(
        false,
      );
      expect(
        afterUndo.transactions.filter(
          (tx) => tx.importId === purchases.batchId,
        ),
      ).toEqual(
        imported.transactions.filter((tx) => tx.importId === purchases.batchId),
      );
      expect(
        afterUndo.sources.find((source) => source.id === bank.id),
      ).toMatchObject({
        initialBalanceCents: bank.initialBalanceCents,
        balanceDate: bank.balanceDate,
        hasOpeningBalance: bank.hasOpeningBalance,
        balanceVersion: bank.balanceVersion ?? "",
      });
      const reopened = invoiceSummaries(afterUndo, month);
      expect(
        reopened.find((invoice) => invoice.sourceId === cardA.id),
      ).toMatchObject({ remainingCents: 40000, status: "open" });
      expect(
        reopened.find((invoice) => invoice.sourceId === cardB.id),
      ).toMatchObject({ remainingCents: 30000, status: "open" });
    } finally {
      // Only records created by this test are touched. Empty dedicated sources
      // and invoice/cycle metadata remain because those APIs have no DELETE.
      for (const id of [...batches])
        expect
          .soft((await request.delete(`/api/imports/${id}`)).ok())
          .toBeTruthy();
      for (const invoice of invoices)
        expect
          .soft(
            (
              await request.post("/api/invoices", {
                data: {
                  sourceId: invoice.sourceId,
                  month: invoice.month,
                  confirmedTotalCents: null,
                },
              })
            ).ok(),
          )
          .toBeTruthy();
      expect
        .soft(
          (
            await request.patch(`/api/sources/${bank.id}`, {
              data: {
                type: "bank",
                initialBalanceCents: 0,
                balanceDate: "2026-01-01",
                hasOpeningBalance: true,
              },
            })
          ).ok(),
        )
        .toBeTruthy();
    }
    expect((await state(request)).transactions).toEqual(initial.transactions);
  });

  test("saldos importados são restaurados nos dois sentidos e uma escolha manual posterior é mantida", async ({
    request,
  }) => {
    const initial = await signIn(request),
      suffix = randomUUID();
    const bank = await createSource(
      request,
      `Restauração sintética ${suffix}`,
      "bank",
      111000,
    );
    const batches = new Set<string>();
    const findSource = async () =>
      (await state(request)).sources.find((source) => source.id === bank.id)!;
    let serial = 0;
    const accept = async (amountCents: number, date: string) =>
      importBatch(
        request,
        batches,
        [item(bank.id, `Movimento ${suffix} ${++serial}`, "expense", 1000)],
        [{ sourceId: bank.id, amountCents, date }],
      );
    try {
      for (const reverse of [false, true]) {
        const a = await accept(222000, "2026-01-02"),
          b = await accept(333000, "2026-01-03");
        expect((await findSource()).initialBalanceCents).toBe(333000);
        const first = await removeBatch(
          request,
          batches,
          reverse ? b.batchId : a.batchId,
        );
        expect(first.restoredBalances).toBe(reverse ? 1 : 0);
        expect(first.keptBalances).toBe(reverse ? 0 : 1);
        await removeBatch(request, batches, reverse ? a.batchId : b.batchId);
        expect(await findSource()).toMatchObject({
          initialBalanceCents: 111000,
          balanceDate: "2026-01-01",
          hasOpeningBalance: true,
          balanceVersion: bank.balanceVersion ?? "",
        });
      }
      const a = await accept(222000, "2026-01-02");
      await success(
        await request.patch(`/api/sources/${bank.id}`, {
          data: {
            initialBalanceCents: 777000,
            balanceDate: "2026-02-01",
            hasOpeningBalance: false,
          },
        }),
      );
      const manual = await findSource();
      const b = await accept(333000, "2026-01-03");
      expect(
        (await removeBatch(request, batches, a.batchId)).keptBalances,
      ).toBe(1);
      expect((await findSource()).initialBalanceCents).toBe(333000);
      expect(
        (await removeBatch(request, batches, b.batchId)).restoredBalances,
      ).toBe(1);
      expect(await findSource()).toMatchObject({
        initialBalanceCents: 777000,
        balanceDate: "2026-02-01",
        hasOpeningBalance: false,
        balanceVersion: manual.balanceVersion,
      });
      const beforeBad = await state(request);
      expect(
        (
          await request.post("/api/imports", {
            data: {
              items: [item(bank.id, `Inválido ${suffix}`, "expense", 100)],
              balanceUpdates: [
                { sourceId: bank.id, amountCents: 10, date: "2026-02-30" },
              ],
            },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.post("/api/imports", {
            data: {
              items: [item(bank.id, `Inválido ${suffix}`, "expense", 100)],
              balanceUpdates: [
                {
                  sourceId: bank.id,
                  amountCents: 10,
                  date: "2026-01-01",
                  ownerId: "forged",
                },
              ],
            },
          })
        ).status(),
      ).toBe(400);
      const afterBad = await state(request);
      expect(afterBad.transactions).toEqual(beforeBad.transactions);
      expect(afterBad.imports).toEqual(beforeBad.imports);
      expect(afterBad.sources.find((source) => source.id === bank.id)).toEqual(
        manual,
      );
    } finally {
      for (const id of [...batches])
        expect
          .soft((await request.delete(`/api/imports/${id}`)).ok())
          .toBeTruthy();
      expect
        .soft(
          (
            await request.patch(`/api/sources/${bank.id}`, {
              data: {
                initialBalanceCents: 0,
                balanceDate: "2026-01-01",
                hasOpeningBalance: true,
              },
            })
          ).ok(),
        )
        .toBeTruthy();
    }
    expect((await state(request)).transactions).toEqual(initial.transactions);
  });
});
