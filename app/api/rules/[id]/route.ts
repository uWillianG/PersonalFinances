import { api, deleteCategoryRule } from "@/lib/server";
export async function DELETE(request:Request, {params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  return api(request,context=>deleteCategoryRule(context,id));
}
