import type {
  BudgetLimit,
  RecurringSchedule,
  ScheduleOccurrence,
} from "./planning-types";
export type SourceType = "bank" | "credit" | "benefit";
export type TransactionKind =
  | "income"
  | "expense"
  | "transfer_in"
  | "transfer_out"
  | "card_payment"
  | "refund";
export interface Source {
  id: string;
  ownerId: string;
  name: string;
  institution: string;
  type: SourceType;
  initialBalanceCents: number;
  balanceDate: string;
  hasOpeningBalance: boolean;
}
export interface Transaction {
  id: string;
  ownerId: string;
  ownerName: string;
  sourceId: string;
  date: string;
  description: string;
  amountCents: number;
  kind: TransactionKind;
  category: string;
  shared: boolean;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  needsReview: boolean;
  note: string;
  importId: string | null;
  fingerprint: string;
}
export interface DraftTransaction {
  date: string;
  description: string;
  amountCents: number;
  kind: TransactionKind;
  category: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  needsReview: boolean;
  externalId?: string;
  fingerprint: string;
  sourceId?: string;
  fileName?: string;
  shared?: boolean;
  note?: string;
}
export interface ImportBatch {
  id: string;
  createdAt: string;
  files: string[];
  count: number;
  incomeCents: number;
  expenseCents: number;
  periodStart: string;
  periodEnd: string;
}
export interface Couple {
  id: string;
  members: { id: string; name: string }[];
}
export interface AppState {
  user: { id: string; name: string; email: string };
  sources: Source[];
  transactions: Transaction[];
  partnerTransactions: Transaction[];
  imports: ImportBatch[];
  couple: Couple | null;
  rules?: CategoryRule[];
  budgets?: BudgetLimit[];
  schedules?: RecurringSchedule[];
  occurrences?: ScheduleOccurrence[];
}
export interface CategoryRule {
  id: string;
  description: string;
  key: string;
  category: string;
}
export const CATEGORIES = [
  "Alimentação",
  "Mercado",
  "Moradia",
  "Transporte",
  "Saúde",
  "Compras",
  "Lazer",
  "Assinaturas",
  "Educação",
  "Serviços",
  "Salário",
  "Benefícios",
  "Outras entradas",
  "Transferências",
  "Fatura",
  "Estornos",
  "Outros",
] as const;
export const KIND_LABELS: Record<TransactionKind, string> = {
  income: "Entrada",
  expense: "Despesa",
  transfer_in: "Transferência recebida",
  transfer_out: "Transferência enviada",
  card_payment: "Pagamento de fatura",
  refund: "Estorno",
};
