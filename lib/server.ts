import { env } from "cloudflare:workers";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import {
  categoryRules,
  coupleMembers,
  couples,
  importBatches,
  sources,
  transactions,
  users,
} from "@/db/schema";
import { categoryRuleKey } from "./category-rules";
import { getPlanningState } from "./planning-server";
import { getGoalsState } from "./goals-server";
import type { AppState, ImportBatch, Transaction } from "@/lib/types";
import {
  IMPORT_TRANSACTIONS_SQL,
  JOIN_COUPLE_SQL,
} from "./database-statements";
import {
  allowedKeys,
  ApiError,
  boundedText,
  readJson,
  type SourceInput,
  validateImport,
  validateOrigin,
  validateSource,
  validateTransactionPatch,
} from "./validation";

export type Context = {
  user: ChatGPTUser;
  db: ReturnType<typeof getDb>;
  d1: D1Database;
};
type TransactionRow = typeof transactions.$inferSelect;

export async function api(
  request: Request,
  operation: (context: Context) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  try {
    if (request.method !== "GET" && request.method !== "HEAD")
      validateOrigin(request);
    const user = await getChatGPTUser();
    if (!user)
      throw new ApiError(401, "Entre com sua conta ChatGPT para continuar.");
    if (!env.DB)
      throw new ApiError(503, "O banco de dados ainda não está disponível.");
    const db = getDb();
    await db
      .insert(users)
      .values({
        id: user.userId,
        displayName: user.displayName.slice(0, 160),
        email: user.email,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          displayName: user.displayName.slice(0, 160),
          email: user.email,
          updatedAt: new Date().toISOString(),
        },
      });
    const result = await operation({ user, db, d1: env.DB });
    return Response.json(result, {
      status,
      headers: { "Cache-Control": "no-store", Vary: "Cookie" },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    // Do not put financial rows, request bodies or SQL bindings in application logs.
    console.error(
      "Finance API request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "Não foi possível concluir o pedido. Tente novamente." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function membership(context: Context) {
  const [member] = await context.db
    .select()
    .from(coupleMembers)
    .where(eq(coupleMembers.userId, context.user.userId))
    .limit(1);
  return member ?? null;
}

function serializeTransaction(
  row: TransactionRow,
  ownerName: string,
  coupleId: string | null,
): Transaction {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName,
    sourceId: row.sourceId,
    date: row.date,
    description: row.description,
    amountCents: row.amountCents,
    kind: row.kind,
    category: row.category,
    shared: row.shared && coupleId !== null && row.sharedCoupleId === coupleId,
    installmentCurrent: row.installmentCurrent,
    installmentTotal: row.installmentTotal,
    needsReview: row.needsReview,
    note: row.note,
    importId: row.importId,
    fingerprint: row.fingerprint,
  };
}

export async function getState(context: Context): Promise<AppState> {
  const ownerId = context.user.userId;
  const member = await membership(context);
  const coupleId = member?.coupleId ?? null;
  const [ownSources, ownTransactions, batches] = await Promise.all([
    context.db
      .select()
      .from(sources)
      .where(eq(sources.ownerId, ownerId))
      .orderBy(asc(sources.name)),
    context.db
      .select()
      .from(transactions)
      .where(eq(transactions.ownerId, ownerId))
      .orderBy(desc(transactions.date), desc(transactions.id)),
    context.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.ownerId, ownerId))
      .orderBy(desc(importBatches.createdAt)),
  ]);
  let couple: AppState["couple"] = null;
  let partnerTransactions: Transaction[] = [];
  if (coupleId) {
    const viewer = alias(coupleMembers, "viewer");
    const [members, sharedRows] = await Promise.all([
      context.db
        .select({ id: users.id, name: users.displayName })
        .from(coupleMembers)
        .innerJoin(users, eq(users.id, coupleMembers.userId))
        .innerJoin(
          viewer,
          and(
            eq(viewer.coupleId, coupleMembers.coupleId),
            eq(viewer.userId, ownerId),
          ),
        )
        .where(eq(coupleMembers.coupleId, coupleId))
        .orderBy(asc(coupleMembers.slot)),
      context.db
        .select({ transaction: transactions, ownerName: users.displayName })
        .from(transactions)
        .innerJoin(
          coupleMembers,
          eq(coupleMembers.userId, transactions.ownerId),
        )
        .innerJoin(users, eq(users.id, transactions.ownerId))
        .innerJoin(
          viewer,
          and(
            eq(viewer.coupleId, coupleMembers.coupleId),
            eq(viewer.userId, ownerId),
          ),
        )
        .where(
          and(
            eq(coupleMembers.coupleId, coupleId),
            eq(transactions.sharedCoupleId, coupleId),
            eq(transactions.shared, true),
            ne(transactions.ownerId, ownerId),
          ),
        )
        .orderBy(desc(transactions.date), desc(transactions.id)),
    ]);
    couple = members.length ? { id: coupleId, members } : null;
    partnerTransactions = sharedRows.map(({ transaction, ownerName }) => ({
      ...serializeTransaction(transaction, ownerName, coupleId),
      note: "",
      importId: null,
      fingerprint: "",
      needsReview: false,
    }));
  }
  const imports: ImportBatch[] = batches.map((batch) => ({
    id: batch.id,
    createdAt: batch.createdAt,
    files: JSON.parse(batch.filesJson) as string[],
    count: batch.count,
    incomeCents: batch.incomeCents,
    expenseCents: batch.expenseCents,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
  }));
  return {
    user: {
      id: ownerId,
      name: context.user.displayName,
      email: context.user.email,
    },
    sources: ownSources,
    transactions: ownTransactions.map((row) =>
      serializeTransaction(row, context.user.displayName, coupleId),
    ),
    partnerTransactions,
    imports,
    couple,
    ...(await getPlanningState(context, coupleId)),
    ...(await getGoalsState(context, coupleId)),
    rules: await context.db
      .select({
        id: categoryRules.id,
        description: categoryRules.description,
        key: categoryRules.key,
        category: categoryRules.category,
      })
      .from(categoryRules)
      .where(eq(categoryRules.ownerId, ownerId))
      .orderBy(asc(categoryRules.description)),
  };
}

export async function saveCategoryRule(context: Context, request: Request) {
  const body = await readJson(request);
  allowedKeys(body, ["description", "category"]);
  const description = boundedText(body.description, "Descrição", 500);
  const category = boundedText(body.category, "Categoria", 100);
  const key = categoryRuleKey(description);
  if (!key) throw new ApiError(400, "Informe um estabelecimento para a regra.");
  const [rule] = await context.db
    .insert(categoryRules)
    .values({
      id: crypto.randomUUID(),
      ownerId: context.user.userId,
      description,
      key,
      category,
    })
    .onConflictDoUpdate({
      target: [categoryRules.ownerId, categoryRules.key],
      set: { description, category },
    })
    .returning();
  return {
    rule: {
      id: rule.id,
      description: rule.description,
      key: rule.key,
      category: rule.category,
    },
  };
}

export async function deleteCategoryRule(context: Context, id: string) {
  boundedText(id, "Regra", 100);
  const removed = await context.db
    .delete(categoryRules)
    .where(
      and(
        eq(categoryRules.id, id),
        eq(categoryRules.ownerId, context.user.userId),
      ),
    )
    .returning({ id: categoryRules.id });
  if (!removed.length) throw new ApiError(404, "Regra não encontrada.");
  return { deleted: true };
}

export async function createSource(context: Context, request: Request) {
  const input = validateSource(await readJson(request)) as SourceInput;
  const [source] = await context.db
    .insert(sources)
    .values({ ...input, id: crypto.randomUUID(), ownerId: context.user.userId })
    .returning();
  return { source };
}

export async function updateSource(
  context: Context,
  request: Request,
  id: string,
) {
  boundedText(id, "Conta", 100);
  const patch = validateSource(await readJson(request), true);
  const [source] = await context.db
    .update(sources)
    .set(patch)
    .where(and(eq(sources.id, id), eq(sources.ownerId, context.user.userId)))
    .returning();
  if (!source) throw new ApiError(404, "Conta não encontrada.");
  return { source };
}

export async function createImport(context: Context, request: Request) {
  const items = validateImport(await readJson(request));
  const ownerId = context.user.userId;
  const ownSources = await context.db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.ownerId, ownerId));
  const sourceIds = new Set(ownSources.map((source) => source.id));
  if (items.some((item) => !sourceIds.has(item.sourceId)))
    throw new ApiError(400, "Escolha uma conta sua para cada arquivo.");
  const member = items.some((item) => item.shared)
    ? await membership(context)
    : null;
  if (items.some((item) => item.shared) && !member)
    throw new ApiError(
      400,
      "Conecte o casal antes de compartilhar lançamentos.",
    );
  const batchId = crypto.randomUUID();
  const filesJson = JSON.stringify([
    ...new Set(items.map((item) => item.fileName)),
  ]);
  if (new TextEncoder().encode(filesJson).byteLength > 1_500_000)
    throw new ApiError(400, "Selecione menos arquivos por importação.");
  const dates = items.map((item) => item.date).sort();
  const statements: D1PreparedStatement[] = [
    context.d1
      .prepare(
        `INSERT INTO import_batches
    (id, owner_id, created_at, files_json, count, income_cents, expense_cents, period_start, period_end)
    VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
      )
      .bind(
        batchId,
        ownerId,
        new Date().toISOString(),
        filesJson,
        dates[0],
        dates[dates.length - 1],
      ),
  ];
  for (let start = 0; start < items.length; start += 50) {
    const chunk = items.slice(start, start + 50).map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      shared: item.shared ? 1 : 0,
      needsReview: item.needsReview ? 1 : 0,
    }));
    statements.push(
      context.d1
        .prepare(IMPORT_TRANSACTIONS_SQL)
        .bind(
          ownerId,
          member?.coupleId ?? null,
          batchId,
          JSON.stringify(chunk),
          ownerId,
        ),
    );
  }
  statements.push(
    context.d1
      .prepare(
        `UPDATE import_batches SET
    count = (SELECT COUNT(*) FROM transactions WHERE import_id = ? AND owner_id = ?),
    income_cents = (SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN ABS(amount_cents) ELSE 0 END), 0) FROM transactions WHERE import_id = ? AND owner_id = ?),
    expense_cents = (SELECT COALESCE(SUM(CASE WHEN kind = 'expense' THEN ABS(amount_cents) WHEN kind = 'refund' THEN -ABS(amount_cents) ELSE 0 END), 0) FROM transactions WHERE import_id = ? AND owner_id = ?),
    period_start = COALESCE((SELECT MIN(date) FROM transactions WHERE import_id = ? AND owner_id = ?), period_start),
    period_end = COALESCE((SELECT MAX(date) FROM transactions WHERE import_id = ? AND owner_id = ?), period_end)
    WHERE id = ? AND owner_id = ?`,
      )
      .bind(
        batchId,
        ownerId,
        batchId,
        ownerId,
        batchId,
        ownerId,
        batchId,
        ownerId,
        batchId,
        ownerId,
        batchId,
        ownerId,
      ),
  );
  const result = await context.d1.batch(statements);
  const imported = result
    .slice(1, -1)
    .reduce((total, item) => total + item.meta.changes, 0);
  return { imported, duplicates: items.length - imported, batchId };
}

export async function updateTransaction(
  context: Context,
  request: Request,
  id: string,
) {
  boundedText(id, "Lançamento", 100);
  const patch = validateTransactionPatch(await readJson(request));
  const member = await membership(context);
  if (patch.shared && !member)
    throw new ApiError(
      400,
      "Conecte o casal antes de compartilhar lançamentos.",
    );
  const [transaction] = await context.db
    .update(transactions)
    .set({
      ...patch,
      ...(patch.shared === undefined
        ? {}
        : { sharedCoupleId: patch.shared ? (member?.coupleId ?? null) : null }),
    })
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.ownerId, context.user.userId),
      ),
    )
    .returning();
  if (!transaction) throw new ApiError(404, "Lançamento não encontrado.");
  // Preserve the original import fingerprint when correcting a row so a repeat
  // upload does not reinsert the original bank description or category.
  return {
    transaction: serializeTransaction(
      transaction,
      context.user.displayName,
      member?.coupleId ?? null,
    ),
  };
}

export async function deleteImport(context: Context, id: string) {
  boundedText(id, "Importação", 100);
  const ownerId = context.user.userId;
  const [batch] = await context.db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.id, id), eq(importBatches.ownerId, ownerId)))
    .limit(1);
  if (!batch) throw new ApiError(404, "Importação não encontrada.");
  const result = await context.d1.batch([
    context.d1
      .prepare("DELETE FROM transactions WHERE import_id = ? AND owner_id = ?")
      .bind(id, ownerId),
    context.d1
      .prepare("DELETE FROM import_batches WHERE id = ? AND owner_id = ?")
      .bind(id, ownerId),
  ]);
  return { deleted: result[0].meta.changes };
}

function createInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))]
    .map((byte) => alphabet[byte & 31])
    .join("");
}

async function hashInvite(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function updateCouple(context: Context, request: Request) {
  const body = await readJson(request);
  allowedKeys(body, ["action", "code"]);
  if (!["create", "join", "leave"].includes(String(body.action)))
    throw new ApiError(400, "Ação de casal inválida.");
  const ownerId = context.user.userId;
  const member = await membership(context);
  const now = new Date().toISOString();
  if (body.action === "leave") {
    if (member) {
      await context.d1.batch([
        context.d1
          .prepare(
            "UPDATE transactions SET shared = 0, shared_couple_id = NULL WHERE owner_id = ? AND shared_couple_id = ?",
          )
          .bind(ownerId, member.coupleId),
        // Ending a relationship removes the link for both people. Their own
        // financial data remains private and unchanged; a future couple has
        // another id and cannot inherit this one's explicit sharing.
        context.d1
          .prepare(
            "DELETE FROM couples WHERE id = ? AND EXISTS (SELECT 1 FROM couple_members WHERE user_id = ? AND couple_id = couples.id)",
          )
          .bind(member.coupleId, ownerId),
      ]);
    }
    return {};
  }
  if (body.action === "create") {
    const code = createInviteCode();
    const inviteHash = await hashInvite(code);
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    if (member) {
      const result = await context.d1
        .prepare(
          "UPDATE couples SET invite_hash = ?, invite_expires_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM couple_members WHERE user_id = ? AND couple_id = couples.id)",
        )
        .bind(inviteHash, expiresAt, member.coupleId, ownerId)
        .run();
      if (result.meta.changes !== 1)
        throw new ApiError(
          409,
          "Seu vínculo de casal mudou. Atualize a página e tente novamente.",
        );
    } else {
      const coupleId = crypto.randomUUID();
      try {
        await context.d1.batch([
          context.d1
            .prepare(
              "INSERT INTO couples (id, created_by, invite_hash, invite_expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(coupleId, ownerId, inviteHash, expiresAt, now),
          context.d1
            .prepare(
              "INSERT INTO couple_members (user_id, couple_id, slot, joined_at) VALUES (?, ?, 1, ?)",
            )
            .bind(ownerId, coupleId, now),
        ]);
      } catch {
        throw new ApiError(
          409,
          "Seu vínculo de casal mudou. Atualize a página e tente novamente.",
        );
      }
    }
    return { code };
  }
  const code = boundedText(body.code, "Código do convite", 32)
    .replace(/\s|-/g, "")
    .toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code))
    throw new ApiError(400, "Informe o código de 12 caracteres do convite.");
  if (member)
    throw new ApiError(
      409,
      "Saia do casal atual antes de aceitar outro convite.",
    );
  const inviteHash = await hashInvite(code);
  try {
    // Unique (couple_id, slot), slot CHECK, and user_id primary key enforce
    // capacity two and one relationship per person even for concurrent joins.
    const result = await context.d1
      .prepare(JOIN_COUPLE_SQL)
      .bind(ownerId, now, inviteHash, now, ownerId)
      .run();
    if (result.meta.changes !== 1)
      throw new ApiError(400, "Convite inválido, expirado ou já utilizado.");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      409,
      "Não foi possível aceitar este convite. Atualize a página e tente novamente.",
    );
  }
  return {};
}
