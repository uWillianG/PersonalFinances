import { api } from "@/lib/server";
import { deleteInvoicePayment } from "@/lib/invoice-server";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return api(request, (context) => deleteInvoicePayment(context, id));
}
