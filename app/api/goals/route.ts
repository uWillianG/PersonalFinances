import { api } from "@/lib/server";
import { createGoal } from "@/lib/goals-server";

export async function POST(request: Request) {
  return api(request, (context) => createGoal(context, request), 201);
}
