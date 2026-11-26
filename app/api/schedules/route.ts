import { api } from "@/lib/server";
import { createSchedule } from "@/lib/planning-server";

export async function POST(request: Request) {
  return api(request, (context) => createSchedule(context, request), 201);
}
