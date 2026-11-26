import { api, saveCategoryRule } from "@/lib/server";
export async function POST(request: Request) { return api(request, context=>saveCategoryRule(context,request)); }
