import type { ReactNode } from "react";
import { AppShell } from "@/components/coach/AppShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
