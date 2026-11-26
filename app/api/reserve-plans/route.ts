import { api } from "@/lib/server";
import { saveReservePlan } from "@/lib/reserve-server";

export async function POST(request: Request) {
  return api(request, (context) => saveReservePlan(context, request), 201);
}
