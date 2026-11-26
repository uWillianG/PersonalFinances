import { api } from "@/lib/server";
import { saveInvoice } from "@/lib/invoice-server";
export async function POST(request: Request) {
  return api(request, (context) => saveInvoice(context, request), 201);
}
