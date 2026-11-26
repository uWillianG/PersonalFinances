"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Banknote,
  Calculator,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Info,
  LoaderCircle,
  LockKeyhole,
  PiggyBank,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import type { AppState } from "../../lib/types";
import {
  defaultReservePlan,
  type ReserveEstimate,
  type ReservePlanInput,
} from "../../lib/reserve-types";
import { estimateReserve } from "../../lib/reserve-estimate";
import { formatMoney, monthLabel } from "../../lib/finance";
import { todayISO } from "../../lib/planning";
import "./reserve.css";

type Destination =
  "imports" | "sources" | "transactions" | "budgets" | "calendar" | "goals";
interface Props {
  data: AppState;
  month: string;
  busy: boolean;
  onSave: (input: ReservePlanInput) => Promise<void>;
  onReset: (month: string) => Promise<void>;
  onNavigate: (tab: Destination) => void;
}
type AutomaticField =
  "cardReserveCents" | "goalReserveCents" | "sharedCommitmentCents";
type MoneyField = "minimumBalanceCents" | "extraExpenseCents" | AutomaticField;
type Fields = Record<MoneyField, string> & {
  automatic: Record<AutomaticField, boolean>;
};
const automaticFields: AutomaticField[] = [
  "cardReserveCents",
  "goalReserveCents",
  "sharedCommitmentCents",
];

function decimal(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
function fieldsFromPlan(plan: ReservePlanInput): Fields {
  return {
    minimumBalanceCents: decimal(plan.minimumBalanceCents),
    extraExpenseCents: decimal(plan.extraExpenseCents),
    cardReserveCents:
      plan.cardReserveCents === null ? "" : decimal(plan.cardReserveCents),
    goalReserveCents:
      plan.goalReserveCents === null ? "" : decimal(plan.goalReserveCents),
    sharedCommitmentCents:
      plan.sharedCommitmentCents === null
        ? ""
        : decimal(plan.sharedCommitmentCents),
    automatic: {
      cardReserveCents: plan.cardReserveCents === null,
      goalReserveCents: plan.goalReserveCents === null,
      sharedCommitmentCents: plan.sharedCommitmentCents === null,
    },
  };
}
function parseCents(value: string): number | null {
  let normalized = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized))
    normalized = normalized.replace(/\./g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 1_000_000_000_000
    ? cents
    : null;
}
function parsePlan(fields: Fields, month: string): ReservePlanInput | null {
  const minimumBalanceCents = parseCents(fields.minimumBalanceCents);
  const extraExpenseCents = parseCents(fields.extraExpenseCents);
  if (minimumBalanceCents === null || extraExpenseCents === null) return null;
  const result = {
    ...defaultReservePlan(month),
    minimumBalanceCents,
    extraExpenseCents,
  };
  for (const field of automaticFields) {
    if (fields.automatic[field]) continue;
    const amount = parseCents(fields[field]);
    if (amount === null) return null;
    result[field] = amount;
  }
  return result;
}
function planKey(plan: ReservePlanInput): string {
  return JSON.stringify({
    month: plan.month,
    minimumBalanceCents: plan.minimumBalanceCents,
    extraExpenseCents: plan.extraExpenseCents,
    cardReserveCents: plan.cardReserveCents,
    goalReserveCents: plan.goalReserveCents,
    sharedCommitmentCents: plan.sharedCommitmentCents,
  });
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
function failure(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar seus ajustes. Tente novamente.";
}

export function ReserveView(props: Props) {
  // A new month always gets its own draft, including if an older save is pending.
  return (
    <ReserveCalculator
      key={`${props.data.user.id}:${props.month}`}
      {...props}
    />
  );
}

function ReserveCalculator({
  data,
  month,
  busy,
  onSave,
  onReset,
  onNavigate,
}: Props) {
  const persisted = data.reservePlans?.find((plan) => plan.month === month);
  const stored = persisted ?? defaultReservePlan(month);
  const storedKey = planKey(stored);
  const [fields, setFields] = useState<Fields>(() => fieldsFromPlan(stored));
  const [baseline, setBaseline] = useState<ReservePlanInput>(stored);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    automaticFields.some((field) => stored[field] !== null),
  );
  const pending = useRef(false);
  const edited = useRef(false);
  const mounted = useRef(true);
  const labelId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!edited.current) setFields(fieldsFromPlan(stored));
    setBaseline(stored);
    // The key intentionally tracks only the persisted values, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);
  const parsed = parsePlan(fields, month);
  const dirty = parsed === null || planKey(parsed) !== planKey(baseline);
  const estimate = estimateReserve(data, month, parsed ?? baseline);
  const waiting = busy || submitting;
  const invalid = parsed === null;
  const hasBlocking = estimate.issues.some(
    (issue) => issue.severity === "blocking",
  );
  const shortfallCents = Math.max(
    0,
    -Math.min(estimate.monthlyMarginCents, estimate.cashCapacityCents),
  );
  const historical = month < todayISO().slice(0, 7);
  const suggested = invalid ? null : estimate.suggestedCents;
  const reviewRequired = estimate.issues.some((issue) =>
    /review|revis/i.test(issue.code),
  );
  const recoveryTarget: Destination = estimate.future
    ? "calendar"
    : hasBlocking
      ? reviewRequired
        ? "transactions"
        : "sources"
      : "imports";
  const recoveryLabel = estimate.future
    ? "Ver calendário"
    : hasBlocking
      ? reviewRequired
        ? "Conferir lançamentos"
        : "Conferir saldos"
      : "Atualizar extratos";

  function change(field: MoneyField, value: string) {
    edited.current = true;
    setFields((state) => ({ ...state, [field]: value }));
    setNotice("");
    setError("");
  }
  function toggleAutomatic(
    field: AutomaticField,
    automatic: boolean,
    amount: number,
  ) {
    edited.current = true;
    setFields((state) => ({
      ...state,
      [field]: automatic ? state[field] : decimal(amount),
      automatic: { ...state.automatic, [field]: automatic },
    }));
    setNotice("");
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || busy) return;
    if (!parsed) {
      setError(
        "Complete os valores com números a partir de zero e até duas casas decimais.",
      );
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await onSave(parsed);
      if (!mounted.current) return;
      edited.current = false;
      setFields(fieldsFromPlan(parsed));
      setBaseline(parsed);
      setNotice("Ajustes salvos para este mês.");
    } catch (err) {
      if (mounted.current) setError(failure(err));
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  async function reset() {
    if (pending.current || busy) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      if (persisted) await onReset(month);
      if (!mounted.current) return;
      const defaults = defaultReservePlan(month);
      edited.current = false;
      setBaseline(defaults);
      setFields(fieldsFromPlan(defaults));
      setNotice("Estimativa automática restaurada para este mês.");
    } catch (err) {
      if (mounted.current) setError(failure(err));
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div className="reserve-view">
      <section
        className={`reserve-hero${suggested === null ? " reserve-hero-incomplete" : ""}`}
        aria-label="Estimativa para reservar ou investir"
      >
        <div className="reserve-hero-copy">
          <div className="reserve-hero-heading">
            <span>
              <PiggyBank size={20} aria-hidden="true" />
              Para os seus próximos planos
            </span>
            <span className="reserve-draft-badge">
              {dirty
                ? "Simulação não salva"
                : persisted
                  ? "Ajustes salvos"
                  : "Estimativa automática"}
            </span>
          </div>
          <h2>Estimativa para reservar ou investir</h2>
          <div
            className="reserve-suggestion"
            aria-live="polite"
            aria-atomic="true"
          >
            {suggested === null ? (
              <strong>{invalid ? "Complete os ajustes" : "A conferir"}</strong>
            ) : (
              <>
                <span>{suggested > 0 ? "Até" : "Neste cenário"}</span>
                <strong>{formatMoney(suggested)}</strong>
              </>
            )}
          </div>
          <p className="reserve-hero-note">
            {invalid
              ? "Informe valores válidos para atualizar a simulação."
              : estimate.future
                ? "Este mês ainda não começou. Entradas previstas não são dinheiro disponível para reservar hoje."
                : suggested === null
                  ? "Alguns dados precisam ser conferidos antes de estimar um valor adicional."
                  : suggested === 0
                    ? shortfallCents > 0
                      ? `Há ${formatMoney(shortfallCents)} a cobrir na sobra do mês ou no caixa protegido.`
                      : "Não há folga adicional depois dos compromissos e valores protegidos deste cenário."
                    : "Valor adicional pelos dados informados. Confira os gastos e os ajustes antes de separar esse dinheiro."}
          </p>
          <p className="reserve-hero-date">
            <CalendarDays size={16} aria-hidden="true" />
            {historical
              ? "Referência histórica"
              : "Dados considerados até"}{" "}
            {dateLabel(estimate.asOf)}
          </p>
          {historical && (
            <p className="reserve-history-note">
              Este cálculo descreve o mês selecionado e não representa dinheiro
              disponível hoje.
            </p>
          )}
          <div className="reserve-hero-actions">
            {suggested !== null && suggested > 0 ? (
              <button className="button" onClick={() => onNavigate("goals")}>
                Planejar uma meta
              </button>
            ) : (
              <button
                className="button"
                onClick={() => onNavigate(recoveryTarget)}
              >
                {recoveryLabel}
              </button>
            )}
          </div>
        </div>
        <div className="reserve-hero-context">
          <LockKeyhole size={19} aria-hidden="true" />
          <p>
            Esta estimativa usa suas próprias contas. Saldos privados do
            parceiro não entram no cálculo.
          </p>
          <span>
            <ShieldCheck size={17} aria-hidden="true" />
            Nenhum dinheiro é movimentado.
          </span>
        </div>
      </section>

      <section
        className="reserve-summary"
        aria-label="Referências da estimativa"
      >
        <article className="panel">
          <span>
            <Banknote size={18} aria-hidden="true" />
            Sobra mensal estimada
          </span>
          <strong
            className={
              estimate.monthlyMarginCents < 0 ? "reserve-negative" : ""
            }
          >
            {invalid ? "—" : formatMoney(estimate.monthlyMarginCents)}
          </strong>
          <p>Depois dos gastos previstos e dos seus aportes do mês.</p>
        </article>
        <article className="panel">
          <span>
            <Wallet size={18} aria-hidden="true" />
            Caixa após proteções
          </span>
          <strong
            className={estimate.cashCapacityCents < 0 ? "reserve-negative" : ""}
          >
            {invalid ? "—" : formatMoney(estimate.cashCapacityCents)}
          </strong>
          <p>Saldo bancário menos compromissos, faturas e reservas.</p>
        </article>
      </section>
      <p className="reserve-method-note">
        <Info size={18} aria-hidden="true" />
        Usamos o menor desses dois valores, a partir de zero. O saldo e as
        recargas do vale-alimentação ficam fora.
      </p>

      <div className="reserve-main-grid">
        <section
          className="panel reserve-adjustments"
          aria-labelledby={`${labelId}-adjustments`}
        >
          <div className="reserve-section-heading">
            <SlidersHorizontal size={21} aria-hidden="true" />
            <div>
              <h2 id={`${labelId}-adjustments`}>Ajuste ao seu mês</h2>
              <p>Simule agora e salve os valores que quer usar neste mês.</p>
            </div>
          </div>
          <form onSubmit={save}>
            <MoneyInput
              id={`${labelId}-minimum`}
              label="Manter disponível na conta"
              help="Dinheiro que você prefere deixar livre para o dia a dia, além dos compromissos abaixo."
              value={fields.minimumBalanceCents}
              disabled={waiting}
              onChange={(value) => change("minimumBalanceCents", value)}
            />
            <MoneyInput
              id={`${labelId}-extra`}
              label="Outros gastos previstos"
              help="Inclua despesas deste mês que ainda não aparecem nos lançamentos, orçamentos ou recorrências."
              value={fields.extraExpenseCents}
              disabled={waiting}
              onChange={(value) => change("extraExpenseCents", value)}
            />
            <details
              className="reserve-advanced"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary>
                <span>Faturas, caixinhas e casal</span>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <p>Valores automáticos, com opção de ajuste.</p>
              <div className="reserve-advanced-fields">
                <AutomaticInput
                  id={`${labelId}-card`}
                  label="Faturas ainda a pagar"
                  automaticLabel="Usar estimativa automática para faturas"
                  help="A proteção automática considera compras no cartão e compromissos de fatura. Como não sabemos qual fatura foi quitada, informe o valor real que ainda vai pagar, se já souber."
                  automatic={fields.automatic.cardReserveCents}
                  value={fields.cardReserveCents}
                  automaticAmount={estimate.cardReserveCents}
                  disabled={waiting}
                  onAutomatic={(value) =>
                    toggleAutomatic(
                      "cardReserveCents",
                      value,
                      estimate.cardReserveCents,
                    )
                  }
                  onChange={(value) => change("cardReserveCents", value)}
                />
                <AutomaticInput
                  id={`${labelId}-goals`}
                  label="Caixinhas mantidas nestas contas"
                  automaticLabel="Usar estimativa automática para caixinhas"
                  help="A proteção automática usa suas metas pessoais e seus aportes líquidos nas conjuntas. Ajuste se o dinheiro já estiver fora destas contas, para não protegê-lo duas vezes."
                  automatic={fields.automatic.goalReserveCents}
                  value={fields.goalReserveCents}
                  automaticAmount={estimate.goalReserveCents}
                  disabled={waiting}
                  onAutomatic={(value) =>
                    toggleAutomatic(
                      "goalReserveCents",
                      value,
                      estimate.goalReserveCents,
                    )
                  }
                  onChange={(value) => change("goalReserveCents", value)}
                />
                <AutomaticInput
                  id={`${labelId}-shared`}
                  label="Minha parte nos compromissos do casal"
                  automaticLabel="Usar estimativa automática para compromissos do casal"
                  help="Até você informar sua parte, o cálculo protege o valor inteiro do planejamento conjunto. Não presumimos uma divisão entre vocês."
                  automatic={fields.automatic.sharedCommitmentCents}
                  value={fields.sharedCommitmentCents}
                  automaticAmount={estimate.appliedSharedCents}
                  disabled={waiting}
                  onAutomatic={(value) =>
                    toggleAutomatic(
                      "sharedCommitmentCents",
                      value,
                      estimate.appliedSharedCents,
                    )
                  }
                  onChange={(value) => change("sharedCommitmentCents", value)}
                />
              </div>
            </details>
            {invalid && (
              <p className="reserve-input-help">
                Use valores a partir de zero, com até duas casas decimais. Nos
                campos manuais, zero significa que não há valor a proteger.
              </p>
            )}
            {error && (
              <p className="reserve-error" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                {error}
              </p>
            )}
            {notice && (
              <p className="reserve-notice" role="status">
                <Check size={18} aria-hidden="true" />
                {notice}
              </p>
            )}
            <div className="reserve-form-actions">
              <button
                type="submit"
                className="button primary"
                disabled={waiting || !dirty || invalid}
              >
                {waiting ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : (
                  <Save size={17} aria-hidden="true" />
                )}
                Salvar ajustes
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={waiting || (!persisted && !dirty)}
                onClick={() => void reset()}
              >
                <RotateCcw size={17} aria-hidden="true" />
                Restaurar automático
              </button>
            </div>
            <p className="reserve-save-note">
              Os ajustes ficam salvos somente no seu espaço, para{" "}
              {monthLabel(month)}. Alterar a simulação não cria gastos nem
              aportes.
            </p>
          </form>
        </section>

        <div className="reserve-details-column">
          <section
            className="panel reserve-calculation"
            aria-labelledby={`${labelId}-calculation`}
          >
            <div className="reserve-section-heading">
              <Calculator size={21} aria-hidden="true" />
              <div>
                <h2 id={`${labelId}-calculation`}>Como calculamos</h2>
                <p>Dois limites para a mesma estimativa.</p>
              </div>
            </div>
            {invalid ? (
              <p className="reserve-input-help">
                Complete os ajustes para conferir as contas desta simulação.
              </p>
            ) : (
              <>
                <details className="reserve-math" open>
                  <summary>
                    Sobra do mês
                    <ChevronDown size={17} aria-hidden="true" />
                  </summary>
                  <dl>
                    <MoneyRow
                      label="Entradas recebidas em bancos"
                      value={estimate.incomeCents}
                    />
                    <MoneyRow
                      label="Despesas líquidas, incluindo cartão"
                      value={estimate.expenseCents}
                      deduction
                    />
                    <MoneyRow
                      label="Planejamento pessoal ainda previsto"
                      value={estimate.personalProvisionCents}
                      deduction
                    />
                    <MoneyRow
                      label="Compromissos do casal considerados"
                      value={estimate.appliedSharedCents}
                      deduction
                    />
                    <MoneyRow
                      label="Outros gastos previstos"
                      value={estimate.extraExpenseCents}
                      deduction
                    />
                    <MoneyRow
                      label="Seus aportes líquidos neste mês"
                      value={estimate.goalContributionsCents}
                      deduction
                    />
                    <MoneyRow
                      label="Sobra mensal estimada"
                      value={estimate.monthlyMarginCents}
                      total
                    />
                  </dl>
                </details>
                <details className="reserve-math">
                  <summary>
                    Caixa após proteções
                    <ChevronDown size={17} aria-hidden="true" />
                  </summary>
                  <dl>
                    <MoneyRow
                      label="Saldo das suas contas bancárias"
                      value={estimate.bankBalanceCents}
                    />
                    <MoneyRow
                      label="Planejamento pessoal ainda previsto"
                      value={estimate.personalProvisionCents}
                      deduction
                    />
                    <MoneyRow
                      label="Compromissos do casal considerados"
                      value={estimate.appliedSharedCents}
                      deduction
                    />
                    <MoneyRow
                      label="Outros gastos previstos"
                      value={estimate.extraExpenseCents}
                      deduction
                    />
                    <MoneyRow
                      label="Proteção para faturas"
                      value={estimate.cardReserveCents}
                      deduction
                    />
                    <MoneyRow
                      label="Proteção para caixinhas"
                      value={estimate.goalReserveCents}
                      deduction
                    />
                    <MoneyRow
                      label="Manter disponível na conta"
                      value={estimate.minimumBalanceCents}
                      deduction
                    />
                    <MoneyRow
                      label="Caixa após proteções"
                      value={estimate.cashCapacityCents}
                      total
                    />
                  </dl>
                </details>
              </>
            )}
            {estimate.pendingIncomeCents > 0 && (
              <p className="reserve-expected-income">
                <Info size={17} aria-hidden="true" />
                <span>
                  Há {formatMoney(estimate.pendingIncomeCents)} em entradas
                  previstas. Elas não financiam o valor sugerido enquanto não
                  estiverem registradas como recebidas.
                </span>
              </p>
            )}
            <p className="reserve-calculation-note">
              Orçamentos e recorrências da mesma categoria usam a maior provisão
              restante. Pagamento de fatura não é contado novamente como
              despesa.
            </p>
          </section>

          {estimate.issues.length > 0 && (
            <section className="panel reserve-assumptions">
              <details open={hasBlocking}>
                <summary>
                  <span>
                    <CircleAlert size={19} aria-hidden="true" />
                    Dados e premissas da estimativa
                    <span className="reserve-count">
                      {estimate.issues.length}
                    </span>
                  </span>
                  <ChevronDown size={17} aria-hidden="true" />
                </summary>
                <div className="reserve-issues">
                  {estimate.issues.map((issue) => (
                    <article
                      key={issue.code}
                      className={`reserve-issue reserve-issue-${issue.severity}`}
                    >
                      <strong>{issue.title}</strong>
                      <p>{issue.detail}</p>
                    </article>
                  ))}
                </div>
                <div className="reserve-data-actions">
                  <button onClick={() => onNavigate("imports")}>
                    Atualizar extratos
                  </button>
                  <button onClick={() => onNavigate("sources")}>
                    Conferir saldos
                  </button>
                  <button onClick={() => onNavigate("transactions")}>
                    Conferir lançamentos
                  </button>
                </div>
              </details>
            </section>
          )}

          <Installments estimate={estimate} onNavigate={onNavigate} />
        </div>
      </div>
      <div className="reserve-footer">
        <p>
          Separar dinheiro para uma reserva ou para investir começa com um
          orçamento que comporte esse valor. A estimativa pode mudar conforme
          novos dados entram.
        </p>
        <a
          href="https://www.bcb.gov.br/cidadaniafinanceira/lidando-imprevistos"
          target="_blank"
          rel="noreferrer"
        >
          Sobre orçamento e reservas · Banco Central
        </a>
      </div>
    </div>
  );
}

function MoneyInput({
  id,
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="reserve-input">
      <label htmlFor={id}>{label}</label>
      <div className="reserve-money-input">
        <span aria-hidden="true">R$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-describedby={`${id}-help`}
          required
        />
      </div>
      <p id={`${id}-help`}>{help}</p>
    </div>
  );
}
function AutomaticInput({
  id,
  label,
  automaticLabel,
  help,
  automatic,
  automaticAmount,
  value,
  disabled,
  onAutomatic,
  onChange,
}: {
  id: string;
  label: string;
  automaticLabel: string;
  help: string;
  automatic: boolean;
  automaticAmount: number;
  value: string;
  disabled: boolean;
  onAutomatic: (value: boolean) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="reserve-input reserve-automatic-input">
      <label htmlFor={id}>{label}</label>
      <div className="reserve-money-input">
        <span aria-hidden="true">R$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={automatic ? decimal(automaticAmount) : value}
          disabled={disabled || automatic}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-help`}
          required={!automatic}
        />
      </div>
      <label className="reserve-automatic-toggle">
        <input
          type="checkbox"
          checked={automatic}
          disabled={disabled}
          onChange={(event) => onAutomatic(event.target.checked)}
          aria-label={automaticLabel}
        />
        Usar estimativa automática
      </label>
      <p id={`${id}-help`}>{help}</p>
    </div>
  );
}
function MoneyRow({
  label,
  value,
  deduction = false,
  total = false,
}: {
  label: string;
  value: number;
  deduction?: boolean;
  total?: boolean;
}) {
  return (
    <div className={total ? "reserve-math-total" : ""}>
      <dt>{label}</dt>
      <dd>{formatMoney(deduction ? -value : value)}</dd>
    </div>
  );
}
function Installments({
  estimate,
  onNavigate,
}: {
  estimate: ReserveEstimate;
  onNavigate: (tab: Destination) => void;
}) {
  const max = Math.max(
    1,
    ...estimate.nextInstallments.map((item) => item.amountCents),
  );
  return (
    <section
      className="panel reserve-installments"
      aria-label="Parcelas dos próximos meses"
    >
      <div className="reserve-section-heading">
        <CalendarDays size={21} aria-hidden="true" />
        <div>
          <h2>Parcelas pela frente</h2>
          <p>Uma referência para os próximos meses.</p>
        </div>
      </div>
      {estimate.nextInstallments.some((item) => item.amountCents > 0) ? (
        <ol>
          {estimate.nextInstallments.map((item) => (
            <li key={item.month}>
              <div>
                <span>{monthLabel(item.month, true)}</span>
                <strong>{formatMoney(item.amountCents)}</strong>
              </div>
              <div className="reserve-installment-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(0, (item.amountCents / max) * 100)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="reserve-installments-empty">
          Nenhuma parcela futura foi identificada nos lançamentos disponíveis.
        </p>
      )}
      <p className="reserve-installment-note">
        Essa previsão usa as parcelas identificadas e não é descontada novamente
        da estimativa do mês.
      </p>
      <button
        className="reserve-inline-button"
        onClick={() => onNavigate("calendar")}
      >
        Abrir calendário
      </button>
    </section>
  );
}
