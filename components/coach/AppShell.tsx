"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BookOpenCheckIcon,
  BrainIcon,
  CalendarRangeIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  HouseIcon,
  NotebookPenIcon,
  ShuffleIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseProvider, useCourse } from "./CourseContext";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Plan",
    items: [
      { href: "/", label: "Today", icon: HouseIcon },
      { href: "/plan", label: "Study plan", icon: CalendarRangeIcon },
      { href: "/methods", label: "Method sheet", icon: BookOpenCheckIcon },
    ],
  },
  {
    label: "Practice",
    items: [
      { href: "/quiz", label: "Method quiz", icon: BrainIcon },
      { href: "/log", label: "Log a mistake", icon: NotebookPenIcon },
      { href: "/errors", label: "Error log", icon: ClipboardListIcon },
      { href: "/shuffle", label: "Shuffle pile", icon: ShuffleIcon },
    ],
  },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

function AppSidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <Sidebar aria-label="Study Coach">
      <SidebarHeader className="border-b px-3 py-3">
        <Link
          href="/"
          className="focus-visible:ring-sidebar-ring flex items-center gap-2.5 rounded-md px-1 py-1 outline-none focus-visible:ring-2"
        >
          <span className="bg-sidebar-primary text-sidebar-primary-foreground grid size-8 place-items-center rounded-lg">
            <GraduationCapIcon aria-hidden className="size-4" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">Study Coach</span>
            <span className="text-sidebar-foreground/60 text-xs">One course at a time</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        isActive={active}
                        className="h-9 gap-2.5 px-2.5"
                        render={<Link href={href} aria-current={active ? "page" : undefined} />}
                      >
                        <Icon aria-hidden />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t px-4 py-3">
        <p className="text-sidebar-foreground/60 text-xs leading-relaxed">
          Press <kbd className="bg-sidebar-accent rounded px-1 py-0.5 font-mono text-[0.7rem]">Ctrl</kbd>{" "}
          <kbd className="bg-sidebar-accent rounded px-1 py-0.5 font-mono text-[0.7rem]">B</kbd> to hide this menu.
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function CourseHeading() {
  const { state } = useCourse();

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-3" role="status" aria-label="Loading your course">
        <Skeleton className="h-4 w-44 motion-reduce:animate-none" />
        <Skeleton className="h-6 w-16 rounded-full motion-reduce:animate-none" />
      </div>
    );
  }

  if (state.status === "none") {
    return (
      <p className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
        <span className="truncate">No course yet.</span>
        <Link
          href="/plan"
          className="text-foreground focus-visible:ring-ring/50 shrink-0 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2"
        >
          Set one up
        </Link>
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p className="text-muted-foreground truncate text-sm" title={state.message}>
        Couldn&rsquo;t load your course.
      </p>
    );
  }

  const { course, units, currentUnit } = state.view;
  const unitTitle = units?.find((u) => u.number === currentUnit)?.title ?? null;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <h2 className="truncate text-sm font-semibold tracking-tight text-balance">{course.title}</h2>
      <span
        className="bg-secondary text-secondary-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums"
        title={unitTitle ?? undefined}
      >
        Unit {currentUnit}
        {unitTitle ? <span className="text-muted-foreground hidden max-w-48 truncate font-normal sm:inline">{unitTitle}</span> : null}
      </span>
    </div>
  );
}

function AppHeader() {
  return (
    <header className="bg-background/90 flex h-14 shrink-0 items-center gap-3 border-b px-3 backdrop-blur sm:px-4">
      <SidebarTrigger aria-label="Toggle menu" />
      <Separator orientation="vertical" className="h-4" />
      <CourseHeading />
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <CourseProvider>
      <SidebarProvider className="h-dvh min-h-0">
        <a
          href="#main"
          className="bg-background text-foreground focus-visible:ring-ring sr-only z-50 rounded-md border px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:ring-2"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          <div id="main" tabIndex={-1} className={cn("min-h-0 flex-1 overflow-y-auto outline-none")}>
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </CourseProvider>
  );
}
