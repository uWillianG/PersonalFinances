import type { AppState, Source, Transaction } from "./types.ts";
import type { PlanScope } from "./planning-types.ts";
import {
  buildCalendar,
  budgetProgress,
  categoryKey,
  todayISO,
} from "./planning.ts";
import { formatMoney, installmentForecast } from "./finance.ts";
import {
  defaultReservePlan,
  type ReserveEstimate,
  type ReserveIssue,
  type ReservePlanInput,
} from "./reserve-types.ts";

function validISO(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 1 &&
    Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function monthDates(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validISO(`${month}-01`))
    throw new RangeError("Mês inválido.");
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const nextStart = end.toISOString().slice(0, 10);
  end.setUTCDate(end.getUTCDate() - 1);
  return { end: end.toISOString().slice(0, 10), nextStart };
}

function unique<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function cashMovement(transaction: Transaction): number {
  return (
    (transaction.kind === "income" ||
    transaction.kind === "refund" ||
    transaction.kind === "transfer_in"
      ? 1
      : -1) * transaction.amountCents
  );
}

function snapshot(
  source: Source,
  transactions: readonly Transaction[],
  cutoff: string,
  nextStart: string,
  today: string,
) {
  // A known next-month opening balance also describes the previous month-end,
  // but must already exist in time before it can cap a current estimate.
  const referenceValid = validISO(source.balanceDate);
  const complete =
    source.hasOpeningBalance &&
    referenceValid &&
    (source.balanceDate <= cutoff ||
      (source.balanceDate === nextStart && nextStart <= today));
  let balanceCents = complete ? source.initialBalanceCents : 0;
  for (const transaction of transactions)
    if (
      transaction.sourceId === source.id &&
      transaction.date <= cutoff &&
      (!referenceValid || transaction.date >= source.balanceDate)
    )
      balanceCents += cashMovement(transaction);
  return { balanceCents, complete };
}

/** A cautious planning estimate; no value here creates a transfer or a ledger row. */
export function estimateReserve(
  data: AppState,
  month: string,
  plan: ReservePlanInput = defaultReservePlan(month),
  today = todayISO(),
): ReserveEstimate {
  const { end, nextStart } = monthDates(month);
  if (!validISO(today)) throw new RangeError("Data de referência inválida.");
  const asOf = today < end ? today : end;
  const future = month > today.slice(0, 7);
  const ownerId = data.user.id;
  const sources = unique(
    data.sources.filter((source) => source.ownerId === ownerId),
  );
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const own = unique(
    data.transactions.filter(
      (transaction) =>
        transaction.ownerId === ownerId && transaction.date <= asOf,
    ),
  );
  const periodOwn = own.filter(
    (transaction) => transaction.date.slice(0, 7) === month,
  );
  const eligible = own.filter((transaction) => {
    const source = sourceById.get(transaction.sourceId);
    return source && source.type !== "benefit";
  });
  const period = eligible.filter(
    (transaction) => transaction.date.slice(0, 7) === month,
  );
  const partner = data.couple
    ? unique(
        data.partnerTransactions.filter(
          (transaction) =>
            transaction.ownerId !== ownerId &&
            transaction.shared &&
            transaction.date <= asOf,
        ),
      )
    : [];
  const bankSources = sources.filter((source) => source.type === "bank");
  const balances = bankSources.map((source) =>
    snapshot(source, own, asOf, nextStart, today),
  );
  const bankBalanceCents = balances.reduce(
    (total, item) => total + item.balanceCents,
    0,
  );
  const balanceComplete =
    balances.length > 0 && balances.every((item) => item.complete);
  const incomeCents = period
    .filter(
      (transaction) =>
        transaction.kind === "income" &&
        sourceById.get(transaction.sourceId)?.type === "bank",
    )
    .reduce((total, transaction) => total + transaction.amountCents, 0);
  const expenseCents = period.reduce(
    (total, transaction) =>
      total +
      (transaction.kind === "expense"
        ? transaction.amountCents
        : transaction.kind === "refund"
          ? -transaction.amountCents
          : 0),
    0,
  );
  const benefitIncomeCents = periodOwn
    .filter(
      (transaction) =>
        transaction.kind === "income" &&
        sourceById.get(transaction.sourceId)?.type === "benefit",
    )
    .reduce((total, transaction) => total + transaction.amountCents, 0);
  const cardSpendingCents = Math.max(
    0,
    period
      .filter(
        (transaction) =>
          sourceById.get(transaction.sourceId)?.type === "credit",
      )
      .reduce(
        (total, transaction) =>
          total +
          (transaction.kind === "expense"
            ? transaction.amountCents
            : transaction.kind === "refund"
              ? -transaction.amountCents
              : 0),
        0,
      ),
  );
  const issues: ReserveIssue[] = [];
  const addIssue = (
    code: string,
    title: string,
    detail: string,
    severity: ReserveIssue["severity"] = "warning",
  ) => issues.push({ code, title, detail, severity });
  if (future)
    addIssue(
      "future_month",
      "Mês futuro",
      "Receitas futuras não são dinheiro disponível. Consulte um mês já iniciado para calcular um valor.",
      "blocking",
    );
  if (!balanceComplete)
    addIssue(
      "missing_bank_balance",
      "Saldo bancário incompleto",
      "Informe os saldos de referência das suas contas bancárias. Referências futuras não comprovam o caixa disponível nesta data.",
      "blocking",
    );
  if (periodOwn.some((transaction) => !sourceById.has(transaction.sourceId)))
    addIssue(
      "unknown_source",
      "Origem a conferir",
      "Há lançamentos sem uma conta identificada; não é possível separar dinheiro bancário de benefícios.",
      "blocking",
    );
  const affectsEstimate = (transaction: Transaction) =>
    transaction.date.slice(0, 7) === month ||
    (sourceById.get(transaction.sourceId)?.type === "bank" &&
      transaction.date >=
        (sourceById.get(transaction.sourceId)?.balanceDate ?? ""));
  const pendingReview = eligible.some(
    (transaction) => transaction.needsReview && affectsEstimate(transaction),
  );
  if (pendingReview)
    addIssue(
      "pending_review",
      "Revise os lançamentos",
      "Valores ou classificações pendentes podem mudar a sobra mensal ou o saldo bancário.",
      "blocking",
    );
  if (
    eligible.some(
      (transaction) =>
        transaction.kind === "refund" &&
        sourceById.get(transaction.sourceId)?.type === "bank" &&
        affectsEstimate(transaction) &&
        /\bdevolucao\s+(?:de\s+)?pix\s+enviad[oa]\b/.test(
          transaction.description
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        ),
    )
  )
    addIssue(
      "ambiguous_refund",
      "Confira uma devolução Pix enviada",
      "Um registro antigo de devolução Pix enviada está classificado como estorno e pode aumentar indevidamente a sobra. Abra Lançamentos e revise o tipo antes de usar a estimativa.",
      "blocking",
    );
  if (sources.some((source) => source.type === "benefit"))
    addIssue(
      "benefit_excluded",
      "Benefícios separados",
      "Vale-alimentação e outros benefícios não entram como dinheiro disponível para reservar ou investir.",
      "info",
    );

  const provisionGroups = new Map<
    string,
    { scope: PlanScope; remaining: number; recurring: number }
  >();
  function group(scope: PlanScope, category: string) {
    const key = `${scope}:${categoryKey(category || "Outros")}`;
    const item = provisionGroups.get(key) ?? {
      scope,
      remaining: 0,
      recurring: 0,
    };
    provisionGroups.set(key, item);
    return item;
  }
  const budgets = unique(
    (data.budgets ?? []).filter(
      (budget) =>
        budget.month === month &&
        (budget.scope === "personal"
          ? budget.ownerId === ownerId
          : !!data.couple),
    ),
  );
  for (const budget of budgets) {
    const remaining = Math.max(
      0,
      budgetProgress(budget, eligible, partner).remainingCents,
    );
    const item = group(budget.scope, budget.category);
    item.remaining = Math.max(item.remaining, remaining);
  }
  const schedules = unique(
    (data.schedules ?? []).filter((schedule) =>
      schedule.scope === "personal"
        ? schedule.ownerId === ownerId
        : !!data.couple,
    ),
  );
  const accessibleTransactions = unique([...own, ...partner]);
  const entries = buildCalendar(
    schedules,
    data.occurrences ?? [],
    month,
    accessibleTransactions,
  );
  let pendingIncomeCents = 0;
  let scheduledCardCents = 0;
  let uncertainConfirmation = false;
  for (const entry of entries) {
    if (entry.state === "skipped" || entry.state === "linked") continue;
    if (entry.state === "confirmed") uncertainConfirmation = true;
    if (entry.schedule.kind === "income")
      pendingIncomeCents += entry.schedule.amountCents;
    else if (entry.schedule.kind === "card_payment")
      scheduledCardCents += entry.schedule.amountCents;
    else
      group(entry.schedule.scope, entry.schedule.category).recurring +=
        entry.schedule.amountCents;
  }
  const previous = new Date(`${month}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const previousMonth = previous.toISOString().slice(0, 7);
  const installmentGroups = new Map<
    string,
    { scope: PlanScope; category: string; transactions: Transaction[] }
  >();
  for (const transaction of eligible) {
    if (sourceById.get(transaction.sourceId)?.type !== "credit") continue;
    const scope: PlanScope =
      transaction.shared && data.couple ? "couple" : "personal";
    const key = `${scope}:${categoryKey(transaction.category || "Outros")}`;
    const item = installmentGroups.get(key) ?? {
      scope,
      category: transaction.category,
      transactions: [],
    };
    item.transactions.push(transaction);
    installmentGroups.set(key, item);
  }
  let missingInstallmentsCents = 0;
  for (const item of installmentGroups.values()) {
    const forecast = installmentForecast(item.transactions, previousMonth)[0]
      .amountCents;
    const imported = item.transactions
      .filter(
        (transaction) =>
          transaction.date.slice(0, 7) === month &&
          transaction.kind === "expense" &&
          transaction.installmentCurrent !== null &&
          transaction.installmentTotal !== null &&
          transaction.installmentTotal >= 2 &&
          transaction.installmentCurrent >= 1 &&
          transaction.installmentCurrent <= transaction.installmentTotal,
      )
      .reduce((total, transaction) => total + transaction.amountCents, 0);
    const missing = Math.max(0, forecast - imported);
    group(item.scope, item.category).recurring += missing;
    missingInstallmentsCents += missing;
  }
  if (missingInstallmentsCents > 0)
    addIssue(
      "installment_forecast",
      "Parcelas previstas neste mês",
      `Protegemos ${formatMoney(missingInstallmentsCents)} de parcelas previstas que ainda não aparecem nos lançamentos deste mês. Elas entram na provisão da categoria, sem criar despesa ou somar novamente o orçamento.`,
      "info",
    );
  let personalProvisionCents = 0,
    sharedProvisionCents = 0;
  for (const item of provisionGroups.values()) {
    const amount = Math.max(item.remaining, item.recurring);
    if (item.scope === "personal") personalProvisionCents += amount;
    else sharedProvisionCents += amount;
  }
  const appliedSharedCents = plan.sharedCommitmentCents ?? sharedProvisionCents;
  if (uncertainConfirmation)
    addIssue(
      "unlinked_confirmation",
      "Confirmações sem lançamento",
      "Compromissos confirmados sem vínculo com um lançamento continuam protegidos no cálculo; confirmar no calendário não altera o saldo importado.",
    );
  if (plan.sharedCommitmentCents === null && sharedProvisionCents > 0)
    addIssue(
      "shared_assumption",
      "Compromissos do casal por inteiro",
      "A provisão conjunta inteira foi protegida, sem presumir divisão entre vocês. Ajuste sua parte se necessário.",
    );
  if (partner.length && budgets.some((budget) => budget.scope === "couple"))
    addIssue(
      "shared_benefit_unknown",
      "Orçamento conjunto a conferir",
      "Os lançamentos compartilhados do parceiro ajudam a calcular o restante do orçamento. As contas privadas dele não ficam disponíveis nesta estimativa.",
      "info",
    );
  const cardReserveCents =
    plan.cardReserveCents ?? Math.max(cardSpendingCents, scheduledCardCents);
  if (
    plan.cardReserveCents === null &&
    (sources.some((source) => source.type === "credit") ||
      scheduledCardCents > 0)
  )
    addIssue(
      "card_assumption",
      "Proteção para faturas",
      "Usamos o maior valor entre compras líquidas no cartão deste mês e faturas previstas sem vínculo. Pagamentos bancários não comprovam qual fatura foi quitada. Ajuste o valor ainda a pagar.",
    );

  const goals = unique(
    (data.goals ?? []).filter((goal) =>
      goal.scope === "personal" ? goal.ownerId === ownerId : !!data.couple,
    ),
  );
  const goalIds = new Set(goals.map((goal) => goal.id));
  const movements = unique(
    (data.goalMovements ?? []).filter(
      (movement) => goalIds.has(movement.goalId) && movement.date <= asOf,
    ),
  );
  let defaultGoalReserveCents = 0;
  for (const goal of goals) {
    let total = 0,
      ownTotal = 0;
    for (const movement of movements)
      if (movement.goalId === goal.id) {
        const amount =
          (movement.kind === "deposit" ? 1 : -1) * movement.amountCents;
        total += amount;
        if (movement.ownerId === ownerId) ownTotal += amount;
      }
    defaultGoalReserveCents +=
      goal.scope === "personal"
        ? Math.max(0, total)
        : Math.min(Math.max(0, total), Math.max(0, ownTotal));
  }
  const goalContributionsCents = Math.max(
    0,
    movements
      .filter(
        (movement) =>
          movement.ownerId === ownerId && movement.date.slice(0, 7) === month,
      )
      .reduce(
        (total, movement) =>
          total + (movement.kind === "deposit" ? 1 : -1) * movement.amountCents,
        0,
      ),
  );
  const goalReserveCents = plan.goalReserveCents ?? defaultGoalReserveCents;
  if (plan.goalReserveCents === null && defaultGoalReserveCents > 0)
    addIssue(
      "goal_assumption",
      "Reservas das caixinhas protegidas",
      "Protegemos as reservas pessoais e, nas conjuntas, até suas contribuições líquidas limitadas ao saldo da meta. Se o dinheiro estiver fora das contas importadas, ajuste o valor para evitar proteção duplicada.",
    );
  if (!data.imports.length)
    addIssue(
      "no_imports",
      "Cobertura dos dados a conferir",
      "Ainda não há uma importação registrada. O cálculo utiliza apenas os saldos e lançamentos disponíveis.",
    );
  else {
    const latest = data.imports.reduce(
      (date, batch) => (batch.periodEnd > date ? batch.periodEnd : date),
      "",
    );
    if (latest < asOf)
      addIssue(
        "stale_imports",
        "Extratos não cobrem toda a data",
        "Os arquivos importados terminam antes da data desta estimativa. Gastos ainda não importados podem reduzir o valor.",
      );
    addIssue(
      "coverage_unknown",
      "Estimativa baseada nos arquivos",
      "A data de uma importação não comprova que todas as contas e cartões estejam atualizados. Confira a cobertura dos seus extratos.",
      "info",
    );
  }
  const extraExpenseCents = plan.extraExpenseCents;
  const minimumBalanceCents = plan.minimumBalanceCents;
  const monthlyMarginCents =
    incomeCents -
    expenseCents -
    personalProvisionCents -
    appliedSharedCents -
    extraExpenseCents -
    goalContributionsCents;
  const cashCapacityCents =
    bankBalanceCents -
    personalProvisionCents -
    appliedSharedCents -
    extraExpenseCents -
    cardReserveCents -
    goalReserveCents -
    minimumBalanceCents;
  const suggestedCents = issues.some((issue) => issue.severity === "blocking")
    ? null
    : Math.max(0, Math.min(monthlyMarginCents, cashCapacityCents));
  return {
    month,
    asOf,
    future,
    incomeCents,
    expenseCents,
    benefitIncomeCents,
    bankBalanceCents,
    balanceComplete,
    personalProvisionCents,
    sharedProvisionCents,
    appliedSharedCents,
    extraExpenseCents,
    pendingIncomeCents,
    cardSpendingCents,
    cardReserveCents,
    defaultGoalReserveCents,
    goalReserveCents,
    goalContributionsCents,
    minimumBalanceCents,
    monthlyMarginCents,
    cashCapacityCents,
    suggestedCents,
    issues,
    nextInstallments: installmentForecast(eligible, month),
  };
}
