import { api, createSource } from "@/lib/server";

export async function POST(request: Request) { return api(request, (context) => createSource(context, request), 201); }
