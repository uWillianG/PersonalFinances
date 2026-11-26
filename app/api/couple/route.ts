import { api, updateCouple } from "@/lib/server";

export async function POST(request: Request) { return api(request, (context) => updateCouple(context, request)); }
