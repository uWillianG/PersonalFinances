import type { PlanScope } from "./planning-types";

export interface SavingsGoal {
  id: string;
  ownerId: string;
  ownerName: string;
  scope: PlanScope;
  name: string;
  targetCents: number;
  targetDate: string | null;
  archived: boolean;
  canEdit: boolean;
}
export type GoalInput = Pick<
  SavingsGoal,
  "scope" | "name" | "targetCents" | "targetDate" | "archived"
>;
export type GoalPatch = Partial<Omit<GoalInput, "scope">>;
export interface GoalMovement {
  id: string;
  goalId: string;
  ownerId: string;
  ownerName: string;
  kind: "deposit" | "withdrawal";
  amountCents: number;
  date: string;
  note: string;
  createdAt: string;
}
export type GoalMovementInput = Pick<
  GoalMovement,
  "id" | "kind" | "amountCents" | "date" | "note"
>;
