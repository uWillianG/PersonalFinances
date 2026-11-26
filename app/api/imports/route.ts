import { api, createImport } from "@/lib/server";

export async function POST(request: Request) { return api(request, (context) => createImport(context, request), 201); }
