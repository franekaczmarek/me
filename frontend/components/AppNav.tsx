"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One tab per module. Add new modules here.
const TABS = [
  { href: "/timeline", label: "Timeline" },
  { href: "/todo", label: "To-do" },
  { href: "/calendar", label: "Calendar" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
