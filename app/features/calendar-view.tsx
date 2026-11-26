"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CreditCard,
  Link2,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  ShoppingBag,
  SkipForward,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { AppState, Transaction } from "../../lib/types";
import { CATEGORIES } from "../../lib/types";
import type {
  PlanScope,
  RecurringSchedule,
  ScheduleInput,
} from "../../lib/planning-types";
import { buildCalendar, calendarSummary, todayISO } from "../../lib/planning";
import { formatMoney, monthLabel } from "../../lib/finance";
import { FeatureDialog } from "./feature-dialog";
import "./calendar.css";

type OccurrenceAction = "confirm" | "skip" | "reset" | "link";
type CalendarEntry = ReturnType<typeof buildCalendar>[number];
interface Props {
  data: AppState;
  month: string;
  busy: boolean;
  onSave: (input: ScheduleInput, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOccurrence: (
    scheduleId: string,
    dueDate: string,
    action: OccurrenceAction,
    transactionId?: string,
  ) => Promise<void>;
  onOpenCouple: () => void;
}
const frequencyLabels = {
  weekly: "Semanal",
  monthly: "Mensal",
  yearly: "Anual",
};
const kindLabels = {
  expense: "Despesa",
  income: "Recebimento",
  card_payment: "Pagamento de fatura",
};
const statusLabels = {
  planned: "Previsto",
  confirmed: "Confirmado",
  linked: "Vinculado ao extrato",
  skipped: "Ignorado",
};
function displayDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
function scheduleInput(schedule: RecurringSchedule): ScheduleInput {
  const {
    scope,
    name,
    kind,
    category,
    amountCents,
    frequency,
    startDate,
    endDate,
    active,
  } = schedule;
  return {
    scope,
    name,
    kind,
    category,
    amountCents,
    frequency,
    startDate,
    endDate,
    active,
  };
}

export function CalendarView({
  data,
  month,
  busy,
  onSave,
  onDelete,
  onOccurrence,
  onOpenCouple,
}: Props) {
  const [scope, setScope] = useState<PlanScope>("personal");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editor, setEditor] = useState<RecurringSchedule | null | false>(false);
  const [detail, setDetail] = useState<CalendarEntry | null>(null);
  const [remove, setRemove] = useState<RecurringSchedule | null>(null);
  const [error, setError] = useState("");
  const [showPaused, setShowPaused] = useState(false);
  useEffect(() => {
    setSelectedDate(null);
    setError("");
  }, [month, scope]);
  const today = todayISO();
  const scopedSchedules = (data.schedules ?? []).filter(
    (item) => item.scope === scope,
  );
  const visibleTransactions = [
    ...data.transactions,
    ...data.partnerTransactions,
  ];
  const entries = useMemo(
    () =>
      buildCalendar(
        scopedSchedules,
        data.occurrences ?? [],
        month,
        visibleTransactions,
      ),
    [
      data.schedules,
      data.occurrences,
      data.transactions,
      data.partnerTransactions,
      month,
      scope,
    ],
  );
  const totals = calendarSummary(entries);
  const dayEntries = selectedDate
    ? entries.filter((entry) => entry.dueDate === selectedDate)
    : entries;
  const dueToReview = entries.filter(
    (entry) => entry.state === "planned" && entry.dueDate <= today,
  ).length;
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset =
    (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const calendarCells = Array.from(
    { length: Math.ceil((days + offset) / 7) * 7 },
    (_, index) => index - offset + 1,
  );
  const handle = (operation: () => Promise<void>) => {
    setError("");
    return operation().catch((err) => {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a operação.",
      );
    });
  };

  return (
    <div className="calendar-feature">
      <div className="feature-section-toolbar">
        <div
          className="scope-tabs"
          role="group"
          aria-label="Visão do calendário"
        >
          <button
            className={scope === "personal" ? "selected" : ""}
            onClick={() => setScope("personal")}
          >
            Pessoal
          </button>
          <button
            className={scope === "couple" ? "selected" : ""}
            onClick={() => setScope("couple")}
          >
            <UsersRound size={15} /> Casal
          </button>
        </div>
        <button
          className="button primary"
          onClick={() => setEditor(null)}
          disabled={scope === "couple" && !data.couple}
        >
          <Plus size={17} /> Nova recorrência
        </button>
      </div>
      {scope === "couple" && !data.couple ? (
        <section className="panel calendar-empty">
          <UsersRound size={34} />
          <h2>Um calendário para os dois.</h2>
          <p>
            Conecte o casal para planejar as contas compartilhadas. Seus
            compromissos pessoais continuam privados.
          </p>
          <button className="button primary" onClick={onOpenCouple}>
            Abrir nosso espaço
          </button>
        </section>
      ) : (
        <>
          <p className="calendar-intro">
            Planeje vencimentos e recebimentos. As confirmações do calendário
            não alteram o saldo nem criam novos gastos nos seus extratos.
          </p>
          <div className="calendar-metrics">
            <CalendarMetric
              label="Despesas previstas"
              amount={totals.expenseCents}
              icon={<ShoppingBag size={18} />}
            />
            <CalendarMetric
              label="Entradas previstas"
              amount={totals.incomeCents}
              icon={<Banknote size={18} />}
            />
            <CalendarMetric
              label="Faturas previstas"
              amount={totals.cardPaymentCents}
              icon={<CreditCard size={18} />}
            />
            <div className="panel calendar-metric">
              <span>
                <CircleAlert size={18} /> A conferir até hoje
              </span>
              <strong>{dueToReview}</strong>
              <small>
                {dueToReview === 1
                  ? "compromisso sem confirmação"
                  : "compromissos sem confirmação"}
              </small>
            </div>
          </div>
          {error && (
            <p className="feature-error" role="alert">
              {error}
            </p>
          )}
          <div className="calendar-layout">
            <section className="panel calendar-month">
              <div className="calendar-panel-title">
                <div>
                  <h2>{monthLabel(month)}</h2>
                  <p>Clique em um dia para ver os compromissos.</p>
                </div>
                <CalendarDays size={21} />
              </div>
              <div className="calendar-weekdays" aria-hidden="true">
                {["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"].map(
                  (day) => (
                    <span key={day}>{day}</span>
                  ),
                )}
              </div>
              <div
                className="calendar-grid"
                role="group"
                aria-label={`Calendário de ${monthLabel(month)}`}
              >
                {calendarCells.map((day, index) => {
                  if (day < 1 || day > days)
                    return (
                      <span
                        className="calendar-blank"
                        aria-hidden="true"
                        key={`blank-${index}`}
                      />
                    );
                  const date = `${month}-${String(day).padStart(2, "0")}`;
                  const scheduled = entries.filter(
                    (entry) =>
                      entry.dueDate === date && entry.state !== "skipped",
                  );
                  return (
                    <button
                      key={date}
                      className={`calendar-day ${date === today ? "today" : ""} ${selectedDate === date ? "selected" : ""}`}
                      aria-label={`${displayDate(date)}, ${scheduled.length} compromissos`}
                      aria-pressed={selectedDate === date}
                      onClick={() =>
                        setSelectedDate(selectedDate === date ? null : date)
                      }
                    >
                      <span className="calendar-day-number">{day}</span>
                      <span className="calendar-day-events">
                        {scheduled.slice(0, 2).map((entry) => (
                          <span
                            key={entry.key}
                            className={`calendar-pill ${entry.schedule.kind}`}
                            title={`${entry.schedule.name}: ${formatMoney(entry.schedule.amountCents)}`}
                          >
                            {entry.schedule.name}
                          </span>
                        ))}
                        {scheduled.length > 2 && (
                          <small>+{scheduled.length - 2} compromissos</small>
                        )}
                      </span>
                      {scheduled.length > 0 && (
                        <span className="calendar-mobile-count">
                          {scheduled.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-legend">
                <span>
                  <i />
                  Despesa
                </span>
                <span>
                  <i className="income" />
                  Entrada
                </span>
                <span>
                  <i className="card_payment" />
                  Fatura
                </span>
              </div>
            </section>
            <section className="panel calendar-agenda">
              <div className="calendar-agenda-title">
                <div>
                  <h2>
                    {selectedDate ? displayDate(selectedDate) : "Agenda do mês"}
                  </h2>
                  <p>{dayEntries.length} compromissos encontrados</p>
                </div>
                {selectedDate && (
                  <button
                    className="text-button"
                    onClick={() => setSelectedDate(null)}
                  >
                    Ver mês
                  </button>
                )}
              </div>
              {dayEntries.length ? (
                <div className="calendar-entry-list">
                  {dayEntries.map((entry) => (
                    <button
                      key={entry.key}
                      className={`calendar-entry ${entry.state === "skipped" ? "skipped" : ""}`}
                      onClick={() => setDetail(entry)}
                    >
                      <span
                        className={`calendar-date-badge ${entry.schedule.kind}`}
                      >
                        <strong>{entry.dueDate.slice(-2)}</strong>
                        <small>
                          {new Intl.DateTimeFormat("pt-BR", {
                            weekday: "short",
                            timeZone: "UTC",
                          })
                            .format(new Date(`${entry.dueDate}T12:00:00Z`))
                            .replace(".", "")}
                        </small>
                      </span>
                      <span className="calendar-entry-content">
                        <strong>{entry.schedule.name}</strong>
                        <span>
                          {entry.state === "planned" && entry.dueDate < today
                            ? "Vencimento passou · a conferir"
                            : statusLabels[entry.state]}
                        </span>
                      </span>
                      <span
                        className={`calendar-entry-amount ${entry.schedule.kind === "income" ? "positive" : ""}`}
                      >
                        {entry.schedule.kind === "income" ? "+ " : ""}
                        {formatMoney(entry.schedule.amountCents)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="calendar-empty-inline">
                  <CalendarDays size={29} />
                  <p>
                    {selectedDate
                      ? "Nenhum compromisso neste dia."
                      : "Adicione sua primeira conta ou receita recorrente."}
                  </p>
                </div>
              )}
            </section>
          </div>
          <section className="panel calendar-schedules">
            <div className="calendar-schedules-heading">
              <div>
                <h2>Recorrências cadastradas</h2>
                <p>
                  Cadastre uma vez. Cada vencimento aparece no seu calendário.
                </p>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={showPaused}
                  onChange={(e) => setShowPaused(e.target.checked)}
                />{" "}
                Mostrar pausadas
              </label>
            </div>
            <div className="calendar-schedule-list">
              {scopedSchedules
                .filter((schedule) => showPaused || schedule.active)
                .map((schedule) => (
                  <div
                    key={schedule.id}
                    className={`calendar-schedule-row ${!schedule.active ? "paused" : ""}`}
                  >
                    <span className="tx-icon">
                      {schedule.kind === "income" ? (
                        <Banknote size={19} />
                      ) : schedule.kind === "card_payment" ? (
                        <CreditCard size={19} />
                      ) : (
                        <CalendarDays size={19} />
                      )}
                    </span>
                    <div>
                      <strong>{schedule.name}</strong>
                      <span>
                        {frequencyLabels[schedule.frequency]} ·{" "}
                        {schedule.category} ·{" "}
                        {schedule.active ? "Ativa" : "Pausada"}
                      </span>
                    </div>
                    <strong>{formatMoney(schedule.amountCents)}</strong>
                    <div className="calendar-schedule-actions">
                      <button
                        className="icon-button"
                        aria-label={`Editar recorrência ${schedule.name}`}
                        disabled={busy || !schedule.canEdit}
                        onClick={() => setEditor(schedule)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`${schedule.active ? "Pausar" : "Retomar"} ${schedule.name}`}
                        disabled={busy || !schedule.canEdit}
                        onClick={() =>
                          void handle(() =>
                            onSave(
                              {
                                ...scheduleInput(schedule),
                                active: !schedule.active,
                              },
                              schedule.id,
                            ),
                          )
                        }
                      >
                        {schedule.active ? (
                          <Pause size={16} />
                        ) : (
                          <Play size={16} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remover recorrência ${schedule.name}`}
                        disabled={busy || !schedule.canEdit}
                        onClick={() => setRemove(schedule)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              {!scopedSchedules.filter(
                (schedule) => showPaused || schedule.active,
              ).length && (
                <p className="calendar-no-schedules">
                  Nenhuma recorrência {showPaused ? "cadastrada" : "ativa"}{" "}
                  nesta visão.
                </p>
              )}
            </div>
          </section>
          <p className="calendar-factual-note">
            A passagem do vencimento não confirma que uma conta está em atraso.
            Vincule o lançamento importado ou informe o pagamento. Faturas
            aparecem separadas das demais despesas para manter o planejamento
            claro.
          </p>
        </>
      )}
      {editor !== false && (
        <FeatureDialog
          title={editor ? "Editar recorrência" : "Nova recorrência"}
          onClose={() => !busy && setEditor(false)}
        >
          <ScheduleForm
            initial={editor}
            defaultScope={scope}
            month={month}
            hasCouple={!!data.couple}
            busy={busy}
            onCancel={() => setEditor(false)}
            onSave={async (input) => {
              await onSave(input, editor ? editor.id : undefined);
              setEditor(false);
            }}
          />
        </FeatureDialog>
      )}
      {detail && (
        <FeatureDialog
          title={detail.schedule.name}
          onClose={() => !busy && setDetail(null)}
        >
          <OccurrenceDetails
            entry={detail}
            data={data}
            busy={busy}
            onAction={async (action, id) => {
              await onOccurrence(
                detail.schedule.id,
                detail.dueDate,
                action,
                id,
              );
              setDetail(null);
            }}
          />
        </FeatureDialog>
      )}
      {remove && (
        <FeatureDialog
          title="Remover esta recorrência?"
          onClose={() => !busy && setRemove(null)}
        >
          <p className="modal-intro">
            A previsão de <strong>{remove.name}</strong> e suas confirmações
            sairão do calendário. Os lançamentos importados permanecem no
            histórico.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Manter recorrência
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void handle(async () => {
                  await onDelete(remove.id);
                  setRemove(null);
                })
              }
            >
              <Trash2 size={16} /> Remover recorrência
            </button>
          </div>
        </FeatureDialog>
      )}
    </div>
  );
}

function CalendarMetric({
  label,
  amount,
  icon,
}: {
  label: string;
  amount: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="panel calendar-metric">
      <span>
        {icon}
        {label}
      </span>
      <strong>{formatMoney(amount)}</strong>
      <small>Valores planejados para o mês</small>
    </div>
  );
}

function ScheduleForm({
  initial,
  defaultScope,
  month,
  hasCouple,
  busy,
  onSave,
  onCancel,
}: {
  initial: RecurringSchedule | null;
  defaultScope: PlanScope;
  month: string;
  hasCouple: boolean;
  busy: boolean;
  onSave: (input: ScheduleInput) => Promise<void>;
  onCancel: () => void;
}) {
  const today = todayISO();
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState<PlanScope>(initial?.scope ?? defaultScope);
  const [kind, setKind] = useState<ScheduleInput["kind"]>(
    initial?.kind ?? "expense",
  );
  const [category, setCategory] = useState(initial?.category ?? "Moradia");
  const [amount, setAmount] = useState(
    initial ? String(initial.amountCents / 100).replace(".", ",") : "",
  );
  const [frequency, setFrequency] = useState<ScheduleInput["frequency"]>(
    initial?.frequency ?? "monthly",
  );
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? (today.startsWith(month) ? today : `${month}-01`),
  );
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        let value = amount.trim().replace(/R\$\s*/g, "");
        if (value.includes(","))
          value = value.replace(/\./g, "").replace(",", ".");
        const cents = Math.round(Number(value) * 100);
        if (!Number.isSafeInteger(cents) || cents <= 0) {
          setError("Informe um valor planejado maior que zero.");
          return;
        }
        if (endDate && endDate < startDate) {
          setError(
            "A data final deve ser igual ou posterior ao primeiro vencimento.",
          );
          return;
        }
        void onSave({
          name: name.trim(),
          scope,
          kind,
          category: kind === "card_payment" ? "Fatura" : category.trim(),
          amountCents: cents,
          frequency,
          startDate,
          endDate: endDate || null,
          active: initial?.active ?? true,
        }).catch((err) =>
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível salvar a recorrência.",
          ),
        );
      }}
    >
      <p className="modal-intro">
        Cadastre o valor previsto. A realização será conferida com seus extratos
        ou confirmada por você.
      </p>
      <label className="field-label" htmlFor="schedule-name">
        Nome do compromisso
      </label>
      <input
        id="schedule-name"
        placeholder="Ex.: Aluguel, salário ou internet"
        maxLength={100}
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="schedule-scope">
            Visibilidade
          </label>
          <div className="select-wrap">
            <select
              id="schedule-scope"
              value={scope}
              disabled={!!initial}
              onChange={(event) => setScope(event.target.value as PlanScope)}
            >
              <option value="personal">Pessoal</option>
              <option value="couple" disabled={!hasCouple}>
                Casal
              </option>
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="schedule-kind">
            Tipo de compromisso
          </label>
          <div className="select-wrap">
            <select
              id="schedule-kind"
              value={kind}
              onChange={(event) => {
                const value = event.target.value as ScheduleInput["kind"];
                setKind(value);
                if (value === "income") setCategory("Salário");
                if (value === "card_payment") setCategory("Fatura");
              }}
            >
              {Object.entries(kindLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
      </div>
      {scope === "couple" && (
        <p className="field-help">
          O nome, o valor e as confirmações deste compromisso serão visíveis
          para os dois.
        </p>
      )}
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="schedule-amount">
            Valor previsto (R$)
          </label>
          <input
            id="schedule-amount"
            inputMode="decimal"
            placeholder="Ex.: 150,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="schedule-frequency">
            Repetição
          </label>
          <div className="select-wrap">
            <select
              id="schedule-frequency"
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as ScheduleInput["frequency"])
              }
            >
              {Object.entries(frequencyLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
      </div>
      <label className="field-label" htmlFor="schedule-category">
        Categoria
      </label>
      <input
        id="schedule-category"
        list="schedule-categories"
        value={kind === "card_payment" ? "Fatura" : category}
        disabled={kind === "card_payment"}
        onChange={(event) => setCategory(event.target.value)}
        required
        maxLength={100}
      />
      <datalist id="schedule-categories">
        {CATEGORIES.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </datalist>
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="schedule-start">
            Primeiro vencimento
          </label>
          <input
            id="schedule-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="schedule-end">
            Repetir até
          </label>
          <input
            id="schedule-end"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
      </div>
      <p className="field-help">
        Sem data final, a recorrência continua até ser pausada. Nos meses mais
        curtos, usamos o último dia disponível.
      </p>
      {error && (
        <p className="feature-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button secondary"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </button>
        <button
          className="button primary"
          disabled={busy || !name.trim() || !category.trim()}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Check size={17} />
          )}{" "}
          Salvar recorrência
        </button>
      </div>
    </form>
  );
}

function OccurrenceDetails({
  entry,
  data,
  busy,
  onAction,
}: {
  entry: CalendarEntry;
  data: AppState;
  busy: boolean;
  onAction: (action: OccurrenceAction, transactionId?: string) => Promise<void>;
}) {
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState("");
  const transactions: Transaction[] =
    entry.schedule.scope === "couple"
      ? [
          ...data.transactions.filter((tx) => tx.shared),
          ...data.partnerTransactions.filter((tx) => tx.shared),
        ]
      : data.transactions.filter((tx) => !tx.shared);
  const month = entry.dueDate.slice(0, 7);
  const candidates = transactions
    .filter(
      (tx) =>
        tx.kind === entry.schedule.kind &&
        Math.abs(
          new Date(`${tx.date}T12:00:00Z`).getTime() -
            new Date(`${entry.dueDate}T12:00:00Z`).getTime(),
        ) <=
          45 * 86400000 &&
        !data.occurrences?.some(
          (occurrence) =>
            occurrence.transactionId === tx.id &&
            (occurrence.scheduleId !== entry.schedule.id ||
              occurrence.dueDate !== entry.dueDate),
        ),
    )
    .sort(
      (a, b) =>
        Number(a.date.slice(0, 7) !== month) -
          Number(b.date.slice(0, 7) !== month) ||
        Math.abs(a.amountCents - entry.schedule.amountCents) -
          Math.abs(b.amountCents - entry.schedule.amountCents),
    );
  const linked = transactions.find((tx) => tx.id === entry.transactionId);
  const act = (action: OccurrenceAction, id?: string) => {
    setError("");
    void onAction(action, id).catch((err) =>
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar este compromisso.",
      ),
    );
  };
  return (
    <div className="calendar-occurrence-detail">
      <div className="calendar-detail-summary">
        <span>{displayDate(entry.dueDate)}</span>
        <strong>{formatMoney(entry.schedule.amountCents)}</strong>
        <span className={`calendar-status ${entry.state}`}>
          {statusLabels[entry.state]}
        </span>
      </div>
      <p className="modal-intro">
        {entry.schedule.category} · {frequencyLabels[entry.schedule.frequency]}{" "}
        ·{" "}
        {entry.schedule.scope === "couple"
          ? "Compartilhado com o casal"
          : "Pessoal"}
      </p>
      {linked && (
        <div className="notice">
          <Link2 size={19} />
          <p>
            Vinculado a <strong>{linked.description}</strong>, de{" "}
            {displayDate(linked.date)}, no valor de{" "}
            {formatMoney(linked.amountCents)}.
          </p>
        </div>
      )}
      {entry.state !== "skipped" && entry.state !== "linked" && (
        <>
          <h3>Conferir com o extrato</h3>
          <p className="field-help">
            Escolha o movimento já importado que corresponde a este compromisso.
          </p>
          <label className="field-label" htmlFor="occurrence-transaction">
            Lançamento importado
          </label>
          <div className="select-wrap">
            <select
              id="occurrence-transaction"
              value={transactionId}
              onChange={(event) => setTransactionId(event.target.value)}
            >
              <option value="">
                {candidates.length
                  ? "Selecione um lançamento"
                  : "Nenhum lançamento compatível disponível"}
              </option>
              {candidates.map((tx) => (
                <option value={tx.id} key={tx.id}>
                  {displayDate(tx.date)} · {tx.description} ·{" "}
                  {formatMoney(tx.amountCents)}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <button
            className="button primary wide"
            disabled={busy || !transactionId}
            onClick={() => act("link", transactionId)}
          >
            <Link2 size={17} /> Vincular ao extrato
          </button>
        </>
      )}
      {entry.state === "planned" && (
        <>
          <div className="calendar-action-divider">
            <span>ou confirme por aqui</span>
          </div>
          <button
            className="button secondary wide"
            disabled={busy}
            onClick={() => act("confirm")}
          >
            <CircleCheck size={17} />
            {entry.schedule.kind === "income"
              ? "Marcar como recebido"
              : "Marcar como pago"}
          </button>
          <p className="field-help">
            A confirmação atualiza o calendário. O saldo e os valores realizados
            continuam vindo dos arquivos importados.
          </p>
          <button
            className="text-button calendar-skip"
            disabled={busy}
            onClick={() => act("skip")}
          >
            <SkipForward size={15} /> Ignorar este vencimento
          </button>
        </>
      )}
      {entry.state !== "planned" && (
        <button
          className="button secondary wide calendar-reopen"
          disabled={busy}
          onClick={() => act("reset")}
        >
          <RotateCcw size={17} /> Reabrir este compromisso
        </button>
      )}
      {error && (
        <p className="feature-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
