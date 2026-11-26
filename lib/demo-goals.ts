import type { SavingsGoal, GoalMovement } from "./goals-types";

export function demoGoals(
  month: string,
  ownerId: string,
): { goals: SavingsGoal[]; goalMovements: GoalMovement[] } {
  const year = Number(month.slice(0, 4));
  const goals: SavingsGoal[] = [
    {
      id: "demo-goal-reserva",
      ownerId,
      ownerName: "Você",
      scope: "personal",
      name: "Reserva de emergência",
      targetCents: 1500000,
      targetDate: `${year + 1}-12-31`,
      archived: false,
      canEdit: true,
    },
    {
      id: "demo-goal-notebook",
      ownerId,
      ownerName: "Você",
      scope: "personal",
      name: "Novo notebook",
      targetCents: 600000,
      targetDate: null,
      archived: false,
      canEdit: true,
    },
    {
      id: "demo-goal-viagem",
      ownerId,
      ownerName: "Você",
      scope: "couple",
      name: "Nossa próxima viagem",
      targetCents: 800000,
      targetDate: `${year + 1}-07-01`,
      archived: false,
      canEdit: true,
    },
  ];
  const start = `${month}-01`;
  const goalMovements: GoalMovement[] = [
    {
      id: "demo-goal-m1",
      goalId: goals[0].id,
      ownerId,
      ownerName: "Você",
      kind: "deposit",
      amountCents: 450000,
      date: start,
      note: "Reserva já separada",
      createdAt: `${start}T12:00:00.000Z`,
    },
    {
      id: "demo-goal-m2",
      goalId: goals[1].id,
      ownerId,
      ownerName: "Você",
      kind: "deposit",
      amountCents: 180000,
      date: start,
      note: "Primeiro aporte",
      createdAt: `${start}T12:01:00.000Z`,
    },
    {
      id: "demo-goal-m3",
      goalId: goals[2].id,
      ownerId,
      ownerName: "Você",
      kind: "deposit",
      amountCents: 150000,
      date: start,
      note: "Para as férias",
      createdAt: `${start}T12:02:00.000Z`,
    },
    {
      id: "demo-goal-m4",
      goalId: goals[2].id,
      ownerId: "demo-parceira",
      ownerName: "Alex",
      kind: "deposit",
      amountCents: 120000,
      date: start,
      note: "Nossa viagem",
      createdAt: `${start}T12:03:00.000Z`,
    },
  ];
  return { goals, goalMovements };
}
