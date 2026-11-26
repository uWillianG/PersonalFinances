import type { TransactionKind } from "./types";

export type PlanScope = "personal" | "couple";
export type ReportScope = "mine" | "personal" | "couple";
export interface BudgetLimit {
  id: string;
  ownerId: string;
  ownerName: string;
  scope: PlanScope;
  month: string;
  category: string;
  limitCents: number;
  canEdit: boolean;
}
export type ScheduleKind = Extract<
  TransactionKind,
  "income" | "expense" | "card_payment"
>;
export type ScheduleFrequency = "weekly" | "monthly" | "yearly";
export interface RecurringSchedule {
  id: string;
  ownerId: string;
  ownerName: string;
  scope: PlanScope;
  name: string;
  kind: ScheduleKind;
  category: string;
  amountCents: number;
  frequency: ScheduleFrequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
  canEdit: boolean;
}
export interface ScheduleOccurrence {
  id: string;
  scheduleId: string;
  dueDate: string;
  state: "confirmed" | "linked" | "skipped";
  transactionId: string | null;
  confirmedBy: string;
}
export type BudgetInput = Pick<
  BudgetLimit,
  "scope" | "month" | "category" | "limitCents"
>;
export type ScheduleInput = Pick<
  RecurringSchedule,
  | "scope"
  | "name"
  | "kind"
  | "category"
  | "amountCents"
  | "frequency"
  | "startDate"
  | "endDate"
  | "active"
>;
