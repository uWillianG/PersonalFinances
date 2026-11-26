import { api } from "@/lib/server";
import { saveInvoicePayment } from "@/lib/invoice-server";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return api(
    request,
    (context) => saveInvoicePayment(context, id, request),
    201,
  );
}
