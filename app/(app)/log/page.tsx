import type { Metadata } from "next";
import { CoachChat } from "@/components/coach/CoachChat";

export const metadata: Metadata = { title: "Log a mistake · Study Coach" };

export default function LogPage() {
  return <CoachChat mode="log" />;
}
