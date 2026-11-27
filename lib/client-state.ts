import type { AppState } from "./types.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** API responses are JSON objects. A proxy's successful HTML page or an error
 * object is not confirmation that a financial operation succeeded. */
export function readApiJson(raw: string, ok = true): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Não foi possível ler a resposta do servidor. Tente novamente.",
    );
  }
  const result = object(parsed);
  if (!ok || (result && Object.hasOwn(result, "error"))) {
    throw new Error(
      result && typeof result.error === "string" && result.error.trim()
        ? result.error
        : "Não foi possível concluir a operação.",
    );
  }
  if (!result)
    throw new Error("A resposta do servidor é inválida. Tente novamente.");
  return result;
}

/** Guard the state boundary before rendering; malformed successful responses
 * must leave the last known financial data available for retry. */
export function readAppState(value: unknown): AppState {
  const result = object(value),
    user = object(result?.user);
  const coreArrays = [
    "sources",
    "transactions",
    "partnerTransactions",
    "imports",
  ];
  const optionalArrays = [
    "rules",
    "budgets",
    "schedules",
    "occurrences",
    "goals",
    "goalMovements",
    "reservePlans",
    "cardCycles",
    "cardInvoices",
    "invoicePayments",
  ];
  const couple = result?.couple === null ? null : object(result?.couple);
  if (
    !result ||
    !user ||
    !["id", "name", "email"].every((key) => typeof user[key] === "string") ||
    coreArrays.some((key) => !Array.isArray(result[key])) ||
    optionalArrays.some(
      (key) => result[key] !== undefined && !Array.isArray(result[key]),
    ) ||
    (result.couple !== null &&
      (!couple ||
        typeof couple.id !== "string" ||
        !Array.isArray(couple.members) ||
        !couple.members.every((member) => {
          const row = object(member);
          return (
            row && typeof row.id === "string" && typeof row.name === "string"
          );
        })))
  ) {
    throw new Error(
      "A resposta do servidor está incompleta. Tente atualizar novamente.",
    );
  }
  return result as unknown as AppState;
}
function mergeRows<T extends { id: string }>(
  current: readonly T[] | undefined,
  values: unknown,
): T[] {
  const rows = Array.isArray(values)
    ? (values.filter((value) => typeof object(value)?.id === "string") as T[])
    : [];
  const merged = new Map((current ?? []).map((row) => [row.id, row]));
  for (const row of rows) merged.set(row.id, row);
  return [...merged.values()];
}

function clearCoupleState(state: AppState): AppState {
  const schedules = (state.schedules ?? []).filter(
      (row) => row.scope === "personal",
    ),
    goals = (state.goals ?? []).filter((row) => row.scope === "personal");
  const scheduleIds = new Set(schedules.map((row) => row.id)),
    goalIds = new Set(goals.map((row) => row.id));
  return {
    ...state,
    couple: null,
    partnerTransactions: [],
    transactions: state.transactions.map((row) =>
      row.shared ? { ...row, shared: false } : row,
    ),
    budgets: (state.budgets ?? []).filter((row) => row.scope === "personal"),
    schedules,
    goals,
    occurrences: (state.occurrences ?? []).filter((row) =>
      scheduleIds.has(row.scheduleId),
    ),
    goalMovements: (state.goalMovements ?? []).filter((row) =>
      goalIds.has(row.goalId),
    ),
  };
}

/** Apply only server-confirmed records. A failed follow-up GET must not hide a
 * completed write or suggest repeating an already completed financial action. */
export function mergeMutationResult(
  state: AppState,
  path: string,
  method: string,
  value: unknown,
  body?: unknown,
): AppState {
  const result = object(value);
  if (!result) return state;
  const input = object(body);
  let next = { ...state };
  if (object(result.source))
    next.sources = mergeRows(state.sources, [result.source]);
  if (Array.isArray(result.sources))
    next.sources = mergeRows(next.sources, result.sources);
  if (object(result.transaction))
    next.transactions = mergeRows(state.transactions, [result.transaction]);
  if (Array.isArray(result.transactions))
    next.transactions = mergeRows(next.transactions, result.transactions);
  if (object(result.budget))
    next.budgets = mergeRows(state.budgets, [result.budget]);
  if (Array.isArray(result.budgets)) {
    if (
      path === "/api/budgets/copy" &&
      input &&
      (input.scope === "personal" || input.scope === "couple") &&
      typeof input.toMonth === "string"
    ) {
      const scope = input.scope,
        month = input.toMonth;
      const returned = mergeRows<NonNullable<AppState["budgets"]>[number]>(
        [],
        result.budgets,
      ).filter((row) => row.scope === scope && row.month === month);
      next.budgets = [
        ...(next.budgets ?? []).filter(
          (row) => row.scope !== scope || row.month !== month,
        ),
        ...returned,
      ];
    } else next.budgets = mergeRows(next.budgets, result.budgets);
  }
  if (object(result.schedule))
    next.schedules = mergeRows(state.schedules, [result.schedule]);
  if (object(result.occurrence))
    next.occurrences = mergeRows(state.occurrences, [result.occurrence]);
  if (object(result.rule)) next.rules = mergeRows(state.rules, [result.rule]);
  if (object(result.goal)) next.goals = mergeRows(state.goals, [result.goal]);
  if (object(result.movement))
    next.goalMovements = mergeRows(state.goalMovements, [result.movement]);
  if (object(result.invoice))
    next.cardInvoices = mergeRows(state.cardInvoices, [result.invoice]);
  if (object(result.payment))
    next.invoicePayments = mergeRows(state.invoicePayments, [result.payment]);
  const plan = object(result.plan);
  if (plan && typeof plan.id === "string" && typeof plan.month === "string")
    next.reservePlans = [
      ...(state.reservePlans ?? []).filter((row) => row.month !== plan.month),
      plan as unknown as NonNullable<AppState["reservePlans"]>[number],
    ];
  const cycle = object(result.cycle);
  if (cycle && typeof cycle.sourceId === "string")
    next.cardCycles = [
      ...(state.cardCycles ?? []).filter(
        (row) => row.sourceId !== cycle.sourceId,
      ),
      cycle as unknown as NonNullable<AppState["cardCycles"]>[number],
    ];
  const batch = object(result.batch);
  if (batch && typeof batch.id === "string")
    next.imports = [
      batch as unknown as AppState["imports"][number],
      ...state.imports.filter((row) => row.id !== batch.id),
    ];

  const parts = path.split("/").filter(Boolean);
  const id = parts[2];
  if (method === "DELETE" && id) {
    if (parts[1] === "rules")
      next.rules = (next.rules ?? []).filter((row) => row.id !== id);
    if (parts[1] === "budgets")
      next.budgets = (next.budgets ?? []).filter((row) => row.id !== id);
    if (parts[1] === "schedules") {
      next.schedules = (next.schedules ?? []).filter((row) => row.id !== id);
      next.occurrences = (next.occurrences ?? []).filter(
        (row) => row.scheduleId !== id,
      );
    }
    if (parts[1] === "goals") {
      next.goals = (next.goals ?? []).filter((row) => row.id !== id);
      next.goalMovements = (next.goalMovements ?? []).filter(
        (row) => row.goalId !== id,
      );
    }
    if (parts[1] === "invoice-payments")
      next.invoicePayments = (next.invoicePayments ?? []).filter(
        (row) => row.id !== id,
      );
    if (parts[1] === "reserve-plans")
      next.reservePlans = (next.reservePlans ?? []).filter(
        (row) => row.month !== id,
      );
    if (parts[1] === "imports") {
      const removedIds = new Set(
        state.transactions
          .filter((row) => row.importId === id)
          .map((row) => row.id),
      );
      next.transactions = next.transactions.filter(
        (row) => row.importId !== id,
      );
      next.imports = next.imports.filter((row) => row.id !== id);
      next.invoicePayments = (next.invoicePayments ?? []).filter(
        (row) => !removedIds.has(row.transactionId),
      );
      next.occurrences = (next.occurrences ?? []).map((row) =>
        row.transactionId && removedIds.has(row.transactionId)
          ? { ...row, transactionId: null }
          : row,
      );
    }
  }
  if (path.endsWith("/occurrences") && input?.action === "reset")
    next.occurrences = (next.occurrences ?? []).filter(
      (row) => row.scheduleId !== id || row.dueDate !== input.dueDate,
    );
  if (path === "/api/couple") {
    if (input?.action === "leave") next = clearCoupleState(next);
    if (input?.action === "create" || input?.action === "join") {
      const couple = object(result.couple);
      if (
        couple &&
        typeof couple.id === "string" &&
        Array.isArray(couple.members) &&
        couple.members.every((member) => {
          const row = object(member);
          return (
            row && typeof row.id === "string" && typeof row.name === "string"
          );
        })
      ) {
        // A different group cannot inherit the previous partner's cached data.
        // New partner transactions and plans arrive only through a valid GET.
        if (next.couple?.id !== couple.id) next = clearCoupleState(next);
        next.couple = {
          id: couple.id,
          members: couple.members.map((member) => ({
            id: member.id as string,
            name: member.name as string,
          })),
        };
      }
    }
  }
  return next;
}
