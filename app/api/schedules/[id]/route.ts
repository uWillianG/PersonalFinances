import { api } from "@/lib/server";
import { deleteSchedule, updateSchedule } from "@/lib/planning-server";

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => updateSchedule(context, request, id));
}

export async function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => deleteSchedule(context, id));
}
