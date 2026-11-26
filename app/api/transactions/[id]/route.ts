import { api, updateTransaction } from "@/lib/server";

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => updateTransaction(context, request, id));
}
