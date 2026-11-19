"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", icon: "M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" },
  { href: "/lifts", label: "Lifts", icon: "M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8" },
  { href: "/diet", label: "Diet", icon: "M6 3v8a3 3 0 0 0 6 0V3M9 11v10M17 3c-1.5 2-2 4-2 6s.5 3 2 3 2-1 2-3-.5-4-2-6zM17 12v9" },
  { href: "/weight", label: "Weight", icon: "M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 21l2.5-9h9L19 21z" },
  { href: "/insights", label: "Insights", icon: "M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" },
];

/**
 * A bottom tab bar rather than a sidebar: this is used one-handed, standing up,
 * between sets. Everything important is within thumb reach.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d={tab.icon} />
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 -mx-4 mb-4 border-b border-line bg-ink/90 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        {right}
      </div>
    </header>
  );
}
