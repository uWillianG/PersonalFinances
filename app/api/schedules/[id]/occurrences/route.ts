import { api } from "@/lib/server";
import { saveOccurrence } from "@/lib/planning-server";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return api(request, (context) => saveOccurrence(context, request, id));
}
