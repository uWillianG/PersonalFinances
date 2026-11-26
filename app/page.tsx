import FinanceApp from "./finance-app";
import { getChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <FinanceApp signedIn={!!user} displayName={user?.displayName ?? "Você"} />
  );
}
