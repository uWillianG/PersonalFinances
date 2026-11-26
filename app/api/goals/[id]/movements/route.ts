import { api } from "@/lib/server";
import { addGoalMovement } from "@/lib/goals-server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return api(request, (context) => addGoalMovement(context, id, request), 201);
}
