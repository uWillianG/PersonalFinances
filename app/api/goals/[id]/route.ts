import { api } from "@/lib/server";
import { deleteGoal, updateGoal } from "@/lib/goals-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return api(request, (context) => updateGoal(context, id, request));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return api(request, (context) => deleteGoal(context, id));
}
