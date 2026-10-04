import type { Metadata } from "next";
import { CoachChat } from "@/components/coach/CoachChat";

export const metadata: Metadata = { title: "Shuffle pile · Study Coach" };

export default function ShufflePage() {
  return <CoachChat mode="shuffle" />;
}
