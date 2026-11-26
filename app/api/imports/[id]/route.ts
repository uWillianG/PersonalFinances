import { api, deleteImport } from "@/lib/server";

export async function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => deleteImport(context, id));
}
