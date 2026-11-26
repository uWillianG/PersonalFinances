"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Heart,
  LoaderCircle,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Store,
  Target,
  Trash2,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import {
  categoryComparison,
  merchantReport,
  selectReportTransactions,
} from "../../lib/analytics";
import { formatMoney, monthLabel } from "../../lib/finance";
import { budgetProgress, categoryKey } from "../../lib/planning";
import type {
  BudgetInput,
  BudgetLimit,
  PlanScope,
  ReportScope,
} from "../../lib/planning-types";
import { CATEGORIES, type AppState, type Transaction } from "../../lib/types";
import "./reports-budgets.css";

type SharedViewProps = {
  data: AppState;
  month: string;
  onOpenCouple?: () => void;
};
type MerchantSort = "spent" | "visits" | "average" | "name";
type MerchantRow = ReturnType<typeof merchantReport>[number];

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
function dateLabel(date: string) {
  return dateFormatter
    .format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
    .replace(".", "");
}
function previousMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
function Change({
  value,
  previous,
}: {
  value: number | null;
  previous?: number;
}) {
  if (value === null)
    return (
      <span className="rb-change neutral">
        {previous === 0 ? "Sem gasto anterior" : "Sem base anterior"}
      </span>
    );
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`rb-change ${value > 0 ? "up" : value < 0 ? "down" : "neutral"}`}
    >
      {value !== 0 && <Icon size={14} aria-hidden="true" />}
      {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
        Math.abs(value),
      )}
      %{value > 0 ? " a mais" : value < 0 ? " a menos" : " · igual"}
    </span>
  );
}
function Metric({
  label,
  value,
  note,
  icon,
  accent = false,
  warning = false,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  icon: ReactNode;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <article
      className={`rb-metric${accent ? " rb-metric-accent" : ""}${warning ? " rb-metric-warning" : ""}`}
    >
      <div className="rb-metric-label">
        <span>{label}</span>
        <span className="rb-metric-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong className="rb-metric-value">{value}</strong>
      <div className="rb-metric-note">{note}</div>
    </article>
  );
}
function CoupleEmpty({ onOpenCouple }: { onOpenCouple?: () => void }) {
  return (
    <section className="rb-panel rb-empty rb-couple-empty">
      <span className="rb-empty-icon">
        <UsersRound size={28} aria-hidden="true" />
      </span>
      <h2>Planejem a vida a dois</h2>
      <p>
        Conecte seu parceiro ou parceira para acompanhar os gastos
        compartilhados e os limites do casal.
      </p>
      {onOpenCouple && (
        <button className="rb-button rb-primary" onClick={onOpenCouple}>
          <Heart size={17} aria-hidden="true" />
          Abrir nosso espaço
        </button>
      )}
      <span className="rb-privacy">
        <ShieldCheck size={15} aria-hidden="true" />
        Os lançamentos pessoais continuam privados.
      </span>
    </section>
  );
}
function ImportNote({
  transactions,
  month,
}: {
  transactions: Transaction[];
  month: string;
}) {
  const latestDate = transactions
    .filter((item) => item.date.startsWith(month))
    .reduce((latest, item) => (item.date > latest ? item.date : latest), "");
  return (
    <div className="rb-data-note">
      <ReceiptText size={16} aria-hidden="true" />
      <p>
        {latestDate ? (
          <>
            Lançamentos disponíveis até <strong>{dateLabel(latestDate)}</strong>
            .{" "}
          </>
        ) : null}
        Os valores refletem os dados importados e cadastrados. Importe novos
        extratos para atualizar o mês.
      </p>
    </div>
  );
}

export function ReportsView({ data, month, onOpenCouple }: SharedViewProps) {
  const [scope, setScope] = useState<ReportScope>("mine");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<MerchantSort>("spent");
  const [detail, setDetail] = useState<{
    key: string;
    month: string;
    scope: ReportScope;
  } | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const transactions = useMemo(
    () =>
      selectReportTransactions(
        data.transactions,
        data.partnerTransactions,
        scope,
      ),
    [data.transactions, data.partnerTransactions, scope],
  );
  const rows = useMemo(
    () => merchantReport(transactions, month, { search, category, sort }),
    [transactions, month, search, category, sort],
  );
  const categoryRows = useMemo(
    () =>
      categoryComparison(transactions, month).filter(
        (item) =>
          !category || categoryKey(item.category) === categoryKey(category),
      ),
    [transactions, month, category],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(
          transactions
            .filter((item) => item.kind === "expense" || item.kind === "refund")
            .map((item) => item.category || "Outros"),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [transactions],
  );
  const netCents = rows.reduce((sum, row) => sum + row.netCents, 0);
  const previousCents = useMemo(
    () =>
      merchantReport(transactions, previousMonth(month), {
        search,
        category,
      }).reduce((sum, row) => sum + row.netCents, 0),
    [transactions, month, search, category],
  );
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const refundCents = rows.reduce((sum, row) => sum + row.refundCents, 0);
  const netChange =
    previousCents !== 0
      ? ((netCents - previousCents) / Math.abs(previousCents)) * 100
      : null;
  const selected =
    detail?.month === month && detail.scope === scope
      ? rows.find((row) => row.key === detail.key)
      : undefined;
  const largestCategory = Math.max(
    1,
    ...categoryRows.flatMap((row) => [
      Math.max(0, row.currentCents),
      Math.max(0, row.previousCents),
    ]),
  );
  const inputId = useId();
  const openMerchant = (row: MerchantRow) => {
    setDetail({ key: row.key, month, scope });
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      detailRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="rb-view rb-reports">
      <div className="rb-view-toolbar">
        <div
          className="rb-segments"
          role="group"
          aria-label="Visão do relatório"
        >
          {(
            [
              ["mine", "Meus gastos"],
              ["personal", "Só pessoais"],
              ["couple", "Casal"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
                setDetail(null);
              }}
            >
              {value === "couple" && (
                <UsersRound size={16} aria-hidden="true" />
              )}
              {label}
            </button>
          ))}
        </div>
        <span className="rb-toolbar-note">
          {scope === "mine"
            ? "Seus gastos pessoais e compartilhados"
            : scope === "personal"
              ? "Apenas seus gastos pessoais"
              : "Gastos compartilhados dos dois"}
        </span>
      </div>
      {scope === "couple" && !data.couple ? (
        <CoupleEmpty onOpenCouple={onOpenCouple} />
      ) : (
        <>
          <div className="rb-metrics">
            <Metric
              label="Gasto líquido"
              value={formatMoney(netCents)}
              note={
                <>
                  <Change value={netChange} previous={previousCents} />
                  <span>vs. mês anterior</span>
                </>
              }
              icon={<Wallet size={19} />}
              accent
            />
            <Metric
              label="Compras no mês"
              value={count.toLocaleString("pt-BR")}
              note="Frequência de compras nos estabelecimentos"
              icon={<ReceiptText size={19} />}
            />
            <Metric
              label="Ticket médio"
              value={formatMoney(count ? Math.round(netCents / count) : 0)}
              note="Gasto líquido por compra"
              icon={<ChartNoAxesCombined size={19} />}
            />
            <Metric
              label="Estabelecimentos"
              value={rows.length.toLocaleString("pt-BR")}
              note={
                refundCents
                  ? `${formatMoney(refundCents)} em estornos considerados`
                  : "Onde seu dinheiro circulou neste mês"
              }
              icon={<Store size={19} />}
            />
          </div>
          <section
            className="rb-panel"
            aria-labelledby={`${inputId}-merchants`}
          >
            <div className="rb-panel-heading">
              <div>
                <h2 id={`${inputId}-merchants`}>Por estabelecimento</h2>
                <p>Descubra onde você gasta mais e com que frequência.</p>
              </div>
              <span className="rb-count">
                {rows.length} {rows.length === 1 ? "local" : "locais"}
              </span>
            </div>
            <div className="rb-filters">
              <label className="rb-search">
                <Search size={18} aria-hidden="true" />
                <span className="rb-sr-only">Buscar estabelecimento</span>
                <input
                  placeholder="Buscar estabelecimento"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setDetail(null);
                  }}
                />
              </label>
              <label className="rb-select">
                <span className="rb-sr-only">Filtrar categoria</span>
                <select
                  aria-label="Filtrar categoria"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setDetail(null);
                  }}
                >
                  <option value="">Todas as categorias</option>
                  {categories.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </label>
              <label className="rb-select">
                <span className="rb-sr-only">Ordenar estabelecimentos</span>
                <select
                  aria-label="Ordenar estabelecimentos"
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as MerchantSort)
                  }
                >
                  <option value="spent">Maior gasto</option>
                  <option value="visits">Mais compras</option>
                  <option value="average">Maior ticket médio</option>
                  <option value="name">Nome do estabelecimento</option>
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </label>
            </div>
            {selected && (
              <section
                ref={detailRef}
                tabIndex={-1}
                className="rb-merchant-detail"
                aria-label={`Lançamentos em ${selected.name}`}
              >
                <div className="rb-detail-heading">
                  <div>
                    <span className="rb-kicker">
                      DETALHES DO ESTABELECIMENTO
                    </span>
                    <h3>{selected.name}</h3>
                    <p>
                      {selected.count}{" "}
                      {selected.count === 1 ? "compra" : "compras"} em{" "}
                      {monthLabel(month)} · {formatMoney(selected.netCents)}{" "}
                      líquidos
                    </p>
                  </div>
                  <button
                    className="rb-icon-button"
                    onClick={() => setDetail(null)}
                    aria-label="Fechar detalhes"
                  >
                    <X size={19} />
                  </button>
                </div>
                <ul className="rb-detail-list">
                  {[...selected.transactions]
                    .sort(
                      (a, b) =>
                        b.date.localeCompare(a.date) ||
                        a.id.localeCompare(b.id),
                    )
                    .map((transaction) => (
                      <li key={transaction.id}>
                        <span className="rb-date">
                          {dateLabel(transaction.date)}
                        </span>
                        <span className="rb-detail-description">
                          <strong>{transaction.description}</strong>
                          <span>
                            {transaction.category || "Outros"}
                            {scope === "couple"
                              ? ` · ${transaction.ownerName}`
                              : ""}
                            {transaction.kind === "refund" ? " · Estorno" : ""}
                          </span>
                        </span>
                        <strong
                          className={
                            transaction.kind === "refund" ? "rb-refund" : ""
                          }
                        >
                          {transaction.kind === "refund" ? "− " : ""}
                          {formatMoney(transaction.amountCents)}
                        </strong>
                      </li>
                    ))}
                </ul>
                <p className="rb-detail-note">
                  Detalhes para consulta. Você pode editar os dados na tela de
                  lançamentos.
                </p>
              </section>
            )}
            {rows.length ? (
              <>
                <div className="rb-merchant-columns" aria-hidden="true">
                  <span>Estabelecimento</span>
                  <span>Compras</span>
                  <span>Ticket médio</span>
                  <span>Gasto líquido</span>
                  <span />
                </div>
                <ol className="rb-merchant-list">
                  {rows.map((row, index) => (
                    <li key={row.key}>
                      <button
                        className={`rb-merchant-row${selected?.key === row.key ? " selected" : ""}`}
                        onClick={() => openMerchant(row)}
                        aria-label={`Ver lançamentos de ${row.name}, ${formatMoney(row.netCents)}, ${row.count} compras`}
                        aria-expanded={selected?.key === row.key}
                      >
                        <span className="rb-merchant-name">
                          <span
                            className="rb-merchant-avatar"
                            aria-hidden="true"
                          >
                            {sort === "name" ? (
                              <Store size={18} />
                            ) : (
                              String(index + 1).padStart(2, "0")
                            )}
                          </span>
                          <span>
                            <strong>{row.name}</strong>
                            <span>
                              Último lançamento em {dateLabel(row.lastDate)}
                            </span>
                          </span>
                        </span>
                        <span className="rb-merchant-count">
                          <span className="rb-mobile-label">Compras</span>
                          <strong>{row.count}</strong>
                        </span>
                        <span className="rb-merchant-average">
                          <span className="rb-mobile-label">Ticket médio</span>
                          <strong>{formatMoney(row.averageCents)}</strong>
                        </span>
                        <span className="rb-merchant-total">
                          <strong>{formatMoney(row.netCents)}</strong>
                          <Change
                            value={row.changePercent}
                            previous={row.previousCents}
                          />
                        </span>
                        <ChevronRight
                          className="rb-row-chevron"
                          size={17}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="rb-empty">
                <span className="rb-empty-icon">
                  <Store size={26} aria-hidden="true" />
                </span>
                <h3>
                  {search || category
                    ? "Nenhum estabelecimento encontrado"
                    : "Seu mês ainda está em branco"}
                </h3>
                <p>
                  {search || category
                    ? "Ajuste a busca ou a categoria para encontrar outros gastos."
                    : "Importe um extrato ou cadastre uma despesa para começar a conhecer seus hábitos."}
                </p>
                {(search || category) && (
                  <button
                    className="rb-button rb-secondary"
                    onClick={() => {
                      setSearch("");
                      setCategory("");
                    }}
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            )}
            <div className="rb-panel-footer">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                Despesas menos estornos. Transferências e pagamentos de fatura
                não entram no cálculo.
              </span>
            </div>
          </section>
          <section
            className="rb-panel rb-category-panel"
            aria-labelledby={`${inputId}-categories`}
          >
            <div className="rb-panel-heading">
              <div>
                <h2 id={`${inputId}-categories`}>Como as categorias mudaram</h2>
                <p>
                  Compare {monthLabel(month)} com{" "}
                  {monthLabel(previousMonth(month))}.
                  {search
                    ? " A busca por estabelecimento não altera esta comparação."
                    : ""}
                </p>
              </div>
            </div>
            <div className="rb-comparison-legend">
              <span>
                <i />
                Mês selecionado
              </span>
              <span>
                <i />
                Mês anterior
              </span>
            </div>
            {categoryRows.length ? (
              <ul className="rb-category-list">
                {categoryRows.map((row) => (
                  <li key={row.category}>
                    <div className="rb-category-top">
                      <strong>{row.category}</strong>
                      <span>{formatMoney(row.currentCents)}</span>
                    </div>
                    <div className="rb-category-bars" aria-hidden="true">
                      <span
                        style={{
                          width: `${(Math.max(0, row.currentCents) / largestCategory) * 100}%`,
                        }}
                      />
                      <span
                        style={{
                          width: `${(Math.max(0, row.previousCents) / largestCategory) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="rb-category-bottom">
                      <span>Anterior: {formatMoney(row.previousCents)}</span>
                      <span>
                        <Change
                          value={row.changePercent}
                          previous={row.previousCents}
                        />
                        <span className="rb-category-difference">
                          {row.differenceCents > 0
                            ? "+"
                            : row.differenceCents < 0
                              ? "−"
                              : ""}
                          {formatMoney(Math.abs(row.differenceCents))}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rb-empty rb-empty-compact">
                <ChartNoAxesCombined size={25} aria-hidden="true" />
                <p>
                  A comparação aparece quando há despesas ou estornos neste mês
                  ou no anterior.
                </p>
              </div>
            )}
          </section>
          <ImportNote transactions={transactions} month={month} />
        </>
      )}
    </div>
  );
}

type BudgetsViewProps = SharedViewProps & {
  busy: boolean;
  onSave: (input: BudgetInput, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCopy: (
    scope: PlanScope,
    fromMonth: string,
    toMonth: string,
  ) => Promise<void>;
};
type EditorState = { month: string; scope: PlanScope; budget?: BudgetLimit };

function parseLimit(value: string) {
  const raw = value.trim().replace(/\s|R\$/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Informe o limite em reais, com até duas casas decimais.");
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Error("O limite deve ser um valor maior que zero.");
  return cents;
}

function BudgetEditor({
  state,
  categories,
  busy,
  onSave,
  onClose,
}: {
  state: EditorState;
  categories: string[];
  busy: boolean;
  onSave: BudgetsViewProps["onSave"];
  onClose: () => void;
}) {
  const [category, setCategory] = useState(state.budget?.category ?? "");
  const [limit, setLimit] = useState(
    state.budget
      ? (state.budget.limitCents / 100).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  const locked = busy || saving;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setError("");
    try {
      const trimmedCategory = category.trim();
      if (!trimmedCategory)
        throw new Error("Escolha ou escreva uma categoria.");
      const limitCents = parseLimit(limit);
      setSaving(true);
      await onSave(
        {
          category: trimmedCategory,
          limitCents,
          month: state.month,
          scope: state.scope,
        },
        state.budget?.id,
      );
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="rb-panel rb-budget-editor"
      aria-labelledby={`${formId}-heading`}
    >
      <div className="rb-panel-heading">
        <div>
          <span className="rb-kicker">
            {state.scope === "couple"
              ? "PLANEJAMENTO DO CASAL"
              : "SEU PLANEJAMENTO"}
          </span>
          <h2 id={`${formId}-heading`}>
            {state.budget
              ? "Editar limite"
              : "Um limite para gastar com tranquilidade"}
          </h2>
          <p>
            {monthLabel(state.month)} ·{" "}
            {state.scope === "couple"
              ? "Compartilhado com seu par"
              : "Apenas despesas pessoais"}
          </p>
        </div>
        <button
          className="rb-icon-button"
          aria-label="Fechar formulário"
          disabled={locked}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <form onSubmit={submit} className="rb-budget-form">
        <label htmlFor={`${formId}-category`}>
          <span>Categoria</span>
          <input
            aria-label="Categoria"
            id={`${formId}-category`}
            list={`${formId}-categories`}
            placeholder="Escolha ou escreva uma categoria"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={!!state.budget || locked}
            maxLength={80}
            required
            autoFocus={!state.budget}
          />
          {!state.budget && (
            <small>Você também pode criar uma categoria personalizada.</small>
          )}
        </label>
        <datalist id={`${formId}-categories`}>
          {categories.map((name) => (
            <option value={name} key={name} />
          ))}
        </datalist>
        <label htmlFor={`${formId}-limit`}>
          <span>Limite do mês (R$)</span>
          <input
            aria-label="Limite do mês (R$)"
            id={`${formId}-limit`}
            type="text"
            inputMode="decimal"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            placeholder="0,00"
            maxLength={18}
            required
            disabled={locked}
            aria-describedby={error ? `${formId}-error` : undefined}
            autoFocus={!!state.budget}
          />
          <small>Defina o valor total para esta categoria.</small>
        </label>
        {error && (
          <p id={`${formId}-error`} className="rb-form-error" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            {error}
          </p>
        )}
        <div className="rb-form-actions">
          <button
            type="button"
            className="rb-button rb-secondary"
            onClick={onClose}
            disabled={locked}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rb-button rb-primary"
            disabled={locked}
          >
            {saving ? (
              <LoaderCircle size={17} className="rb-spin" aria-hidden="true" />
            ) : (
              <Check size={17} aria-hidden="true" />
            )}
            {saving ? "Salvando…" : "Salvar limite"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function BudgetsView({
  data,
  month,
  busy,
  onSave,
  onDelete,
  onCopy,
  onOpenCouple,
}: BudgetsViewProps) {
  const [scope, setScope] = useState<PlanScope>("personal");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const budgets = useMemo(
    () =>
      (data.budgets ?? [])
        .filter((budget) => budget.month === month && budget.scope === scope)
        .sort((a, b) => a.category.localeCompare(b.category, "pt-BR")),
    [data.budgets, month, scope],
  );
  const progress = budgets.map((budget) => ({
    budget,
    ...budgetProgress(budget, data.transactions, data.partnerTransactions),
  }));
  const totalPlanned = budgets.reduce(
    (sum, budget) => sum + budget.limitCents,
    0,
  );
  const totalSpent = progress.reduce((sum, item) => sum + item.spentCents, 0);
  const totalRemaining = progress.reduce(
    (sum, item) => sum + Math.max(0, item.remainingCents),
    0,
  );
  const totalOver = progress.reduce((sum, item) => sum + item.overCents, 0);
  const priorMonth = previousMonth(month);
  const priorCategories = (data.budgets ?? []).filter(
    (budget) => budget.month === priorMonth && budget.scope === scope,
  );
  const missingPriorCategories = priorCategories.filter(
    (prior) =>
      !budgets.some(
        (budget) =>
          categoryKey(budget.category) === categoryKey(prior.category),
      ),
  );
  const categoryOptions = useMemo(
    () =>
      [
        ...new Set([
          ...CATEGORIES,
          ...data.transactions.map((item) => item.category),
          ...(data.budgets ?? []).map((item) => item.category),
        ]),
      ]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [data.transactions, data.budgets],
  );
  const transactions = selectReportTransactions(
    data.transactions,
    data.partnerTransactions,
    scope === "personal" ? "personal" : "couple",
  );
  const activeEditor =
    editor?.month === month && editor.scope === scope ? editor : null;
  const locked = busy || pending;
  const openEditor = (budget?: BudgetLimit) => {
    setEditor({ month, scope, budget });
    setActionError("");
    setActionMessage("");
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  async function copyPrevious() {
    if (locked) return;
    setPending(true);
    setActionError("");
    setActionMessage("");
    try {
      await onCopy(scope, priorMonth, month);
      setActionMessage(
        "Limites do mês anterior copiados. As categorias que já tinham limite foram mantidas.",
      );
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  async function removeBudget(budget: BudgetLimit) {
    if (locked || !budget.canEdit) return;
    setPending(true);
    setActionError("");
    setActionMessage("");
    try {
      await onDelete(budget.id);
      setDeleting(null);
      setActionMessage(`Limite de ${budget.category} removido.`);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rb-view rb-budgets">
      <div className="rb-view-toolbar">
        <div
          className="rb-segments"
          role="group"
          aria-label="Visão do orçamento"
        >
          {(
            [
              ["personal", "Pessoal"],
              ["couple", "Casal"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={scope === value}
              disabled={locked}
              onClick={() => {
                setScope(value);
                setEditor(null);
                setDeleting(null);
                setActionError("");
                setActionMessage("");
              }}
            >
              {value === "couple" && (
                <UsersRound size={16} aria-hidden="true" />
              )}
              {label}
            </button>
          ))}
        </div>
        <span className="rb-toolbar-note">
          {scope === "personal"
            ? "Gastos compartilhados ficam no orçamento do casal"
            : "Um planejamento compartilhado pelos dois"}
        </span>
      </div>
      {scope === "couple" && !data.couple ? (
        <CoupleEmpty onOpenCouple={onOpenCouple} />
      ) : (
        <>
          <div className="rb-metrics">
            <Metric
              label="Planejado"
              value={formatMoney(totalPlanned)}
              note={`${budgets.length} ${budgets.length === 1 ? "categoria com limite" : "categorias com limite"}`}
              icon={<Target size={19} />}
              accent
            />
            <Metric
              label="Realizado"
              value={formatMoney(totalSpent)}
              note="Gasto líquido nas categorias com limite"
              icon={<ReceiptText size={19} />}
            />
            <Metric
              label="Disponível"
              value={formatMoney(totalRemaining)}
              note="Saldo das categorias dentro do limite"
              icon={<Wallet size={19} />}
            />
            <Metric
              label="Ultrapassado"
              value={formatMoney(totalOver)}
              note={
                totalOver
                  ? "Vale rever os limites ou ajustar os gastos"
                  : "Tudo dentro do que foi planejado"
              }
              icon={
                totalOver ? (
                  <CircleAlert size={19} />
                ) : (
                  <ShieldCheck size={19} />
                )
              }
              warning={totalOver > 0}
            />
          </div>
          <div className="rb-budget-heading">
            <div>
              <h2 id={`${headingId}-budgets`}>Um plano para cada categoria</h2>
              <p>
                {scope === "personal"
                  ? "Aqui entram apenas suas despesas pessoais, sem os gastos compartilhados."
                  : "Despesas compartilhadas dos dois entram neste plano. Ambos podem editar os limites."}
              </p>
            </div>
            <div className="rb-budget-actions">
              <button
                className="rb-button rb-secondary"
                onClick={copyPrevious}
                disabled={locked || missingPriorCategories.length === 0}
                title={
                  missingPriorCategories.length
                    ? `Copiar limites de ${monthLabel(priorMonth)}`
                    : "Nenhuma categoria nova para copiar do mês anterior"
                }
              >
                {pending ? (
                  <LoaderCircle
                    size={16}
                    className="rb-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy size={16} aria-hidden="true" />
                )}
                Copiar mês anterior
              </button>
              <button
                className="rb-button rb-primary"
                onClick={() => openEditor()}
                disabled={locked}
              >
                <Plus size={18} aria-hidden="true" />
                Novo limite
              </button>
            </div>
          </div>
          <div aria-live="polite">
            {actionMessage && (
              <p className="rb-action-success">
                <Check size={17} aria-hidden="true" />
                {actionMessage}
              </p>
            )}
          </div>
          {actionError && (
            <p className="rb-form-error rb-action-error" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              {actionError}
            </p>
          )}
          <div ref={formRef}>
            {activeEditor && (
              <BudgetEditor
                key={`${activeEditor.month}-${activeEditor.scope}-${activeEditor.budget?.id ?? "new"}`}
                state={activeEditor}
                categories={categoryOptions}
                busy={locked}
                onSave={onSave}
                onClose={() => setEditor(null)}
              />
            )}
          </div>
          {progress.length ? (
            <section
              className="rb-budget-grid"
              aria-labelledby={`${headingId}-budgets`}
            >
              {progress.map(
                ({
                  budget,
                  spentCents,
                  remainingCents,
                  percentage,
                  overCents,
                  count,
                }) => {
                  const status =
                    overCents > 0
                      ? "over"
                      : percentage >= 80
                        ? "near"
                        : "within";
                  return (
                    <article
                      key={budget.id}
                      className={`rb-budget-card rb-budget-${status}`}
                    >
                      <div className="rb-budget-card-top">
                        <span className="rb-budget-category-icon">
                          <Target size={20} aria-hidden="true" />
                        </span>
                        <span className={`rb-budget-status ${status}`}>
                          {overCents > 0
                            ? "Limite ultrapassado"
                            : percentage >= 80
                              ? "Perto do limite"
                              : "Dentro do plano"}
                        </span>
                      </div>
                      <div className="rb-budget-name">
                        <h3>{budget.category}</h3>
                        {budget.canEdit && (
                          <div className="rb-budget-card-actions">
                            <button
                              className="rb-icon-button"
                              onClick={() => openEditor(budget)}
                              disabled={locked}
                              aria-label={`Editar limite de ${budget.category}`}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="rb-icon-button rb-delete-button"
                              onClick={() =>
                                setDeleting(
                                  deleting === budget.id ? null : budget.id,
                                )
                              }
                              disabled={locked}
                              aria-label={`Remover limite de ${budget.category}`}
                              aria-expanded={deleting === budget.id}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="rb-budget-spent">
                        <strong>{formatMoney(spentCents)}</strong>
                        <span>de {formatMoney(budget.limitCents)}</span>
                      </div>
                      <div
                        className="rb-progress"
                        role="progressbar"
                        aria-label={`Limite de ${budget.category}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(
                          100,
                          Math.max(0, Math.round(percentage)),
                        )}
                        aria-valuetext={`${formatMoney(spentCents)} de ${formatMoney(budget.limitCents)}, ${Math.round(percentage)}% utilizado`}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, Math.max(0, percentage))}%`,
                          }}
                        />
                      </div>
                      <div className="rb-budget-progress-label">
                        <span>{Math.round(percentage)}% utilizado</span>
                        <span>
                          {count} {count === 1 ? "lançamento" : "lançamentos"}
                        </span>
                      </div>
                      <div className="rb-budget-remaining">
                        {overCents > 0 ? (
                          <>
                            <CircleAlert size={16} aria-hidden="true" />
                            <span>
                              <strong>{formatMoney(overCents)}</strong> acima do
                              limite
                            </span>
                          </>
                        ) : (
                          <>
                            <Check size={16} aria-hidden="true" />
                            <span>
                              <strong>
                                {formatMoney(Math.max(0, remainingCents))}
                              </strong>{" "}
                              disponíveis
                            </span>
                          </>
                        )}
                      </div>
                      {scope === "couple" && (
                        <p className="rb-budget-owner">
                          <UsersRound size={14} aria-hidden="true" />
                          Limite compartilhado · criado por {budget.ownerName}
                        </p>
                      )}
                      {!budget.canEdit && (
                        <p className="rb-budget-owner">
                          <ShieldCheck size={14} aria-hidden="true" />
                          Somente leitura
                        </p>
                      )}
                      {deleting === budget.id && budget.canEdit && (
                        <div
                          className="rb-delete-confirm"
                          role="group"
                          aria-label={`Confirmar remoção de ${budget.category}`}
                        >
                          <p>
                            Remover este limite? Seus lançamentos serão
                            mantidos.
                          </p>
                          <div>
                            <button
                              className="rb-button rb-secondary"
                              onClick={() => setDeleting(null)}
                              disabled={locked}
                            >
                              Manter limite
                            </button>
                            <button
                              className="rb-button rb-danger"
                              onClick={() => removeBudget(budget)}
                              disabled={locked}
                            >
                              {pending ? (
                                <LoaderCircle
                                  size={15}
                                  className="rb-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Trash2 size={15} aria-hidden="true" />
                              )}
                              Remover
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                },
              )}
            </section>
          ) : (
            !activeEditor && (
              <section className="rb-panel rb-empty rb-budget-empty">
                <span className="rb-empty-icon">
                  <Target size={29} aria-hidden="true" />
                </span>
                <span className="rb-kicker">MAIS CLAREZA, MENOS SURPRESAS</span>
                <h2>Seu dinheiro pode ter um plano</h2>
                <p>
                  Defina quanto quer gastar em cada categoria e acompanhe o que
                  ainda está disponível em {monthLabel(month)}.
                </p>
                <button
                  className="rb-button rb-primary"
                  onClick={() => openEditor()}
                  disabled={locked}
                >
                  <Plus size={18} aria-hidden="true" />
                  Criar primeiro limite
                </button>
                {missingPriorCategories.length > 0 && (
                  <button
                    className="rb-text-button"
                    onClick={copyPrevious}
                    disabled={locked}
                  >
                    Ou trazer os limites de {monthLabel(priorMonth)}
                  </button>
                )}
              </section>
            )
          )}
          <div className="rb-budget-explainer">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <strong>
                {scope === "personal"
                  ? "Um espaço só seu"
                  : "O mesmo plano para os dois"}
              </strong>
              <p>
                {scope === "personal"
                  ? "Seus limites pessoais ficam privados. Despesas marcadas como compartilhadas contam apenas no orçamento do casal."
                  : "O orçamento considera apenas despesas compartilhadas. Os gastos pessoais de cada um continuam privados."}{" "}
                Estornos reduzem o realizado; transferências e pagamentos de
                fatura ficam fora.
              </p>
            </div>
          </div>
          <ImportNote transactions={transactions} month={month} />
        </>
      )}
    </div>
  );
}
