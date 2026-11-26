export interface ReservePlanInput {
  month: string;
  minimumBalanceCents: number;
  extraExpenseCents: number;
  cardReserveCents: number | null;
  goalReserveCents: number | null;
  sharedCommitmentCents: number | null;
}
export interface ReservePlan extends ReservePlanInput {
  id: string;
  ownerId: string;
}
export interface ReserveIssue {
  code: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "blocking";
}
export interface ReserveEstimate {
  month: string;
  asOf: string;
  future: boolean;
  incomeCents: number;
  expenseCents: number;
  benefitIncomeCents: number;
  bankBalanceCents: number;
  balanceComplete: boolean;
  personalProvisionCents: number;
  sharedProvisionCents: number;
  appliedSharedCents: number;
  extraExpenseCents: number;
  pendingIncomeCents: number;
  cardSpendingCents: number;
  cardReserveCents: number;
  defaultGoalReserveCents: number;
  goalReserveCents: number;
  goalContributionsCents: number;
  minimumBalanceCents: number;
  monthlyMarginCents: number;
  cashCapacityCents: number;
  suggestedCents: number | null;
  issues: ReserveIssue[];
  nextInstallments: { month: string; amountCents: number }[];
}
export function defaultReservePlan(month: string): ReservePlanInput {
  return {
    month,
    minimumBalanceCents: 0,
    extraExpenseCents: 0,
    cardReserveCents: null,
    goalReserveCents: null,
    sharedCommitmentCents: null,
  };
}
