"use client";

/**
 * Route-aware application navigation.
 *
 * Most screens remain server components. The shell is the small exception:
 * route awareness makes ten destinations understandable. Every destination is
 * still an ordinary link in the initial HTML.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "./login/actions";

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  count?: number | null;
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { href: "/", label: "Overview", exact: true },
      { href: "/jobs", label: "Jobs" },
      { href: "/applications", label: "Applications" },
      { href: "/shadow-runs", label: "Review" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/companies", label: "Companies" },
      { href: "/answers", label: "Answers" },
      { href: "/profile", label: "Profile" },
      { href: "/analytics", label: "Analytics" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings", label: "Auto-apply", exact: true },
      { href: "/settings/ai", label: "AI provider" },
      { href: "/settings/mailbox", label: "Mailbox" },
    ],
  },
];

function active(path: string, item: NavItem): boolean {
  return item.exact
    ? path === item.href
    : path === item.href || path.startsWith(`${item.href}/`);
}

function NavLink({ item, path }: { item: NavItem; path: string }) {
  const current = active(path, item);
  return (
    <Link
      href={item.href}
      className={current ? "nav-link nav-link-active" : "nav-link"}
      aria-current={current ? "page" : undefined}
    >
      <span>{item.label}</span>
      {item.count ? (
        <span className="nav-count" aria-label={`${item.count} items awaiting review`}>
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}

function Navigation({
  className,
  label,
  path,
  pendingRuns,
  remote,
}: {
  className: string;
  label: string;
  path: string;
  pendingRuns: number | null;
  remote: boolean;
}) {
  return (
    <nav className={`site-nav ${className}`} aria-label={label}>
      {GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <span className="nav-group-label">{group.label}</span>
          <div className="nav-group-links">
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                path={path}
                item={
                  item.href === "/shadow-runs"
                    ? { ...item, count: pendingRuns }
                    : item
                }
              />
            ))}
          </div>
        </div>
      ))}
      {remote ? (
        <form action={logoutAction} className="nav-signout">
          <button type="submit" className="link-button nav-signout-button">
            Sign out
          </button>
        </form>
      ) : null}
    </nav>
  );
}

export function SiteNav({
  pendingRuns,
  remote,
}: {
  pendingRuns: number | null;
  remote: boolean;
}) {
  const path = usePathname();

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Internship Autopilot overview">
        <span className="brand-mark" aria-hidden="true">
          IA
        </span>
        <span className="brand-copy">
          <strong>Internship Autopilot</strong>
          <small>Search command center</small>
        </span>
      </Link>

      <Navigation
        className="desktop-navigation"
        label="Main navigation"
        path={path}
        pendingRuns={pendingRuns}
        remote={remote}
      />

      <details className="nav-disclosure mobile-navigation">
        <summary>
          Menu
          {pendingRuns ? <span className="nav-count">{pendingRuns}</span> : null}
        </summary>
        <Navigation
          className="mobile-navigation-panel"
          label="Mobile navigation"
          path={path}
          pendingRuns={pendingRuns}
          remote={remote}
        />
      </details>
    </header>
  );
}
