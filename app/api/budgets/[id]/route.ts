import { api } from "@/lib/server";
import { deleteBudget, updateBudget } from "@/lib/planning-server";

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => updateBudget(context, request, id));
}

export async function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => deleteBudget(context, id));
}
