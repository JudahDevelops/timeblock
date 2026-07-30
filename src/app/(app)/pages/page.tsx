import { redirect } from "next/navigation";

import { requireUser } from "@/server/auth";
import { getPages } from "@/server/queries/pages";

import { PagesList } from "./pages-list";

export default async function PagesPage() {
  let userId: string;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch {
    redirect("/login");
  }

  const pages = await getPages(userId);

  return <PagesList pages={pages} />;
}
