import { api } from "@/lib/server";
import { saveCardCycle } from "@/lib/invoice-server";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return api(request, (context) => saveCardCycle(context, id, request));
}
