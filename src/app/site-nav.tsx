"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { logoutAction } from "./login/actions";
import { Icon, type IconName } from "./ui-icon";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Your search",
    items: [
      { href: "/", label: "Overview", icon: "overview", exact: true },
      { href: "/jobs", label: "Find opportunities", icon: "jobs" },
      { href: "/applications", label: "Applications", icon: "applications" },
      { href: "/shadow-runs", label: "Review queue", icon: "review" },
      { href: "/analytics", label: "Insights", icon: "analytics" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/profile", label: "Your profile", icon: "profile" },
      { href: "/answers", label: "Answer bank", icon: "answers" },
      { href: "/companies", label: "Company boards", icon: "companies" },
    ],
  },
  {
    label: "Preferences",
    items: [
      { href: "/settings", label: "Auto-apply", icon: "settings", exact: true },
      { href: "/settings/ai", label: "AI provider", icon: "ai" },
      { href: "/settings/mailbox", label: "Mailbox", icon: "mailbox" },
    ],
  },
];

function active(path: string, item: NavItem) {
  return item.exact ? path === item.href : path === item.href || path.startsWith(item.href + "/");
}

function Navigation({ path, pendingRuns, remote, label }: {
  path: string;
  pendingRuns: number | null;
  remote: boolean;
  label: string;
}) {
  return (
    <nav className="workspace-nav" aria-label={label}>
      {GROUPS.map(group => (
        <div className="workspace-nav-group" key={group.label}>
          <span className="workspace-nav-label">{group.label}</span>
          {group.items.map(item => (
            <Link key={item.href} href={item.href} className={active(path, item) ? "workspace-link is-current" : "workspace-link"} aria-current={active(path, item) ? "page" : undefined}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.href === "/shadow-runs" && pendingRuns ? (
                <span className="workspace-count" aria-label={pendingRuns + " items awaiting review"}>{pendingRuns}</span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
      {remote ? (
        <form action={logoutAction} className="workspace-signout">
          <button type="submit" className="link-button">Sign out</button>
        </form>
      ) : null}
    </nav>
  );
}

function Brand() {
  return (
    <Link className="workspace-brand" href="/" aria-label="Internship Autopilot overview">
      <span className="workspace-brand-mark"><Icon name="compass" /></span>
      <span><strong>Autopilot</strong><small>Internship workspace</small></span>
    </Link>
  );
}

export function SiteNav({ pendingRuns, remote }: { pendingRuns: number | null; remote: boolean }) {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const currentGroup = GROUPS.find(group => group.items.some(item => active(path, item)));
  const currentItem = currentGroup?.items.find(item => active(path, item));
  const detailPage = currentItem && !currentItem.exact && path !== currentItem.href;

  useEffect(() => {
    if (menu.current) menu.current.open = false;
    if (search.current) search.current.value = "";
  }, [path]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("autopilot-theme", theme); } catch { /* Theme still works when storage is disabled. */ }
  }

  return (
    <>
      <aside className="workspace-sidebar" aria-label="Workspace sidebar">
        <Brand />
        <Navigation label="Main navigation" path={path} pendingRuns={pendingRuns} remote={remote} />
        <Link href="/profile" className="workspace-sidebar-footer">
          <Icon name="profile" />
          <span>Your workspace<br /><strong>Profile &amp; documents</strong></span>
        </Link>
      </aside>
      <header className="workspace-topbar">
        <div className="workspace-mobile-brand"><Brand /></div>
        <div className="workspace-breadcrumb" aria-label="Current location">
          <span>{currentGroup?.label ?? "Workspace"}</span><span aria-hidden="true">/</span>
          {detailPage ? <Link href={currentItem.href}>{currentItem.label}</Link> : <strong>{currentItem?.label ?? "Page"}</strong>}
          {detailPage ? <><span aria-hidden="true">/</span><strong>Details</strong></> : null}
        </div>
        <form className="workspace-search" role="search" action="/jobs" method="get">
          <Icon name="search" />
          <input ref={search} aria-label="Search job titles" name="q" type="search" placeholder="Search job titles..." />
          <kbd title="Control or Command + K">Ctrl K</kbd>
        </form>
        <button className="workspace-theme" type="button" onClick={toggleTheme} aria-label="Switch between light and dark theme" title="Switch color theme">
          <Icon name="sun" className="theme-sun" /><Icon name="moon" className="theme-moon" />
        </button>
        <details className="workspace-mobile-menu" ref={menu}>
          <summary aria-label="Open navigation menu"><Icon name="menu" /><span>Menu</span></summary>
          <div onClick={event => { if ((event.target as HTMLElement).closest("a") && menu.current) menu.current.open = false; }}>
            <Navigation label="Mobile navigation" path={path} pendingRuns={pendingRuns} remote={remote} />
          </div>
        </details>
      </header>
    </>
  );
}
