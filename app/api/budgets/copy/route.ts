import { api } from "@/lib/server";
import { copyBudgets } from "@/lib/planning-server";

export async function POST(request: Request) {
  return api(request, (context) => copyBudgets(context, request));
}
