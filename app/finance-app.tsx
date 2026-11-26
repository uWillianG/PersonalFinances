"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  BadgeCheck,
  Banknote,
  CalendarDays,
  ChartColumn,
  Car,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Coffee,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileText,
  FileUp,
  GraduationCap,
  Heart,
  HeartPulse,
  House,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Trash2,
  Tv,
  Target,
  Upload,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import type {
  AppState,
  DraftTransaction,
  ImportBatch,
  Source,
  SourceType,
  Transaction,
  TransactionKind,
} from "../lib/types";
import { CATEGORIES, KIND_LABELS } from "../lib/types";
import {
  balancesForMonth,
  categoryBreakdown,
  currentMonth,
  formatMoney,
  installmentForecast,
  monthLabel,
  monthlySeries,
  summarize,
  transactionsForMonth,
} from "../lib/finance";
import { demoState } from "../lib/demo";
import type {
  BudgetInput,
  BudgetLimit,
  PlanScope,
  RecurringSchedule,
  ScheduleInput,
} from "../lib/planning-types";
import { categoryKey } from "../lib/planning";
import { ReportsView, BudgetsView } from "./features/reports-budgets";
import { CalendarView } from "./features/calendar-view";
import { GoalsView } from "./features/goals-view";
import { ReserveView } from "./features/reserve-view";
import type { ReservePlan, ReservePlanInput } from "../lib/reserve-types";
import { validateReservePlan } from "../lib/reserve-validation";
import type {
  GoalInput,
  GoalPatch,
  GoalMovementInput,
  GoalMovement,
  SavingsGoal,
} from "../lib/goals-types";
import { goalProgress } from "../lib/goals";
import {
  validateGoal,
  validateGoalPatch,
  validateGoalMovement,
} from "../lib/goals-validation";
import { categoryRuleKey } from "../lib/category-rules";
import {
  fingerprintOccurrence,
  transactionFingerprint,
} from "../lib/transaction-identity";

type Tab =
  | "overview"
  | "transactions"
  | "imports"
  | "couple"
  | "sources"
  | "reports"
  | "budgets"
  | "calendar"
  | "goals"
  | "reserve";
type Scope = "all" | "personal" | "shared" | "pending";
type PreviewRow = DraftTransaction & {
  key: string;
  included: boolean;
  duplicate: boolean;
  sourceId: string;
  fileName: string;
};
type PickedFile = {
  id: string;
  file: File;
  sourceId: string;
  referenceMonth: string;
};
type BalanceSuggestion = {
  sourceId: string;
  amountCents: number;
  date: string;
  included: boolean;
};
const nav = [
  {
    id: "overview",
    label: "Visão geral",
    short: "Início",
    icon: LayoutDashboard,
  },
  {
    id: "transactions",
    label: "Lançamentos",
    short: "Gastos",
    icon: ReceiptText,
  },
  { id: "imports", label: "Importações", short: "Importar", icon: Upload },
  {
    id: "reports",
    label: "Relatórios",
    short: "Relatórios",
    icon: ChartColumn,
  },
  { id: "budgets", label: "Orçamentos", short: "Orçamentos", icon: Target },
  { id: "calendar", label: "Calendário", short: "Agenda", icon: CalendarDays },
  { id: "goals", label: "Metas e caixinhas", short: "Metas", icon: Sparkles },
  {
    id: "reserve",
    label: "Quanto reservar",
    short: "Reservar",
    icon: Banknote,
  },
  { id: "couple", label: "Nosso espaço", short: "Casal", icon: UsersRound },
  { id: "sources", label: "Contas e saldos", short: "Contas", icon: Wallet },
] as const;
const mobilePrimaryTabs: Tab[] = ["overview", "reports", "imports", "budgets"];
const pageCopy: Record<
  Tab,
  { eyebrow: string; title: string; subtitle: string }
> = {
  overview: {
    eyebrow: "UM OLHAR PARA O SEU MÊS",
    title: "Seu dinheiro, mais claro.",
    subtitle:
      "Entenda para onde foi seu dinheiro e cuide do que vem pela frente.",
  },
  transactions: {
    eyebrow: "CADA GASTO CONTA UMA HISTÓRIA",
    title: "De perto, cada movimento.",
    subtitle:
      "Explore seus lançamentos, ajuste categorias e organize o que é do casal.",
  },
  imports: {
    eyebrow: "MENOS TRABALHO, MAIS CLAREZA",
    title: "Seu mês começa aqui.",
    subtitle: "Traga seus extratos e deixe a organização com a gente.",
  },
  couple: {
    eyebrow: "A VIDA EM CONJUNTO",
    title: "Juntos, com clareza.",
    subtitle: "O que é compartilhado ganha um espaço de vocês.",
  },
  sources: {
    eyebrow: "TUDO NO MESMO LUGAR",
    title: "Suas contas, conectadas à vida.",
    subtitle: "Bancos, cartões e benefícios na mesma visão.",
  },
  reports: {
    eyebrow: "ENTENDA SEUS HÁBITOS",
    title: "Onde seu dinheiro vai.",
    subtitle:
      "Descubra seus principais estabelecimentos e compare seus gastos entre os meses.",
  },
  budgets: {
    eyebrow: "UM PLANO PARA CADA PRIORIDADE",
    title: "Seu plano para o mês.",
    subtitle:
      "Defina limites pessoais e do casal e acompanhe o que já foi realizado.",
  },
  calendar: {
    eyebrow: "O PRÓXIMO COMPROMISSO, À VISTA",
    title: "Uma visão do que vem.",
    subtitle:
      "Organize contas, assinaturas e recebimentos em um calendário de vocês.",
  },
  goals: {
    eyebrow: "ESPAÇO PARA OS SEUS PLANOS",
    title: "Cada objetivo, mais perto.",
    subtitle:
      "Organize suas reservas pessoais e do casal e acompanhe cada conquista.",
  },
  reserve: {
    eyebrow: "ESPAÇO PARA O SEU FUTURO",
    title: "Quanto cabe nos seus planos.",
    subtitle:
      "Uma estimativa mensal para reservar ou investir, com os valores que você já conhece.",
  },
};
const categoryColors = [
  "#185f4d",
  "#78b39b",
  "#b6d981",
  "#9c91c4",
  "#e0b981",
  "#a8bac6",
  "#dd9e9a",
  "#79b5bd",
];
const categoryIcons: Record<string, typeof Coffee> = {
  Alimentação: Coffee,
  Mercado: ShoppingBasket,
  Moradia: House,
  Transporte: Car,
  Saúde: HeartPulse,
  Compras: ShoppingBag,
  Lazer: Heart,
  Assinaturas: Tv,
  Educação: GraduationCap,
  Salário: Banknote,
  Benefícios: ShoppingBasket,
};
const bankColors: Record<string, string> = {
  Nubank: "#820ad1",
  Sicredi: "#378a37",
  "Mercado Pago": "#009ee3",
  PicPay: "#20a76a",
  Sólides: "#ef6b28",
};
const emptyState = (name: string): AppState => ({
  user: { id: "", name, email: "" },
  sources: [],
  transactions: [],
  partnerTransactions: [],
  imports: [],
  couple: null,
});
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
    .replace(".", "");
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function moneyInput(value: string) {
  const s = value.trim().replace(/R\$\s?/g, "");
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error("Informe um valor válido.");
  return Math.round(n * 100);
}
function csvCell(value: string | number) {
  let s = String(value);
  if (/^[=+@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function downloadCSV(rows: Transaction[]) {
  const lines = [
    ["data", "descricao", "valor", "tipo", "categoria", "casal"],
    ...rows.map((t) => [
      t.date,
      t.description,
      (t.amountCents / 100).toFixed(2),
      t.kind,
      t.category,
      t.shared ? "sim" : "não",
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + lines.map((l) => l.map(csvCell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "clara-lancamentos.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res
    .json()
    .catch(() => ({ error: "Não foi possível ler a resposta do servidor." }));
  if (!res.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "Não foi possível concluir a operação.";
    throw new Error(error);
  }
  return data as T;
}

export default function FinanceApp({
  signedIn,
  displayName,
}: {
  signedIn: boolean;
  displayName: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [tab, setTab] = useState<Tab>("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [real, setReal] = useState<AppState>(() => emptyState(displayName));
  const [sample, setSample] = useState<AppState>(() =>
    demoState(currentMonth()),
  );
  const [demo, setDemo] = useState(!signedIn);
  const [loading, setLoading] = useState(signedIn);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourceEditor, setSourceEditor] = useState<Source | null | false>(
    false,
  );
  const [txEditor, setTxEditor] = useState<{
    transaction: Transaction;
    draftKey?: string;
  } | null>(null);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [undo, setUndo] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [balanceSuggestions, setBalanceSuggestions] = useState<
    BalanceSuggestion[]
  >([]);
  const [progress, setProgress] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicates: number;
  } | null>(null);
  const [invite, setInvite] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const data = demo ? sample : real;
  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setLoadError("");
    try {
      const state = await request<AppState>("/api/state");
      setReal(state);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signedIn]);
  useEffect(() => {
    void refresh();
    const code = new URLSearchParams(window.location.search).get("convite");
    if (code) {
      setJoinCode(code);
      setTab("couple");
    }
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setSelected(new Set());
  }, [month, scope, sourceFilter, search]);
  const summary = summarize(data.transactions, month);
  const previous = summarize(data.transactions, shiftMonth(month, -1));
  const balance = balancesForMonth(data.sources, data.transactions, month);
  const categories = categoryBreakdown(data.transactions, month);
  const series = monthlySeries(data.transactions, month);
  const forecast = installmentForecast(data.transactions, month);
  const coupleTransactions = [
    ...data.transactions.filter((t) => t.shared),
    ...data.partnerTransactions,
  ];
  const coupleSummary = summarize(coupleTransactions, month);
  const currentRows = useMemo(
    () =>
      transactionsForMonth(data.transactions, month)
        .filter(
          (t) =>
            (!search ||
              `${t.description} ${t.category}`
                .toLocaleLowerCase("pt-BR")
                .includes(search.toLocaleLowerCase("pt-BR"))) &&
            (!categoryFilter || t.category === categoryFilter) &&
            (!sourceFilter || t.sourceId === sourceFilter) &&
            (scope === "all" ||
              (scope === "personal" && !t.shared) ||
              (scope === "shared" && t.shared) ||
              (scope === "pending" && t.needsReview)),
        )
        .sort(
          (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
        ),
    [data.transactions, month, search, categoryFilter, sourceFilter, scope],
  );
  const lastImport = data.imports[0];
  const go = (next: Tab) => {
    setTab(next);
    setMobileMenu(false);
    setSearch("");
    setSelected(new Set());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const useOwnData = () => {
    if (!signedIn) {
      window.location.assign("/signin-with-chatgpt?return_to=%2F");
      return;
    }
    setDemo(false);
    setTab("imports");
    setFiles([]);
    setPreview([]);
    setImportResult(null);
  };
  const sourceById = (id: string) => data.sources.find((s) => s.id === id);
  const handleError = (e: unknown) =>
    setToast(
      e instanceof Error
        ? e.message
        : "Não foi possível concluir. Tente novamente.",
    );

  async function saveSource(input: Omit<Source, "id" | "ownerId">) {
    setBusy(true);
    try {
      if (demo) {
        const source = {
          ...input,
          id: (sourceEditor && sourceEditor.id) || crypto.randomUUID(),
          ownerId: data.user.id,
        };
        setSample((s) => ({
          ...s,
          sources: sourceEditor
            ? s.sources.map((x) => (x.id === source.id ? source : x))
            : [...s.sources, source],
        }));
      } else {
        await request(
          sourceEditor ? `/api/sources/${sourceEditor.id}` : "/api/sources",
          sourceEditor ? "PATCH" : "POST",
          input,
        );
        await refresh();
      }
      setSourceEditor(false);
      setToast("Conta salva. Você já pode associar os arquivos.");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveTransaction(
    patch: Partial<Transaction>,
    rememberCategory = false,
  ) {
    if (!txEditor) return;
    setBusy(true);
    try {
      if (txEditor.draftKey) {
        const key = txEditor.draftKey;
        setPreview((rows) =>
          rows.map((row) => {
            if (row.key !== key) return row;
            const updated = { ...row, ...patch };
            updated.fingerprint = transactionFingerprint(
              updated,
              fingerprintOccurrence(row.fingerprint) ?? 1,
            );
            return {
              ...updated,
              duplicate: data.transactions.some(
                (t) =>
                  t.sourceId === row.sourceId &&
                  t.fingerprint === updated.fingerprint,
              ),
            };
          }),
        );
      } else if (demo) {
        setSample((s) => ({
          ...s,
          transactions: s.transactions.map((t) =>
            t.id === txEditor.transaction.id ? { ...t, ...patch } : t,
          ),
        }));
      } else {
        await request(
          `/api/transactions/${txEditor.transaction.id}`,
          "PATCH",
          patch,
        );
        await refresh();
      }
      let ruleFailed = false;
      if (rememberCategory && !txEditor.draftKey) {
        const description =
          patch.description ?? txEditor.transaction.description;
        const category = patch.category ?? txEditor.transaction.category;
        try {
          if (demo) {
            const key = categoryRuleKey(description);
            setSample((s) => ({
              ...s,
              rules: [
                ...(s.rules ?? []).filter((r) => r.key !== key),
                { id: crypto.randomUUID(), description, key, category },
              ],
            }));
          } else {
            await request("/api/rules", "POST", { description, category });
            await refresh();
          }
        } catch {
          ruleFailed = true;
        }
      }
      setTxEditor(null);
      setToast(
        ruleFailed
          ? "Lançamento salvo. Não foi possível salvar a regra de categoria; tente novamente."
          : "Lançamento atualizado.",
      );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveReservePlan(input: ReservePlanInput) {
    const checked = validateReservePlan(input);
    setBusy(true);
    try {
      if (demo) {
        setSample((state) => ({
          ...state,
          reservePlans: [
            ...(state.reservePlans ?? []).filter(
              (plan) => plan.month !== checked.month,
            ),
            { ...checked, id: crypto.randomUUID(), ownerId: state.user.id },
          ],
        }));
      } else {
        const { plan } = await request<{ plan: ReservePlan }>(
          "/api/reserve-plans",
          "POST",
          checked,
        );
        setReal((state) => ({
          ...state,
          reservePlans: [
            ...(state.reservePlans ?? []).filter(
              (item) => item.month !== plan.month,
            ),
            plan,
          ],
        }));
        await refresh();
      }
      setToast("Ajustes da estimativa salvos para este mês.");
    } finally {
      setBusy(false);
    }
  }
  async function resetReservePlan(selectedMonth: string) {
    setBusy(true);
    try {
      if (demo)
        setSample((state) => ({
          ...state,
          reservePlans: (state.reservePlans ?? []).filter(
            (plan) => plan.month !== selectedMonth,
          ),
        }));
      else {
        await request(`/api/reserve-plans/${selectedMonth}`, "DELETE");
        setReal((state) => ({
          ...state,
          reservePlans: (state.reservePlans ?? []).filter(
            (plan) => plan.month !== selectedMonth,
          ),
        }));
        await refresh();
      }
      setToast("A estimativa voltou aos valores automáticos deste mês.");
    } finally {
      setBusy(false);
    }
  }
  async function saveGoal(input: GoalInput | GoalPatch, id?: string) {
    const { scope: _scope, ...patch } = input as GoalInput;
    const checked = id ? validateGoalPatch(patch) : validateGoal(input);
    if (!id && (checked as GoalInput).scope === "couple" && !data.couple)
      throw new Error("Conecte o casal antes de criar uma meta conjunta.");
    setBusy(true);
    try {
      if (demo) {
        if (id && !(data.goals ?? []).some((goal) => goal.id === id))
          throw new Error("Meta não encontrada.");
        setSample((state) => ({
          ...state,
          goals: id
            ? (state.goals ?? []).map((goal) =>
                goal.id === id
                  ? { ...goal, ...checked, scope: goal.scope }
                  : goal,
              )
            : [
                ...(state.goals ?? []),
                {
                  ...(checked as GoalInput),
                  id: crypto.randomUUID(),
                  ownerId: state.user.id,
                  ownerName: state.user.name,
                  canEdit: true,
                } satisfies SavingsGoal,
              ],
        }));
      } else {
        const { goal } = await request<{ goal: SavingsGoal }>(
          id ? `/api/goals/${id}` : "/api/goals",
          id ? "PATCH" : "POST",
          checked,
        );
        setReal((state) => ({
          ...state,
          goals: [
            ...(state.goals ?? []).filter((item) => item.id !== goal.id),
            goal,
          ],
        }));
        await refresh();
      }
      setToast("Meta salva.");
    } finally {
      setBusy(false);
    }
  }
  async function removeGoal(id: string) {
    setBusy(true);
    try {
      if (demo) {
        if (
          (data.goalMovements ?? []).some((movement) => movement.goalId === id)
        )
          throw new Error("Arquive a meta para preservar seu histórico.");
        setSample((state) => ({
          ...state,
          goals: (state.goals ?? []).filter((goal) => goal.id !== id),
        }));
      } else {
        await request(`/api/goals/${id}`, "DELETE");
        setReal((state) => ({
          ...state,
          goals: (state.goals ?? []).filter((goal) => goal.id !== id),
        }));
        await refresh();
      }
      setToast("Meta excluída.");
    } finally {
      setBusy(false);
    }
  }
  async function addGoalMovement(goalId: string, input: GoalMovementInput) {
    const checked = validateGoalMovement(input);
    setBusy(true);
    try {
      if (demo) {
        const goal = (data.goals ?? []).find((item) => item.id === goalId);
        if (!goal) throw new Error("Meta não encontrada.");
        const old = (data.goalMovements ?? []).find(
          (item) => item.id === checked.id,
        );
        if (old) {
          if (
            old.goalId !== goalId ||
            old.ownerId !== data.user.id ||
            old.kind !== checked.kind ||
            old.amountCents !== checked.amountCents ||
            old.date !== checked.date ||
            old.note !== checked.note
          )
            throw new Error(
              "Este registro já foi utilizado. Abra um novo aporte ou resgate.",
            );
        } else {
          const reserved = goalProgress(
            goal,
            data.goalMovements ?? [],
          ).reservedCents;
          if (checked.kind === "deposit" && goal.archived)
            throw new Error("Reative a meta antes de registrar um aporte.");
          const next =
            reserved +
            (checked.kind === "deposit"
              ? checked.amountCents
              : -checked.amountCents);
          if (next < 0)
            throw new Error("O resgate não pode superar o valor reservado.");
          if (next > 1_000_000_000_000)
            throw new Error("A reserva excede o limite permitido.");
          setSample((state) => ({
            ...state,
            goalMovements: [
              ...(state.goalMovements ?? []),
              {
                ...checked,
                goalId,
                ownerId: state.user.id,
                ownerName: state.user.name,
                createdAt: new Date().toISOString(),
              },
            ],
          }));
        }
      } else {
        const { movement } = await request<{ movement: GoalMovement }>(
          `/api/goals/${goalId}/movements`,
          "POST",
          checked,
        );
        // Keep the server-confirmed reservation visible even if the following
        // state refresh fails, so a saved contribution is not mistaken for a failure.
        setReal((state) => ({
          ...state,
          goalMovements: [
            ...(state.goalMovements ?? []).filter(
              (item) => item.id !== movement.id,
            ),
            movement,
          ],
        }));
        await refresh();
      }
      setToast(
        checked.kind === "deposit"
          ? "Aporte registrado na caixinha."
          : "Resgate registrado na caixinha.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveBudget(input: BudgetInput, id?: string) {
    if (input.scope === "couple" && !data.couple)
      throw new Error("Conecte o casal antes de criar um orçamento conjunto.");
    setBusy(true);
    try {
      if (demo) {
        setSample((state) => {
          const budgets = state.budgets ?? [];
          const existing = id
            ? budgets.find((budget) => budget.id === id)
            : budgets.find(
                (budget) =>
                  budget.month === input.month &&
                  budget.scope === input.scope &&
                  categoryKey(budget.category) === categoryKey(input.category),
              );
          const budget: BudgetLimit = existing
            ? { ...existing, limitCents: input.limitCents }
            : {
                ...input,
                id: crypto.randomUUID(),
                ownerId: state.user.id,
                ownerName: state.user.name,
                canEdit: true,
              };
          return {
            ...state,
            budgets: existing
              ? budgets.map((item) => (item.id === existing.id ? budget : item))
              : [...budgets, budget],
          };
        });
      } else {
        await request(
          id ? `/api/budgets/${id}` : "/api/budgets",
          id ? "PATCH" : "POST",
          id ? { limitCents: input.limitCents } : input,
        );
        await refresh();
      }
      setToast("Orçamento salvo para o mês selecionado.");
    } finally {
      setBusy(false);
    }
  }
  async function removeBudget(id: string) {
    setBusy(true);
    try {
      if (demo)
        setSample((state) => ({
          ...state,
          budgets: (state.budgets ?? []).filter((budget) => budget.id !== id),
        }));
      else {
        await request(`/api/budgets/${id}`, "DELETE");
        await refresh();
      }
      setToast("Orçamento removido. Seus lançamentos permanecem no histórico.");
    } finally {
      setBusy(false);
    }
  }
  async function copyBudgets(
    scope: PlanScope,
    fromMonth: string,
    toMonth: string,
  ) {
    setBusy(true);
    try {
      let copied = 0,
        skipped = 0;
      if (demo) {
        const budgets = data.budgets ?? [];
        const from = budgets.filter(
          (budget) => budget.scope === scope && budget.month === fromMonth,
        );
        const existing = new Set(
          budgets
            .filter(
              (budget) => budget.scope === scope && budget.month === toMonth,
            )
            .map((budget) => categoryKey(budget.category)),
        );
        const additions = from
          .filter((budget) => !existing.has(categoryKey(budget.category)))
          .map((budget) => ({
            ...budget,
            id: crypto.randomUUID(),
            month: toMonth,
            ownerId: data.user.id,
            ownerName: data.user.name,
          }));
        copied = additions.length;
        skipped = from.length - copied;
        setSample((state) => ({
          ...state,
          budgets: [...(state.budgets ?? []), ...additions],
        }));
      } else {
        const result = await request<{ copied: number; skipped: number }>(
          "/api/budgets/copy",
          "POST",
          { scope, fromMonth, toMonth },
        );
        copied = result.copied;
        skipped = result.skipped;
        await refresh();
      }
      setToast(
        copied
          ? `${copied} orçamento(s) copiado(s).${skipped ? ` ${skipped} já existiam e foram mantidos.` : ""}`
          : skipped
            ? "As categorias já têm orçamento neste mês e foram mantidas."
            : "Não há orçamentos para copiar do mês anterior.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveSchedule(input: ScheduleInput, id?: string) {
    if (input.scope === "couple" && !data.couple)
      throw new Error(
        "Conecte o casal antes de criar uma recorrência compartilhada.",
      );
    setBusy(true);
    try {
      if (demo)
        setSample((state) => {
          const old = (state.schedules ?? []).find(
            (schedule) => schedule.id === id,
          );
          const schedule: RecurringSchedule = old
            ? { ...old, ...input, scope: old.scope }
            : {
                ...input,
                id: crypto.randomUUID(),
                ownerId: state.user.id,
                ownerName: state.user.name,
                canEdit: true,
              };
          return {
            ...state,
            schedules: old
              ? (state.schedules ?? []).map((item) =>
                  item.id === old.id ? schedule : item,
                )
              : [...(state.schedules ?? []), schedule],
          };
        });
      else {
        const { scope, ...patch } = input;
        await request(
          id ? `/api/schedules/${id}` : "/api/schedules",
          id ? "PATCH" : "POST",
          id ? patch : input,
        );
        await refresh();
      }
      setToast("Recorrência salva no calendário.");
    } finally {
      setBusy(false);
    }
  }
  async function removeSchedule(id: string) {
    setBusy(true);
    try {
      if (demo)
        setSample((state) => ({
          ...state,
          schedules: (state.schedules ?? []).filter(
            (schedule) => schedule.id !== id,
          ),
          occurrences: (state.occurrences ?? []).filter(
            (occurrence) => occurrence.scheduleId !== id,
          ),
        }));
      else {
        await request(`/api/schedules/${id}`, "DELETE");
        await refresh();
      }
      setToast(
        "Recorrência removida. Os lançamentos importados permanecem como estão.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function setOccurrence(
    scheduleId: string,
    dueDate: string,
    action: "confirm" | "skip" | "reset" | "link",
    transactionId?: string,
  ) {
    setBusy(true);
    try {
      if (demo) {
        const schedule = (data.schedules ?? []).find(
          (item) => item.id === scheduleId,
        );
        if (!schedule) throw new Error("Recorrência não encontrada.");
        if (action === "link") {
          const candidates =
            schedule.scope === "personal"
              ? data.transactions.filter((tx) => !tx.shared)
              : [
                  ...data.transactions.filter((tx) => tx.shared),
                  ...data.partnerTransactions.filter((tx) => tx.shared),
                ];
          const tx = candidates.find((tx) => tx.id === transactionId);
          if (!tx || tx.kind !== schedule.kind)
            throw new Error(
              "Escolha um lançamento compatível com esta recorrência.",
            );
          if (
            (data.occurrences ?? []).some(
              (occurrence) =>
                occurrence.transactionId === transactionId &&
                (occurrence.scheduleId !== scheduleId ||
                  occurrence.dueDate !== dueDate),
            )
          )
            throw new Error(
              "Este lançamento já está vinculado a outro compromisso.",
            );
        }
        setSample((state) => {
          const rest = (state.occurrences ?? []).filter(
            (item) =>
              item.scheduleId !== scheduleId || item.dueDate !== dueDate,
          );
          return {
            ...state,
            occurrences:
              action === "reset"
                ? rest
                : [
                    ...rest,
                    {
                      id: crypto.randomUUID(),
                      scheduleId,
                      dueDate,
                      state:
                        action === "link"
                          ? "linked"
                          : action === "skip"
                            ? "skipped"
                            : "confirmed",
                      transactionId: action === "link" ? transactionId! : null,
                      confirmedBy: state.user.id,
                    },
                  ],
          };
        });
      } else {
        await request(`/api/schedules/${scheduleId}/occurrences`, "POST", {
          dueDate,
          action,
          transactionId,
        });
        await refresh();
      }
      setToast(
        action === "link"
          ? "Compromisso vinculado ao lançamento importado."
          : action === "reset"
            ? "Compromisso reaberto para conferência."
            : action === "skip"
              ? "Este vencimento foi ignorado no calendário."
              : "Confirmação salva no calendário, sem alterar os lançamentos.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function markSelectedShared() {
    if (!data.couple) {
      setToast("Conecte o casal primeiro para compartilhar os gastos.");
      go("couple");
      return;
    }
    setBusy(true);
    try {
      if (demo)
        setSample((s) => ({
          ...s,
          transactions: s.transactions.map((t) =>
            selected.has(t.id) ? { ...t, shared: true } : t,
          ),
        }));
      else {
        const ids = [...selected];
        for (let i = 0; i < ids.length; i += 8)
          await Promise.all(
            ids
              .slice(i, i + 8)
              .map((id) =>
                request(`/api/transactions/${id}`, "PATCH", { shared: true }),
              ),
          );
        await refresh();
      }
      setSelected(new Set());
      setToast("Gastos adicionados ao espaço do casal.");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function removeRule(id: string) {
    try {
      if (demo)
        setSample((s) => ({
          ...s,
          rules: (s.rules ?? []).filter((r) => r.id !== id),
        }));
      else {
        await request(`/api/rules/${id}`, "DELETE");
        await refresh();
      }
      setToast(
        "Regra removida. Os lançamentos anteriores permanecem como estão.",
      );
    } catch (error) {
      handleError(error);
    }
  }
  function selectFiles(list: FileList | null) {
    if (!list) return;
    if (files.length + list.length > 20) {
      setToast("Selecione até 20 arquivos por lote.");
      return;
    }
    const picked = Array.from(list).map((file) => ({
      id: crypto.randomUUID(),
      file,
      sourceId: data.sources[0]?.id ?? "",
      referenceMonth: month,
    }));
    setFiles((old) => [...old, ...picked]);
    setPreview([]);
    setWarnings([]);
    setImportResult(null);
  }
  async function readFiles() {
    if (!files.length) return;
    if (files.some((f) => !f.sourceId)) {
      setToast("Escolha a conta ou o cartão de cada arquivo.");
      return;
    }
    setBusy(true);
    setWarnings([]);
    setBalanceSuggestions([]);
    setPreview([]);
    setImportResult(null);
    const detectedBalances: BalanceSuggestion[] = [];
    const rows: PreviewRow[] = [];
    const notices: string[] = [];
    const seen = new Set(
      data.transactions.map((t) => `${t.sourceId}:${t.fingerprint}`),
    );
    try {
      const { readStatementFile } = await import("../lib/file-reader");
      for (const entry of files) {
        const source = sourceById(entry.sourceId)!;
        setProgress(`Lendo ${entry.file.name}…`);
        try {
          const result = await readStatementFile(
            entry.file,
            { referenceMonth: entry.referenceMonth, sourceType: source.type },
            (msg) => setProgress(`${entry.file.name}: ${msg}`),
          );
          notices.push(
            ...result.warnings.map((w) => `${entry.file.name}: ${w}`),
          );
          if (
            result.balance &&
            source.type !== "credit" &&
            !source.hasOpeningBalance
          ) {
            const b = result.balance;
            const d = new Date(`${b.date}T12:00:00Z`);
            if (b.basis === "closing") d.setUTCDate(d.getUTCDate() + 1);
            const date = d.toISOString().slice(0, 10);
            const previous = detectedBalances.findIndex(
              (x) => x.sourceId === source.id,
            );
            const suggestion = {
              sourceId: source.id,
              amountCents: b.amountCents,
              date,
              included: true,
            };
            if (previous < 0) detectedBalances.push(suggestion);
            else if (date < detectedBalances[previous].date)
              detectedBalances[previous] = suggestion;
          }
          for (const [i, raw] of result.rows.entries()) {
            let row = { ...raw };
            const savedRule = (data.rules ?? []).find(
              (rule) => rule.key === categoryRuleKey(row.description),
            );
            if (savedRule)
              row = {
                ...row,
                category: savedRule.category,
                needsReview: /\.(pdf|png|jpe?g|webp)$/i.test(entry.file.name)
                  ? row.needsReview
                  : false,
              };
            if (source.type === "credit") {
              const day = Number(row.date.slice(-2));
              const [y, m] = entry.referenceMonth.split("-").map(Number);
              const d = Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate());
              const billingDate = `${entry.referenceMonth}-${String(d).padStart(2, "0")}`;
              if (billingDate !== row.date)
                row = {
                  ...row,
                  date: billingDate,
                  note: `Data informada no arquivo: ${row.date}. Competência da fatura: ${entry.referenceMonth}.`,
                };
            }
            row.fingerprint = transactionFingerprint(
              row,
              fingerprintOccurrence(raw.fingerprint) ?? 1,
            );
            const identity = `${source.id}:${row.fingerprint}`;
            const duplicate = seen.has(identity);
            seen.add(identity);
            rows.push({
              ...row,
              key: `${entry.id}-${i}`,
              sourceId: source.id,
              fileName: entry.file.name,
              shared: false,
              included: !duplicate,
              duplicate,
            });
          }
        } catch (e) {
          notices.push(`${entry.file.name}: ${(e as Error).message}`);
        }
      }
      if (rows.length > 5000)
        throw new Error(
          "O lote ultrapassa 5.000 lançamentos. Divida os arquivos em lotes menores.",
        );
      setPreview(rows);
      setBalanceSuggestions(detectedBalances);
      setWarnings(notices);
      if (!rows.length)
        setToast(
          "Nenhum lançamento identificado. Confira os avisos ou use o modelo CSV.",
        );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function confirmImport() {
    const items = preview.filter((r) => r.included && !r.duplicate);
    if (!items.length) {
      setToast("Selecione pelo menos um lançamento novo.");
      return;
    }
    setBusy(true);
    const balanceFailures: string[] = [];
    const balanceUpdates = balanceSuggestions.filter((b) => b.included);
    try {
      let result: { imported: number; duplicates: number };
      if (demo) {
        const importId = crypto.randomUUID();
        const transactions: Transaction[] = items.map((row) => ({
          ...row,
          id: crypto.randomUUID(),
          ownerId: data.user.id,
          ownerName: data.user.name,
          note: row.note ?? "",
          shared: row.shared ?? false,
          importId,
        }));
        const dates = items.map((x) => x.date).sort();
        const batch: ImportBatch = {
          id: importId,
          createdAt: new Date().toISOString(),
          files: [...new Set(items.map((x) => x.fileName))],
          count: items.length,
          incomeCents: items
            .filter((x) => x.kind === "income")
            .reduce((s, x) => s + x.amountCents, 0),
          expenseCents: items
            .filter((x) => x.kind === "expense")
            .reduce((s, x) => s + x.amountCents, 0),
          periodStart: dates[0],
          periodEnd: dates.at(-1)!,
        };
        setSample((s) => ({
          ...s,
          transactions: [...s.transactions, ...transactions],
          imports: [batch, ...s.imports],
          sources: s.sources.map((source) => {
            const b = balanceUpdates.find((b) => b.sourceId === source.id);
            return b
              ? {
                  ...source,
                  initialBalanceCents: b.amountCents,
                  balanceDate: b.date,
                  hasOpeningBalance: true,
                }
              : source;
          }),
        }));
        result = {
          imported: items.length,
          duplicates: preview.filter((r) => r.duplicate).length,
        };
      } else {
        result = await request("/api/imports", "POST", {
          items: items.map(({ key, included, duplicate, ...row }) => row),
        });
        for (const b of balanceUpdates) {
          try {
            await request(`/api/sources/${b.sourceId}`, "PATCH", {
              initialBalanceCents: b.amountCents,
              balanceDate: b.date,
              hasOpeningBalance: true,
            });
          } catch {
            balanceFailures.push(sourceById(b.sourceId)?.name ?? "uma conta");
          }
        }
        await refresh();
      }
      setImportResult(result);
      setMonth(
        items
          .map((x) => x.date.slice(0, 7))
          .sort()
          .at(-1)!,
      );
      setPreview([]);
      setFiles([]);
      setWarnings([]);
      setBalanceSuggestions([]);
      setToast(
        balanceFailures.length
          ? `Importação salva. Confira o saldo de partida de ${balanceFailures.join(", ")} em Contas e saldos.`
          : "Importação concluída.",
      );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function undoImport() {
    if (!undo) return;
    setBusy(true);
    try {
      if (demo)
        setSample((s) => ({
          ...s,
          transactions: s.transactions.filter((t) => t.importId !== undo.id),
          imports: s.imports.filter((b) => b.id !== undo.id),
        }));
      else {
        await request(`/api/imports/${undo.id}`, "DELETE");
        await refresh();
      }
      setUndo(null);
      setToast("Importação desfeita.");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function coupleAction(action: "create" | "join" | "leave") {
    setBusy(true);
    try {
      if (demo) {
        setToast(
          "Explore o casal na demonstração. Entre para conectar suas contas.",
        );
        return;
      }
      const result = await request<{ code?: string }>("/api/couple", "POST", {
        action,
        code: joinCode.trim(),
      });
      setInvite(result.code ?? "");
      setJoinCode("");
      await refresh();
      setToast(
        action === "join"
          ? "Vocês estão conectados!"
          : action === "leave"
            ? "Você saiu do espaço compartilhado."
            : "Código de convite criado.",
      );
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  const renderRows = (rows: Transaction[], compact = false) =>
    rows.length ? (
      <div className={`transaction-list ${compact ? "compact" : ""}`}>
        {rows.map((t) => {
          const Icon = categoryIcons[t.category] ?? ReceiptText;
          const isOwner = t.ownerId === data.user.id;
          const positive =
            t.kind === "income" ||
            t.kind === "refund" ||
            t.kind === "transfer_in";
          return (
            <div className="transaction-row" key={t.id}>
              {!compact && (
                <input
                  aria-label={`Selecionar ${t.description}`}
                  type="checkbox"
                  checked={selected.has(t.id)}
                  disabled={!isOwner}
                  onChange={() =>
                    setSelected((old) => {
                      const n = new Set(old);
                      n.has(t.id) ? n.delete(t.id) : n.add(t.id);
                      return n;
                    })
                  }
                />
              )}
              <span
                className={`tx-icon ${t.kind === "income" ? "income" : ""}`}
              >
                <Icon size={19} />
              </span>
              <button
                className="tx-description"
                disabled={!isOwner}
                onClick={() => setTxEditor({ transaction: t })}
              >
                <strong>{t.description}</strong>
                <span>
                  {compact ? t.category : dateLabel(t.date)}
                  {t.installmentTotal
                    ? ` · Parcela ${t.installmentCurrent}/${t.installmentTotal}`
                    : ""}
                  {t.needsReview && <em>Revisar</em>}
                </span>
              </button>
              {!compact && <span className="tx-category">{t.category}</span>}
              {!compact && (
                <span className="tx-source">
                  {sourceById(t.sourceId)?.institution ?? t.ownerName}
                </span>
              )}
              <div className="tx-amount">
                <strong className={positive ? "positive" : ""}>
                  {positive ? "+" : "−"} {formatMoney(t.amountCents)}
                </strong>
                <span>
                  {t.shared ? (
                    <>
                      <UsersRound size={12} /> Casal
                    </>
                  ) : isOwner ? (
                    "Pessoal"
                  ) : (
                    t.ownerName
                  )}
                </span>
              </div>
              {!compact && (
                <button
                  className="icon-button tx-edit"
                  aria-label={`Editar ${t.description}`}
                  disabled={!isOwner}
                  onClick={() => setTxEditor({ transaction: t })}
                >
                  <MoreHorizontal size={18} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    ) : (
      <Empty
        icon={<ReceiptText />}
        title="Nenhum lançamento por aqui"
        text={
          scope === "pending"
            ? "Tudo em dia: não há pendências neste mês."
            : "Importe seus arquivos ou ajuste os filtros para encontrar os lançamentos."
        }
        action={
          <button className="button primary" onClick={() => go("imports")}>
            <Upload size={17} /> Importar arquivos
          </button>
        }
      />
    );

  return (
    <div className="app-shell" inert={!hydrated} aria-busy={!hydrated}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Clara, início">
          <img src="/favicon.svg" alt="" width="35" height="35" />
          <span>
            clara<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="sidebar-label">SEU DIA A DIA</span>
        <nav aria-label="Navegação principal">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? "active" : ""}`}
              aria-label={item.label}
              onClick={() => go(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <item.icon size={20} />
              {item.label}
              {item.id === "transactions" && summary.pendingCount > 0 && (
                <span className="nav-count">{summary.pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <Sparkles size={19} />
          </span>
          <strong>Um mês de cada vez.</strong>
          <p>Pequenas descobertas para cuidar melhor do seu dinheiro.</p>
          <button onClick={() => go("imports")}>
            Atualizar meu mês <Plus size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="private-note">
            <ShieldCheck size={15} /> Um espaço só seu
          </span>
          <div className="profile">
            <span className="avatar">
              {data.user.name.slice(0, 1).toLocaleUpperCase()}
            </span>
            <div>
              <strong>
                {demo ? "Explorando o Clara" : data.user.name.split("@")[0]}
              </strong>
              <span>
                {demo ? "Dados de demonstração" : "Seu espaço pessoal"}
              </span>
            </div>
            {signedIn ? (
              <a
                className="icon-button"
                href="/signout-with-chatgpt?return_to=%2F"
                target="_top"
                aria-label="Sair"
              >
                <LogOut size={17} />
              </a>
            ) : (
              <a
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
                className="icon-button"
                aria-label="Entrar"
              >
                <LogOut size={17} />
              </a>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <img src="/favicon.svg" width="30" height="30" alt="" />
            <strong>clara.</strong>
          </div>
          <div className="breadcrumb">
            Suas finanças <span>/</span>{" "}
            <strong>{nav.find((x) => x.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="privacy-label">
              <LockKeyhole size={14} /> Espaço pessoal
            </span>
            {signedIn ? (
              <button
                className="avatar avatar-small"
                title={data.user.name}
                onClick={() => go("sources")}
              >
                {data.user.name.slice(0, 1).toUpperCase()}
              </button>
            ) : (
              <a
                className="button signin"
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
              >
                Entrar
              </a>
            )}
          </div>
        </header>
        <main id="main-content">
          {demo && (
            <div className="demo-banner">
              <span>
                <Sparkles size={16} />
                <strong>Modo demonstração</strong>
                <span className="demo-detail">
                  Explore com dados fictícios.
                </span>
              </span>
              <button onClick={useOwnData}>
                {signedIn ? "Usar meus dados" : "Começar com meus dados"}
              </button>
            </div>
          )}
          {loadError && (
            <div className="notice error">
              <CircleAlert size={19} />
              <span>{loadError}</span>
              <button onClick={() => void refresh()}>Tentar novamente</button>
            </div>
          )}
          {loading && !demo ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              <p>Preparando seu espaço…</p>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">{pageCopy[tab].eyebrow}</p>
                  <h1>{pageCopy[tab].title}</h1>
                  <p className="page-subtitle">{pageCopy[tab].subtitle}</p>
                </div>
                {tab === "sources" ? (
                  <button
                    className="button primary"
                    onClick={() => setSourceEditor(null)}
                  >
                    <Plus size={18} /> Adicionar conta
                  </button>
                ) : (
                  tab !== "imports" && (
                    <button
                      className="button primary desktop-import"
                      onClick={() => go("imports")}
                    >
                      <Upload size={17} /> Importar arquivos
                    </button>
                  )
                )}
              </div>
              {tab !== "imports" && tab !== "goals" && (
                <div className="period-bar">
                  <div className="month-picker">
                    <button
                      className="icon-button"
                      aria-label="Mês anterior"
                      onClick={() => setMonth(shiftMonth(month, -1))}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <label>
                      <CalendarDays size={16} />
                      <span>{monthLabel(month)}</span>
                      <input
                        type="month"
                        aria-label="Mês de referência"
                        value={month}
                        onChange={(e) =>
                          e.target.value && setMonth(e.target.value)
                        }
                      />
                      <ChevronDown size={14} />
                    </label>
                    <button
                      className="icon-button"
                      aria-label="Próximo mês"
                      onClick={() => setMonth(shiftMonth(month, 1))}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                  <span className="update-note">
                    {lastImport ? (
                      <>
                        <CheckCheck size={15} /> Última importação:{" "}
                        {dateLabel(lastImport.createdAt.slice(0, 10))}
                      </>
                    ) : (
                      <>
                        <FileText size={15} /> Aguardando sua primeira
                        importação
                      </>
                    )}
                  </span>
                </div>
              )}

              {tab === "overview" && (
                <>
                  {!data.transactions.length && (
                    <div className="welcome-card">
                      <div className="welcome-icon">
                        <FileUp size={28} />
                      </div>
                      <div>
                        <h2>Vamos conhecer o seu mês?</h2>
                        <p>
                          Adicione suas contas e importe os arquivos do banco
                          para começar.
                        </p>
                      </div>
                      <button
                        className="button primary"
                        onClick={() =>
                          go(data.sources.length ? "imports" : "sources")
                        }
                      >
                        Começar agora
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setDemo(true)}
                      >
                        Ver demonstração
                      </button>
                    </div>
                  )}
                  <div className="metrics-grid">
                    <button
                      className="metric-card balance-card"
                      onClick={() => setBalanceOpen(true)}
                    >
                      <div className="metric-label">
                        <span>Saldo consolidado</span>
                        <Wallet size={19} />
                      </div>
                      <strong className="metric-value">
                        {formatMoney(balance.totalCents)}
                      </strong>
                      <span className="metric-foot">
                        {balance.complete
                          ? "Contas e benefícios no período"
                          : "Saldo parcial · confira os saldos iniciais"}
                        <Eye size={14} />
                      </span>
                      <span className="balance-decoration" />
                    </button>
                    <Metric
                      title="Entradas do mês"
                      value={summary.incomeCents}
                      icon={<Banknote size={19} />}
                      foot="Recebimentos e benefícios"
                      tone="green"
                    />
                    <Metric
                      title="Gastos do mês"
                      value={summary.expenseCents}
                      icon={<ShoppingBag size={19} />}
                      foot={
                        previous.expenseCents
                          ? `${Math.abs(Math.round((summary.expenseCents / previous.expenseCents - 1) * 100))}% ${summary.expenseCents <= previous.expenseCents ? "a menos" : "a mais"} que no mês anterior`
                          : "Seu consumo no período"
                      }
                    />
                    <Metric
                      title="Resultado do mês"
                      value={summary.netCents}
                      icon={<Activity size={19} />}
                      foot="Entradas menos gastos"
                      tone={summary.netCents >= 0 ? "green" : "red"}
                    />
                  </div>
                  <div className="overview-charts">
                    <section className="panel flow-panel">
                      <PanelTitle
                        title="O movimento do seu dinheiro"
                        subtitle="Uma visão dos últimos seis meses"
                        action={
                          <div className="chart-legend">
                            <span>
                              <i className="income-dot" />
                              Entradas
                            </span>
                            <span>
                              <i className="expense-dot" />
                              Gastos
                            </span>
                          </div>
                        }
                      />
                      <FlowChart
                        series={series}
                        month={month}
                        onMonth={setMonth}
                      />
                    </section>
                    <section className="panel categories-panel">
                      <PanelTitle
                        title="Para onde foi?"
                        subtitle="Seus gastos por categoria"
                      />
                      <CategoryChart
                        categories={categories}
                        total={summary.expenseCents}
                      />
                    </section>
                  </div>
                  {summary.pendingCount > 0 && (
                    <button
                      className="review-banner"
                      onClick={() => {
                        setScope("pending");
                        setTab("transactions");
                      }}
                    >
                      <span className="review-icon">
                        <CircleAlert size={20} />
                      </span>
                      <div>
                        <strong>
                          {summary.pendingCount}{" "}
                          {summary.pendingCount === 1
                            ? "lançamento precisa"
                            : "lançamentos precisam"}{" "}
                          de um olhar seu
                        </strong>
                        <span>
                          Uma revisão rápida deixa seu mês mais claro.
                        </span>
                      </div>
                      <span className="review-cta">
                        Revisar <ChevronRight size={16} />
                      </span>
                    </button>
                  )}
                  <div className="overview-bottom">
                    <section className="panel latest-panel">
                      <PanelTitle
                        title="Últimos movimentos"
                        subtitle={`${summary.count} lançamentos neste mês`}
                        action={
                          <button
                            className="text-button"
                            onClick={() => go("transactions")}
                          >
                            Ver todos
                          </button>
                        }
                      />
                      {renderRows(
                        transactionsForMonth(data.transactions, month)
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .slice(0, 5),
                        true,
                      )}
                    </section>
                    <div className="side-cards">
                      <section className="couple-teaser">
                        <div className="teaser-title">
                          <span className="couple-icon">
                            <UsersRound size={21} />
                          </span>
                          <span>Nosso espaço</span>
                          <span className="small-pill">Casal</span>
                        </div>
                        <h2>
                          A vida a dois,
                          <br />
                          em uma só visão.
                        </h2>
                        <p>
                          {data.couple
                            ? `${formatMoney(coupleSummary.expenseCents)} em gastos compartilhados neste mês.`
                            : "Compartilhem os gastos da casa e preservem o espaço de cada um."}
                        </p>
                        <button
                          className="button couple-button"
                          onClick={() => go("couple")}
                        >
                          {data.couple
                            ? "Ver gastos do casal"
                            : "Criar nosso espaço"}
                          <UsersRound size={16} />
                        </button>
                        <div className="couple-art" aria-hidden="true">
                          <span />
                          <span />
                        </div>
                      </section>
                      <section className="panel installment-mini">
                        <div>
                          <CreditCard size={18} />
                          <strong>Parcelas pela frente</strong>
                        </div>
                        <span>
                          {formatMoney(forecast[0]?.amountCents ?? 0)}
                        </span>
                        <p>
                          Previstas para{" "}
                          {monthLabel(shiftMonth(month, 1), true)} · consulte os
                          detalhes nos lançamentos.
                        </p>
                      </section>
                    </div>
                  </div>
                </>
              )}

              {tab === "reports" && (
                <ReportsView
                  data={data}
                  month={month}
                  onOpenCouple={() => go("couple")}
                />
              )}
              {tab === "budgets" && (
                <BudgetsView
                  data={data}
                  month={month}
                  busy={busy}
                  onSave={saveBudget}
                  onDelete={removeBudget}
                  onCopy={copyBudgets}
                  onOpenCouple={() => go("couple")}
                />
              )}
              {tab === "calendar" && (
                <CalendarView
                  data={data}
                  month={month}
                  busy={busy}
                  onSave={saveSchedule}
                  onDelete={removeSchedule}
                  onOccurrence={setOccurrence}
                  onOpenCouple={() => go("couple")}
                />
              )}
              {tab === "goals" && (
                <GoalsView
                  data={data}
                  busy={busy}
                  onSave={saveGoal}
                  onDelete={removeGoal}
                  onMovement={addGoalMovement}
                  onOpenCouple={() => go("couple")}
                />
              )}
              {tab === "reserve" && (
                <ReserveView
                  key={`${demo ? "demo" : "real"}:${month}`}
                  data={data}
                  month={month}
                  busy={busy}
                  onSave={saveReservePlan}
                  onReset={resetReservePlan}
                  onNavigate={go}
                />
              )}
              {tab === "transactions" && (
                <section className="panel full-panel">
                  <div className="transactions-toolbar">
                    <div
                      className="scope-tabs"
                      role="group"
                      aria-label="Filtrar lançamentos"
                    >
                      {(
                        [
                          ["all", "Todos"],
                          ["personal", "Pessoais"],
                          ["shared", "Do casal"],
                          ["pending", "Pendências"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          className={scope === value ? "selected" : ""}
                          onClick={() => setScope(value)}
                        >
                          {label}
                          {value === "pending" && summary.pendingCount > 0 && (
                            <span>{summary.pendingCount}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <button
                      className="button secondary small"
                      disabled={!currentRows.length}
                      onClick={() => downloadCSV(currentRows)}
                    >
                      <Download size={16} /> Exportar
                    </button>
                  </div>
                  <div className="filter-row">
                    <label className="search-field">
                      <Search size={18} />
                      <input
                        type="search"
                        placeholder="Buscar estabelecimento ou descrição"
                        aria-label="Buscar lançamentos"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <label className="select-wrap">
                      <select
                        aria-label="Categoria"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                      >
                        <option value="">Todas as categorias</option>
                        {[
                          ...new Set([
                            ...CATEGORIES,
                            ...data.transactions.map((t) => t.category),
                          ]),
                        ]
                          .sort((a, b) => a.localeCompare(b, "pt-BR"))
                          .map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                      </select>
                      <ChevronDown size={15} />
                    </label>
                    <label className="select-wrap">
                      <select
                        aria-label="Conta"
                        value={sourceFilter}
                        onChange={(e) => setSourceFilter(e.target.value)}
                      >
                        <option value="">Todas as contas</option>
                        {data.sources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={15} />
                    </label>
                  </div>
                  {selected.size > 0 && (
                    <div className="selection-bar">
                      <strong>{selected.size} selecionados</strong>
                      <button
                        className="button secondary small"
                        onClick={() => void markSelectedShared()}
                        disabled={busy}
                      >
                        <UsersRound size={15} /> Marcar como casal
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setSelected(new Set())}
                      >
                        Limpar seleção
                      </button>
                    </div>
                  )}
                  <div className="table-labels">
                    <span />
                    <span>DESCRIÇÃO</span>
                    <span>CATEGORIA</span>
                    <span>ORIGEM</span>
                    <span>VALOR</span>
                    <span />
                  </div>
                  {renderRows(currentRows)}
                  <div className="table-footer">
                    <span>{currentRows.length} lançamentos encontrados</span>
                    <span>
                      Gastos no filtro:{" "}
                      <strong>
                        {formatMoney(
                          summarize(currentRows, month).expenseCents,
                        )}
                      </strong>
                    </span>
                  </div>
                </section>
              )}

              {tab === "imports" && (
                <>
                  <div className="import-layout">
                    <section className="panel import-panel">
                      <div className="import-steps">
                        <span
                          className={
                            !preview.length && !importResult
                              ? "current"
                              : "done"
                          }
                        >
                          <b>
                            {preview.length || importResult ? (
                              <Check size={13} />
                            ) : (
                              "1"
                            )}
                          </b>{" "}
                          Arquivos
                        </span>
                        <i />
                        <span
                          className={
                            preview.length
                              ? "current"
                              : importResult
                                ? "done"
                                : ""
                          }
                        >
                          <b>{importResult ? <Check size={13} /> : "2"}</b>{" "}
                          Conferência
                        </span>
                        <i />
                        <span className={importResult ? "current" : ""}>
                          <b>3</b> Pronto
                        </span>
                      </div>
                      {importResult ? (
                        <div className="import-success">
                          <span>
                            <CheckCheck size={38} />
                          </span>
                          <h2>Seu mês ganhou clareza.</h2>
                          <p>
                            <strong>{importResult.imported} lançamentos</strong>{" "}
                            adicionados.
                            {importResult.duplicates > 0
                              ? ` ${importResult.duplicates} repetidos foram ignorados.`
                              : ""}
                          </p>
                          <button
                            className="button primary"
                            onClick={() => go("overview")}
                          >
                            Ver meu mês
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setImportResult(null)}
                          >
                            Importar mais arquivos
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="import-intro">
                            <h2>
                              {preview.length
                                ? "Um último olhar antes de importar."
                                : "Traga os arquivos do seu mês."}
                            </h2>
                            <p>
                              {preview.length
                                ? "Confira os valores. Você pode editar os detalhes ou desmarcar uma linha."
                                : "Selecione extratos de conta, faturas de cartão ou imagens do histórico do benefício."}
                            </p>
                          </div>
                          {!preview.length && (
                            <div
                              className={`dropzone ${busy ? "disabled" : ""}`}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (!busy) selectFiles(e.dataTransfer.files);
                              }}
                            >
                              <div className="upload-symbol">
                                <FileUp size={28} />
                              </div>
                              <strong>
                                Um mês inteiro, em poucos arquivos.
                              </strong>
                              <p>
                                Arraste os arquivos ou selecione no seu
                                dispositivo.
                              </p>
                              <button
                                className="button primary"
                                disabled={busy}
                                onClick={() => fileInput.current?.click()}
                              >
                                <Plus size={17} /> Selecionar arquivos
                              </button>
                              <small>
                                CSV, OFX, PDF, PNG ou JPG · até 15 MB por
                                arquivo
                              </small>
                              <input
                                ref={fileInput}
                                type="file"
                                multiple
                                accept=".csv,.ofx,.qfx,.pdf,.png,.jpg,.jpeg,.webp,.txt"
                                aria-label="Selecionar arquivos de extrato"
                                hidden
                                onChange={(e) => {
                                  selectFiles(e.target.files);
                                  e.target.value = "";
                                }}
                              />
                            </div>
                          )}
                          {!preview.length && files.length > 0 && (
                            <div className="picked-files">
                              {files.map((entry) => (
                                <div className="picked-file" key={entry.id}>
                                  <FileText size={21} />
                                  <div className="picked-file-name">
                                    <strong>{entry.file.name}</strong>
                                    <span>
                                      {(entry.file.size / 1024).toFixed(0)} KB
                                    </span>
                                  </div>
                                  <label className="select-wrap">
                                    <select
                                      aria-label={`Conta de ${entry.file.name}`}
                                      value={entry.sourceId}
                                      onChange={(e) =>
                                        setFiles((old) =>
                                          old.map((f) =>
                                            f.id === entry.id
                                              ? {
                                                  ...f,
                                                  sourceId: e.target.value,
                                                }
                                              : f,
                                          ),
                                        )
                                      }
                                    >
                                      <option value="">Escolha a conta</option>
                                      {data.sources.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.name} ·{" "}
                                          {s.type === "credit"
                                            ? "Crédito"
                                            : s.institution}
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown size={14} />
                                  </label>
                                  <label className="file-month">
                                    <span>
                                      {sourceById(entry.sourceId)?.type ===
                                      "credit"
                                        ? "Mês da fatura"
                                        : "Mês de referência"}
                                    </span>
                                    <input
                                      type="month"
                                      aria-label={`Mês de ${entry.file.name}`}
                                      value={entry.referenceMonth}
                                      onChange={(e) =>
                                        setFiles((old) =>
                                          old.map((f) =>
                                            f.id === entry.id
                                              ? {
                                                  ...f,
                                                  referenceMonth:
                                                    e.target.value,
                                                }
                                              : f,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                  <button
                                    className="icon-button"
                                    aria-label={`Remover ${entry.file.name}`}
                                    disabled={busy}
                                    onClick={() =>
                                      setFiles((old) =>
                                        old.filter((f) => f.id !== entry.id),
                                      )
                                    }
                                  >
                                    <X size={17} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!preview.length && (
                            <div className="import-actions">
                              <button
                                className="text-button"
                                onClick={() => setSourceEditor(null)}
                              >
                                <Plus size={16} /> Adicionar uma conta
                              </button>
                              {files.length > 0 && (
                                <button
                                  className="button primary"
                                  disabled={
                                    busy ||
                                    !data.sources.length ||
                                    files.some((f) => !f.referenceMonth)
                                  }
                                  onClick={() => void readFiles()}
                                >
                                  {busy ? (
                                    <LoaderCircle className="spin" size={17} />
                                  ) : (
                                    <Sparkles size={17} />
                                  )}{" "}
                                  {busy ? "Lendo arquivos…" : "Ler arquivos"}
                                </button>
                              )}
                            </div>
                          )}
                          {progress && (
                            <div className="progress-note" aria-live="polite">
                              <LoaderCircle size={17} className="spin" />
                              {progress}
                            </div>
                          )}
                          {preview.length > 0 && (
                            <>
                              {balanceSuggestions.length > 0 && (
                                <div className="balance-suggestions">
                                  <h3>Encontramos um saldo no arquivo.</h3>
                                  <p>
                                    Você pode usá-lo como ponto de partida para
                                    esta conta. Confira o valor e a data antes
                                    de aplicar.
                                  </p>
                                  {balanceSuggestions.map((b) => (
                                    <label key={b.sourceId}>
                                      <input
                                        type="checkbox"
                                        checked={b.included}
                                        onChange={(e) =>
                                          setBalanceSuggestions((old) =>
                                            old.map((x) =>
                                              x.sourceId === b.sourceId
                                                ? {
                                                    ...x,
                                                    included: e.target.checked,
                                                  }
                                                : x,
                                            ),
                                          )
                                        }
                                      />
                                      <span>
                                        {sourceById(b.sourceId)?.name}:{" "}
                                        <strong>
                                          {formatMoney(b.amountCents)}
                                        </strong>
                                        <small>
                                          Saldo antes dos movimentos de{" "}
                                          {dateLabel(b.date)}.
                                        </small>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              <div className="preview-summary">
                                <div>
                                  <strong>
                                    {
                                      preview.filter(
                                        (r) => r.included && !r.duplicate,
                                      ).length
                                    }
                                  </strong>
                                  <span>novos lançamentos selecionados</span>
                                </div>
                                <div>
                                  <strong>
                                    {formatMoney(
                                      preview
                                        .filter(
                                          (r) =>
                                            r.included &&
                                            !r.duplicate &&
                                            r.kind === "expense",
                                        )
                                        .reduce((s, r) => s + r.amountCents, 0),
                                    )}
                                  </strong>
                                  <span>em despesas</span>
                                </div>
                                <div>
                                  <strong>
                                    {preview.filter((r) => r.duplicate).length}
                                  </strong>
                                  <span>já importados</span>
                                </div>
                              </div>
                              <div className="preview-scroll">
                                <table className="preview-table">
                                  <thead>
                                    <tr>
                                      <th>
                                        <input
                                          type="checkbox"
                                          aria-label="Selecionar todos os novos lançamentos"
                                          checked={preview
                                            .filter((r) => !r.duplicate)
                                            .every((r) => r.included)}
                                          onChange={(e) =>
                                            setPreview((old) =>
                                              old.map((r) => ({
                                                ...r,
                                                included:
                                                  !r.duplicate &&
                                                  e.target.checked,
                                              })),
                                            )
                                          }
                                        />
                                      </th>
                                      <th>Data</th>
                                      <th>Descrição</th>
                                      <th>Categoria</th>
                                      <th>Valor</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {preview.map((row) => (
                                      <tr
                                        key={row.key}
                                        className={
                                          row.duplicate ? "duplicate-row" : ""
                                        }
                                      >
                                        <td>
                                          <input
                                            type="checkbox"
                                            aria-label={`Importar ${row.description}`}
                                            checked={
                                              row.included && !row.duplicate
                                            }
                                            disabled={row.duplicate}
                                            onChange={(e) =>
                                              setPreview((old) =>
                                                old.map((r) =>
                                                  r.key === row.key
                                                    ? {
                                                        ...r,
                                                        included:
                                                          e.target.checked,
                                                      }
                                                    : r,
                                                ),
                                              )
                                            }
                                          />
                                        </td>
                                        <td>{dateLabel(row.date)}</td>
                                        <td>
                                          <strong>{row.description}</strong>
                                          <span>
                                            {sourceById(row.sourceId)?.name}
                                            {row.duplicate
                                              ? " · Já importado"
                                              : row.needsReview
                                                ? " · Revisar"
                                                : ""}
                                          </span>
                                        </td>
                                        <td>{row.category}</td>
                                        <td className="nowrap">
                                          {formatMoney(row.amountCents)}
                                        </td>
                                        <td>
                                          <button
                                            className="icon-button"
                                            aria-label={`Editar prévia ${row.description}`}
                                            onClick={() =>
                                              setTxEditor({
                                                draftKey: row.key,
                                                transaction: {
                                                  ...row,
                                                  id: row.key,
                                                  ownerId: data.user.id,
                                                  ownerName: data.user.name,
                                                  shared: row.shared ?? false,
                                                  note: row.note ?? "",
                                                  importId: null,
                                                },
                                              })
                                            }
                                          >
                                            <Pencil size={15} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="import-actions">
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setPreview([]);
                                    setWarnings([]);
                                  }}
                                >
                                  Voltar aos arquivos
                                </button>
                                <button
                                  className="button primary"
                                  onClick={() => void confirmImport()}
                                  disabled={
                                    busy ||
                                    !preview.some(
                                      (r) => r.included && !r.duplicate,
                                    )
                                  }
                                >
                                  {busy ? (
                                    <LoaderCircle className="spin" size={17} />
                                  ) : (
                                    <Check size={17} />
                                  )}{" "}
                                  Confirmar importação
                                </button>
                              </div>
                            </>
                          )}
                          {warnings.length > 0 && (
                            <details className="import-warnings" open>
                              <summary>
                                <CircleAlert size={17} /> Avisos da leitura (
                                {warnings.length})
                              </summary>
                              <ul>
                                {warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </>
                      )}
                    </section>
                    <aside className="import-help">
                      <div className="panel">
                        <span className="help-icon">
                          <ShieldCheck size={22} />
                        </span>
                        <h3>
                          Você traz os dados.
                          <br />A gente organiza.
                        </h3>
                        <p>
                          O Clara lê os arquivos e sugere categorias. Você
                          confere o resultado antes de salvar.
                        </p>
                        <div className="help-item">
                          <CircleCheck size={17} />
                          <span>Sem conectar sua conta bancária</span>
                        </div>
                        <div className="help-item">
                          <CircleCheck size={17} />
                          <span>Arquivos processados no navegador</span>
                        </div>
                        <div className="help-item">
                          <CircleCheck size={17} />
                          <span>Só os lançamentos confirmados são salvos</span>
                        </div>
                      </div>
                      <div className="template-card">
                        <FileText size={23} />
                        <h3>Prefere uma planilha?</h3>
                        <p>
                          Use nosso modelo CSV para organizar qualquer origem.
                        </p>
                        <a
                          href="/modelo-importacao.csv"
                          download
                          className="text-button"
                        >
                          <Download size={16} /> Baixar modelo CSV
                        </a>
                      </div>
                      <p className="import-tip">
                        <strong>Uma dica:</strong> extrato da conta e fatura do
                        cartão são arquivos diferentes. Importe os dois para
                        incluir as compras no crédito. Para faturas, escolha o
                        mês de cobrança.
                      </p>
                    </aside>
                  </div>
                  <section className="panel history-panel">
                    <PanelTitle
                      title="Histórico de importações"
                      subtitle="Cada atualização do seu mês, guardada aqui"
                    />
                    {data.imports.length ? (
                      <div className="import-history">
                        {data.imports.map((batch) => (
                          <div className="history-row" key={batch.id}>
                            <span className="tx-icon">
                              <FileText size={21} />
                            </span>
                            <div>
                              <strong>{batch.files.join(", ")}</strong>
                              <span>
                                {batch.count} lançamentos ·{" "}
                                {dateLabel(batch.periodStart)} a{" "}
                                {dateLabel(batch.periodEnd)}
                              </span>
                            </div>
                            <span className="history-date">
                              {dateLabel(batch.createdAt.slice(0, 10))}
                            </span>
                            <button
                              className="icon-button"
                              aria-label="Desfazer importação"
                              onClick={() => setUndo(batch)}
                            >
                              <RotateCcw size={17} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-inline">
                        Seu histórico aparecerá depois da primeira importação.
                      </p>
                    )}
                  </section>
                </>
              )}

              {tab === "couple" && (
                <>
                  {!data.couple ? (
                    <div className="couple-onboarding panel">
                      <div className="couple-visual">
                        <span>
                          <Heart size={44} />
                        </span>
                        <span>
                          <UsersRound size={44} />
                        </span>
                      </div>
                      <h2>Um espaço para o que é dos dois.</h2>
                      <p>
                        Compartilhem as despesas da vida em conjunto.
                        <br />
                        Seus gastos pessoais continuam só seus.
                      </p>
                      <div className="couple-connect">
                        <div>
                          <h3>Criar nosso espaço</h3>
                          <p>
                            Gere um código e compartilhe com a outra pessoa.
                          </p>
                          <button
                            className="button primary"
                            onClick={() => void coupleAction("create")}
                            disabled={busy}
                          >
                            <Plus size={17} /> Criar espaço do casal
                          </button>
                        </div>
                        <span>ou</span>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void coupleAction("join");
                          }}
                        >
                          <h3>Já recebeu um convite?</h3>
                          <label className="field-label" htmlFor="join-code">
                            Código do casal
                          </label>
                          <input
                            id="join-code"
                            placeholder="Cole o código aqui"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value)}
                            maxLength={30}
                            required
                          />
                          <button
                            className="button secondary"
                            disabled={busy || !joinCode.trim()}
                          >
                            <Link2 size={17} /> Entrar no espaço
                          </button>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="couple-header-card">
                        <div className="couple-avatars">
                          {data.couple.members.map((m, i) => (
                            <span key={m.id} style={{ zIndex: 2 - i }}>
                              {m.name.slice(0, 1).toUpperCase()}
                            </span>
                          ))}
                          {data.couple.members.length < 2 && (
                            <span>
                              <Plus size={20} />
                            </span>
                          )}
                        </div>
                        <div>
                          <h2>
                            {data.couple.members.length === 2
                              ? data.couple.members
                                  .map((m) =>
                                    m.id === data.user.id
                                      ? "Você"
                                      : m.name.split(" ")[0],
                                  )
                                  .join(" & ")
                              : "Seu espaço está pronto."}
                          </h2>
                          <p>
                            {data.couple.members.length === 2
                              ? "Cada um com seu espaço. Os dois olhando para a mesma vida."
                              : "Falta convidar quem divide a vida com você."}
                          </p>
                        </div>
                        <span className="privacy-badge">
                          <ShieldCheck size={15} /> Pessoal continua privado
                        </span>
                      </div>
                      {data.couple.members.length < 2 && (
                        <section className="panel invite-panel">
                          <div>
                            <h3>Convide sua pessoa</h3>
                            <p>
                              O código conecta vocês dentro do Clara. A outra
                              pessoa também precisa ter acesso a este site.
                            </p>
                          </div>
                          {invite ? (
                            <div className="invite-code">
                              <code>{invite}</code>
                              <button
                                className="icon-button"
                                aria-label="Copiar código"
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(invite)
                                    .then(() => setToast("Código copiado."))
                                    .catch(handleError)
                                }
                              >
                                <Copy size={18} />
                              </button>
                              <small>Válido por 7 dias</small>
                            </div>
                          ) : (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => void coupleAction("create")}
                            >
                              <Link2 size={16} /> Gerar código de convite
                            </button>
                          )}
                        </section>
                      )}
                      <div className="couple-metrics">
                        <Metric
                          title="Gastos compartilhados"
                          value={coupleSummary.expenseCents}
                          icon={<UsersRound size={19} />}
                          foot={`${coupleSummary.count} lançamentos neste mês`}
                        />
                        {data.couple.members.map((member) => (
                          <Metric
                            key={member.id}
                            title={`Pago por ${member.id === data.user.id ? "você" : member.name.split(" ")[0]}`}
                            value={
                              summarize(
                                coupleTransactions.filter(
                                  (t) => t.ownerId === member.id,
                                ),
                                month,
                              ).expenseCents
                            }
                            icon={<Wallet size={18} />}
                            foot="Despesas marcadas como casal"
                          />
                        ))}
                      </div>
                      <section className="panel">
                        <PanelTitle
                          title="Os gastos de vocês"
                          subtitle="Compartilhados manualmente, visíveis para os dois"
                          action={
                            <button
                              className="text-button"
                              onClick={() => {
                                setScope("all");
                                go("transactions");
                              }}
                            >
                              Selecionar meus gastos
                            </button>
                          }
                        />
                        {renderRows(
                          transactionsForMonth(coupleTransactions, month).sort(
                            (a, b) => b.date.localeCompare(a.date),
                          ),
                          true,
                        )}
                      </section>
                      <div className="couple-footer">
                        <ShieldCheck size={17} />
                        <p>
                          Vocês veem os gastos compartilhados e quem pagou. Os
                          saldos, arquivos e demais lançamentos de cada pessoa
                          permanecem privados.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}

              {tab === "sources" && (
                <>
                  <div className="sources-summary panel">
                    <div>
                      <span className="eyebrow">SEU TOTAL, COM CLAREZA</span>
                      <h2>{formatMoney(balance.totalCents)}</h2>
                      <p>
                        Contas e benefícios até {monthLabel(month, true)}. Os
                        cartões aparecem como origem dos gastos.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setBalanceOpen(true)}
                    >
                      <Eye size={17} /> Ver composição
                    </button>
                  </div>
                  <div className="sources-grid">
                    {data.sources.map((source) => {
                      const sourceBalance = balance.items.find(
                        (x) => x.source.id === source.id,
                      );
                      const spend = summarize(
                        data.transactions.filter(
                          (t) => t.sourceId === source.id,
                        ),
                        month,
                      ).expenseCents;
                      return (
                        <section className="panel source-card" key={source.id}>
                          <div className="source-card-head">
                            <span
                              className="bank-avatar"
                              style={{
                                background:
                                  bankColors[source.institution] ?? "#476958",
                              }}
                            >
                              {source.institution === "Sólides" ? (
                                <ShoppingBasket size={22} />
                              ) : (
                                source.institution.slice(0, 2).toLowerCase()
                              )}
                            </span>
                            <div>
                              <h3>{source.name}</h3>
                              <p>
                                {source.institution} ·{" "}
                                {source.type === "credit"
                                  ? "Cartão de crédito"
                                  : source.type === "benefit"
                                    ? "Benefício"
                                    : "Conta bancária"}
                              </p>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`Editar conta ${source.name}`}
                              onClick={() => setSourceEditor(source)}
                            >
                              <MoreHorizontal size={19} />
                            </button>
                          </div>
                          <span className="source-balance-label">
                            {source.type === "credit"
                              ? "Gastos no mês"
                              : "Saldo no período"}
                          </span>
                          <strong className="source-balance">
                            {formatMoney(
                              source.type === "credit"
                                ? spend
                                : (sourceBalance?.balanceCents ?? 0),
                            )}
                          </strong>
                          <div className="source-card-footer">
                            <span>
                              {source.type === "credit" ? (
                                <>
                                  <CreditCard size={14} /> Compras por mês da
                                  fatura
                                </>
                              ) : source.hasOpeningBalance ? (
                                <>
                                  <CircleCheck size={14} /> Saldo de partida
                                  informado
                                </>
                              ) : (
                                <>
                                  <CircleAlert size={14} /> Saldo de partida
                                  pendente
                                </>
                              )}
                            </span>
                            <button
                              className="text-button"
                              onClick={() => {
                                setSourceFilter(source.id);
                                go("transactions");
                              }}
                            >
                              Ver lançamentos
                            </button>
                          </div>
                        </section>
                      );
                    })}
                    <button
                      className="add-source-card"
                      onClick={() => setSourceEditor(null)}
                    >
                      <span>
                        <Plus size={26} />
                      </span>
                      <strong>Adicionar uma origem</strong>
                      <p>Conta, cartão ou benefício</p>
                    </button>
                  </div>
                  {(data.rules ?? []).length > 0 && (
                    <section className="panel rules-panel">
                      <PanelTitle
                        title="Categorias que você ensinou"
                        subtitle="Estas regras são aplicadas nas suas próximas importações."
                      />
                      <div className="import-history">
                        {(data.rules ?? []).map((rule) => (
                          <div className="history-row" key={rule.id}>
                            <span className="tx-icon">
                              <Sparkles size={19} />
                            </span>
                            <div>
                              <strong>{rule.description}</strong>
                              <span>{rule.category}</span>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`Remover regra de ${rule.description}`}
                              onClick={() => void removeRule(rule.id)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  <div className="notice">
                    <ShieldCheck size={19} />
                    <p>
                      Adicionar uma conta serve para organizar os arquivos. O
                      Clara não solicita sua senha bancária nem acessa seu
                      banco.
                    </p>
                  </div>
                </>
              )}
              <footer className="page-footer">
                <span>
                  <img src="/favicon.svg" alt="" width="18" height="18" />{" "}
                  Clara. Um pouco mais de clareza, todo mês.
                </span>
                <span>Os números refletem os arquivos importados.</span>
              </footer>
            </>
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navegação no celular">
        {mobilePrimaryTabs
          .map((id) => nav.find((item) => item.id === id)!)
          .map((item) => (
            <button
              aria-label={item.label}
              aria-current={tab === item.id ? "page" : undefined}
              key={item.id}
              onClick={() => go(item.id)}
              className={tab === item.id ? "active" : ""}
            >
              <item.icon size={21} />
              <span>{item.short}</span>
            </button>
          ))}
        <button
          aria-label="Mais opções"
          aria-current={!mobilePrimaryTabs.includes(tab) ? "page" : undefined}
          className={!mobilePrimaryTabs.includes(tab) ? "active" : ""}
          onClick={() => setMobileMenu(true)}
        >
          <MoreHorizontal size={22} />
          <span>Mais</span>
        </button>
      </nav>
      {mobileMenu && (
        <Modal title="Explorar o Clara" onClose={() => setMobileMenu(false)}>
          <nav className="mobile-menu-list" aria-label="Todas as seções">
            {nav.map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                aria-current={tab === item.id ? "page" : undefined}
                className={tab === item.id ? "active" : ""}
                onClick={() => go(item.id)}
              >
                <item.icon size={21} />
                <span>{item.label}</span>
                {tab === item.id && <Check size={17} />}
              </button>
            ))}
          </nav>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Fechar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {sourceEditor !== false && (
        <Modal
          title={sourceEditor ? "Editar conta" : "Adicionar conta"}
          onClose={() => !busy && setSourceEditor(false)}
        >
          <SourceForm
            source={sourceEditor}
            month={month}
            busy={busy}
            onSave={saveSource}
            onCancel={() => setSourceEditor(false)}
          />
        </Modal>
      )}
      {txEditor && (
        <Modal
          title={
            txEditor.draftKey ? "Conferir lançamento" : "Editar lançamento"
          }
          onClose={() => !busy && setTxEditor(null)}
        >
          <TransactionForm
            transaction={txEditor.transaction}
            canShare={!!data.couple}
            canRemember={!txEditor.draftKey}
            busy={busy}
            onSave={saveTransaction}
            onCancel={() => setTxEditor(null)}
          />
        </Modal>
      )}
      {balanceOpen && (
        <Modal
          title="Composição do saldo"
          onClose={() => setBalanceOpen(false)}
        >
          <p className="modal-intro">
            Contas e benefícios no período de {monthLabel(month)}.
          </p>
          <div className="balance-total">{formatMoney(balance.totalCents)}</div>
          {balance.items.map((item) => (
            <div key={item.source.id} className="balance-row">
              <span
                className="bank-avatar small-bank"
                style={{
                  background: bankColors[item.source.institution] ?? "#476958",
                }}
              >
                {item.source.institution.slice(0, 1)}
              </span>
              <div>
                <strong>{item.source.name}</strong>
                <span>
                  {item.source.institution}
                  {!item.complete ? " · saldo parcial" : ""}
                </span>
              </div>
              <strong>{formatMoney(item.balanceCents)}</strong>
            </div>
          ))}
          {!balance.items.length && (
            <p>Adicione uma conta ou benefício para começar.</p>
          )}
          <div className="notice">
            <CircleAlert size={17} />
            <p>
              O benefício faz parte deste total e continua sujeito às categorias
              permitidas pelo cartão. Cartões de crédito não somam saldo
              disponível.
            </p>
          </div>
          <button
            className="button primary wide"
            onClick={() => {
              setBalanceOpen(false);
              go("sources");
            }}
          >
            Gerenciar contas e saldos
          </button>
        </Modal>
      )}
      {undo && (
        <Modal
          title="Desfazer importação?"
          onClose={() => !busy && setUndo(null)}
        >
          <p className="modal-intro">
            Os {undo.count} lançamentos deste lote serão removidos, incluindo as
            correções feitas neles. Seus outros arquivos permanecem no
            histórico.
          </p>
          <div className="notice">
            <FileText size={19} />
            <span>{undo.files.join(", ")}</span>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setUndo(null)}>
              Manter importação
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void undoImport()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RotateCcw size={16} />
              )}{" "}
              Desfazer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Metric({
  title,
  value,
  icon,
  foot,
  tone,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  foot: string;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        <span>{title}</span>
        <span className={`metric-icon ${tone ?? ""}`}>{icon}</span>
      </div>
      <strong className={`metric-value ${tone === "red" ? "negative" : ""}`}>
        {formatMoney(value)}
      </strong>
      <span className="metric-foot">{foot}</span>
    </div>
  );
}
function PanelTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function FlowChart({
  series,
  month,
  onMonth,
}: {
  series: ReturnType<typeof monthlySeries>;
  month: string;
  onMonth: (m: string) => void;
}) {
  const max = Math.max(
    100,
    ...series.flatMap((s) => [s.incomeCents, s.expenseCents]),
  );
  const scale = Math.ceil(max / 100000) * 100000;
  return (
    <div className="flow-chart">
      <div className="chart-y">
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <span key={f}>
            {scale * f >= 100000
              ? `${((scale * f) / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
              : formatMoney(Math.round(scale * f))
                  .replace("R$", "")
                  .trim()}
          </span>
        ))}
      </div>
      <div className="bars-area">
        <div className="chart-grid" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} />
          ))}
        </div>
        <div className="bars">
          {series.map((s) => (
            <button
              key={s.month}
              className={`bar-group ${s.month === month ? "selected-month" : ""}`}
              onClick={() => onMonth(s.month)}
              aria-label={`${monthLabel(s.month)}: entradas ${formatMoney(s.incomeCents)}, gastos ${formatMoney(s.expenseCents)}`}
              title={`Entradas: ${formatMoney(s.incomeCents)}\nGastos: ${formatMoney(s.expenseCents)}`}
            >
              <span className="bar-pair">
                <i
                  className="income-bar"
                  style={{
                    height: `${Math.max(1, (s.incomeCents / scale) * 100)}%`,
                  }}
                />
                <i
                  className="expense-bar"
                  style={{
                    height: `${Math.max(1, (s.expenseCents / scale) * 100)}%`,
                  }}
                />
              </span>
              <span className="bar-month">
                {monthLabel(s.month, true).split(" ")[0].replace(".", "")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
function CategoryChart({
  categories,
  total,
}: {
  categories: ReturnType<typeof categoryBreakdown>;
  total: number;
}) {
  const positives = categories.filter((c) => c.amountCents > 0);
  const top = positives.slice(0, 4);
  if (positives.length > 4)
    top.push({
      category: "Demais categorias",
      amountCents: positives.slice(4).reduce((s, c) => s + c.amountCents, 0),
      count: positives.slice(4).reduce((s, c) => s + c.count, 0),
    });
  const sum = top.reduce((s, c) => s + c.amountCents, 0);
  let acc = 0;
  const segments = top.map((c, i) => {
    const start = acc;
    acc += (c.amountCents / Math.max(1, sum)) * 100;
    return `${categoryColors[i]} ${start}% ${acc}%`;
  });
  return (
    <div className="category-content">
      <div
        className="donut"
        style={{
          background: sum ? `conic-gradient(${segments.join(",")})` : "#edf1ef",
        }}
        role="img"
        aria-label={`Gastos por categoria. Total ${formatMoney(total)}`}
      >
        <div>
          <span>Gastos no mês</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      </div>
      <div className="category-legend">
        {top.length ? (
          top.map((c, i) => (
            <div key={c.category}>
              <span>
                <i style={{ background: categoryColors[i] }} />
                {c.category}
              </span>
              <strong>{Math.round((c.amountCents / sum) * 100)}%</strong>
            </div>
          ))
        ) : (
          <p>Suas categorias aparecerão após a importação.</p>
        )}
      </div>
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = focusables(),
          first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header>
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Fechar janela"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function SourceForm({
  source,
  month,
  busy,
  onSave,
  onCancel,
}: {
  source: Source | null;
  month: string;
  busy: boolean;
  onSave: (s: Omit<Source, "id" | "ownerId">) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(source?.name ?? "");
  const [institution, setInstitution] = useState(
    source?.institution ?? "Nubank",
  );
  const [type, setType] = useState<SourceType>(source?.type ?? "bank");
  const [value, setValue] = useState(
    source?.hasOpeningBalance ? String(source.initialBalanceCents / 100) : "",
  );
  const [date, setDate] = useState(source?.balanceDate ?? `${month}-01`);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          setError("");
          void onSave({
            name: name.trim(),
            institution: institution.trim(),
            type,
            initialBalanceCents:
              type === "credit" ? 0 : value.trim() ? moneyInput(value) : 0,
            balanceDate: date,
            hasOpeningBalance: type === "credit" || value.trim() !== "",
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="modal-intro">
        Identifique a origem dos arquivos. Nenhuma conexão com seu banco será
        feita.
      </p>
      <label className="field-label" htmlFor="source-name">
        Nome da conta
      </label>
      <input
        id="source-name"
        placeholder="Ex.: Minha conta Nubank"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="source-bank">
            Instituição
          </label>
          <input
            id="source-bank"
            list="institutions"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            required
            maxLength={60}
          />
          <datalist id="institutions">
            {["Nubank", "Sicredi", "Mercado Pago", "PicPay", "Sólides"].map(
              (i) => (
                <option key={i}>{i}</option>
              ),
            )}
          </datalist>
        </div>
        <div>
          <label className="field-label" htmlFor="source-type">
            Tipo
          </label>
          <div className="select-wrap">
            <select
              id="source-type"
              value={type}
              onChange={(e) => setType(e.target.value as SourceType)}
            >
              <option value="bank">Conta bancária</option>
              <option value="credit">Cartão de crédito</option>
              <option value="benefit">Benefício / vale</option>
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
      </div>
      {type !== "credit" && (
        <>
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="source-balance">
                Saldo de partida (R$)
              </label>
              <input
                id="source-balance"
                placeholder="Ex.: 1.250,00"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="source-date">
                Data do saldo de partida
              </label>
              <input
                id="source-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="field-help">
            Informe o saldo antes dos movimentos dessa data. Se deixar em
            branco, o total será indicado como parcial até você completar.
          </p>
        </>
      )}
      {type === "credit" && (
        <p className="field-help">
          O cartão organiza as compras e parcelas. O pagamento da fatura deve
          vir no extrato da conta de onde saiu o dinheiro.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </button>
        <button
          className="button primary"
          disabled={busy || !name.trim() || !institution.trim()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}{" "}
          Salvar conta
        </button>
      </div>
    </form>
  );
}
function TransactionForm({
  transaction: t,
  canShare,
  canRemember,
  busy,
  onSave,
  onCancel,
}: {
  transaction: Transaction;
  canShare: boolean;
  canRemember: boolean;
  busy: boolean;
  onSave: (
    patch: Partial<Transaction>,
    rememberCategory?: boolean,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(t.description);
  const [date, setDate] = useState(t.date);
  const [amount, setAmount] = useState(
    String(t.amountCents / 100).replace(".", ","),
  );
  const [kind, setKind] = useState(t.kind);
  const [category, setCategory] = useState(t.category);
  const [shared, setShared] = useState(t.shared);
  const [note, setNote] = useState(t.note);
  const [current, setCurrent] = useState(
    t.installmentCurrent ? String(t.installmentCurrent) : "",
  );
  const [total, setTotal] = useState(
    t.installmentTotal ? String(t.installmentTotal) : "",
  );
  const [reviewed, setReviewed] = useState(!t.needsReview);
  const [rememberCategory, setRememberCategory] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const cents = moneyInput(amount);
          if (cents <= 0) throw new Error("Informe um valor maior que zero.");
          const n = Number(current),
            nt = Number(total);
          if (
            (current || total) &&
            (!Number.isInteger(n) ||
              !Number.isInteger(nt) ||
              n < 1 ||
              nt < n ||
              nt > 120)
          )
            throw new Error("Confira a parcela atual e o total de parcelas.");
          void onSave(
            {
              description: description.trim(),
              date,
              amountCents: cents,
              kind,
              category: category.trim(),
              shared,
              note,
              needsReview: !reviewed,
              installmentCurrent: current ? n : null,
              installmentTotal: total ? nt : null,
            },
            rememberCategory,
          );
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label className="field-label" htmlFor="tx-description">
        Descrição
      </label>
      <input
        id="tx-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
        maxLength={200}
      />
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="tx-date">
            Data
          </label>
          <input
            id="tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="tx-amount">
            Valor (R$)
          </label>
          <input
            id="tx-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="tx-kind">
            Movimento
          </label>
          <div className="select-wrap">
            <select
              id="tx-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as TransactionKind)}
            >
              {Object.entries(KIND_LABELS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="tx-category">
            Categoria
          </label>
          <input
            id="tx-category"
            list="category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            maxLength={100}
          />
          <datalist id="category-options">
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </datalist>
        </div>
      </div>
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="tx-current">
            Parcela atual
          </label>
          <input
            id="tx-current"
            inputMode="numeric"
            type="number"
            min="1"
            max="120"
            placeholder="Opcional"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="tx-total">
            Total de parcelas
          </label>
          <input
            id="tx-total"
            inputMode="numeric"
            type="number"
            min="1"
            max="120"
            placeholder="Opcional"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </div>
      </div>
      <label className="field-label" htmlFor="tx-note">
        Observação
      </label>
      <textarea
        id="tx-note"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
      />
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={shared}
          disabled={!canShare}
          onChange={(e) => setShared(e.target.checked)}
        />
        <span>
          Este gasto é do casal
          {!canShare && (
            <small>Conecte o casal em Nosso espaço para compartilhar.</small>
          )}
        </span>
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        <span>Conferi este lançamento</span>
      </label>
      {canRemember && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={rememberCategory}
            onChange={(e) => setRememberCategory(e.target.checked)}
          />
          <span>
            Usar esta categoria nas próximas compras deste estabelecimento
            <small>Você pode remover a regra em Contas e saldos.</small>
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}{" "}
          Salvar lançamento
        </button>
      </div>
    </form>
  );
}
