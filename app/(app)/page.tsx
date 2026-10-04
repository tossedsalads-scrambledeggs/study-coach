import type { Metadata } from "next";
import { TodayView } from "@/components/coach/TodayView";

export const metadata: Metadata = { title: "Today · Study Coach" };

export default function TodayPage() {
  return <TodayView />;
}
