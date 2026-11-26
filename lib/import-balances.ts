import type { AppState, Source } from "./types.ts";

export interface ImportBalanceUpdate {
  sourceId: string;
  amountCents: number;
  date: string;
}
interface DemoBalanceChange {
  importId: string;
  sourceId: string;
  before: Pick<
    Source,
    "initialBalanceCents" | "balanceDate" | "hasOpeningBalance"
  >;
  beforeVersion: string;
  afterVersion: string;
}
type DemoState = AppState & { importBalanceChanges?: DemoBalanceChange[] };

/** Browser-memory bookkeeping for demo mode only, never sent to the API. */
export function applyDemoImportBalances(
  state: AppState,
  batchId: string,
  updates: readonly ImportBalanceUpdate[],
): AppState {
  const changes = [...((state as DemoState).importBalanceChanges ?? [])];
  const bySource = new Map(updates.map((update) => [update.sourceId, update]));
  const sources = state.sources.map((source) => {
    const update = bySource.get(source.id);
    if (!update || source.ownerId !== state.user.id) return source;
    const afterVersion = crypto.randomUUID();
    changes.push({
      importId: batchId,
      sourceId: source.id,
      before: {
        initialBalanceCents: source.initialBalanceCents,
        balanceDate: source.balanceDate,
        hasOpeningBalance: source.hasOpeningBalance,
      },
      beforeVersion: source.balanceVersion ?? "",
      afterVersion,
    });
    return {
      ...source,
      initialBalanceCents: update.amountCents,
      balanceDate: update.date,
      hasOpeningBalance: true,
      balanceVersion: afterVersion,
    };
  });
  return { ...state, sources, importBalanceChanges: changes } as DemoState;
}

export function undoDemoImportBalances(
  state: AppState,
  batchId: string,
): AppState {
  const history = (state as DemoState).importBalanceChanges ?? [];
  const removed = history.filter((change) => change.importId === batchId);
  const changes = history
    .filter((change) => change.importId !== batchId)
    .map((child) => {
      const parent = removed.find(
        (change) =>
          change.sourceId === child.sourceId &&
          change.afterVersion === child.beforeVersion,
      );
      return parent
        ? {
            ...child,
            before: parent.before,
            beforeVersion: parent.beforeVersion,
          }
        : child;
    });
  const sources = state.sources.map((source) => {
    const change = removed.find(
      (entry) =>
        entry.sourceId === source.id &&
        entry.afterVersion === source.balanceVersion,
    );
    return change && source.ownerId === state.user.id
      ? { ...source, ...change.before, balanceVersion: change.beforeVersion }
      : source;
  });
  return { ...state, sources, importBalanceChanges: changes } as DemoState;
}
