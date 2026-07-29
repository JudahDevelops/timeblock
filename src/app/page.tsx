import { redirect } from "next/navigation";

import { toDateParam } from "@/lib/date";

export default function Home() {
  redirect(`/calendar/week/${toDateParam(new Date())}`);
}
