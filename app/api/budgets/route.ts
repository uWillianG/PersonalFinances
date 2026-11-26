import { api } from "@/lib/server";
import { saveBudget } from "@/lib/planning-server";

export async function POST(request: Request) {
  return api(request, (context) => saveBudget(context, request), 201);
}
