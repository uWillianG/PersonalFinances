import { api } from "@/lib/server";
import { deleteReservePlan } from "@/lib/reserve-server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  return api(request, (context) => deleteReservePlan(context, month));
}
