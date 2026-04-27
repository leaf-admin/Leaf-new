"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/src/contexts/AuthContext";

const groups = [
  {
    id: "settings",
    section: "Settings",
    label: "Your profile",
    href: "/dashboard",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/observability", label: "Usage", blockedRoles: ["support"] },
      { href: "/metrics", label: "Metrics", blockedRoles: ["support"] },
      { href: "/metrics/history", label: "History", blockedRoles: ["support"] },
      { href: "/metrics/marketplace", label: "Service health", blockedRoles: ["support"] },
    ],
  },
  {
    id: "organization",
    section: "Organization",
    label: "General",
    href: "/drivers",
    items: [
      { href: "/drivers", label: "Drivers" },
      { href: "/drivers/review-queue", label: "Review queue" },
      { href: "/users", label: "People" },
      { href: "/maps", label: "Mapas" },
      { href: "/subscriptions", label: "Billing", blockedRoles: ["support", "development"] },
      { href: "/programs", label: "Limits" },
    ],
  },
  {
    id: "project",
    section: "Project",
    label: "General",
    href: "/support",
    items: [
      { href: "/support", label: "Support" },
      { href: "/notifications", label: "Notifications" },
      { href: "/reports", label: "Reports" },
      { href: "/promotions", label: "Promotions" },
      { href: "/financial-simulator", label: "Simulator", blockedRoles: ["support", "development"] },
      { href: "/waitlist", label: "Waitlist" },
    ],
  },
];

function resolveActiveItem(pathname, navGroups) {
  const allItems = navGroups.flatMap((group) =>
    group.items.map((item) => ({ ...item, groupId: group.id })),
  );

  const path = String(pathname || "");
  if (!path) return null;

  const matches = allItems.filter(
    (item) => path === item.href || path.startsWith(`${item.href}/`),
  );

  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.href.length - a.href.length)[0];
}

function canAccessItem(item, role) {
  const blockedRoles = Array.isArray(item?.blockedRoles) ? item.blockedRoles : [];
  if (!role) return true;
  return !blockedRoles.includes(role);
}

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const apiDocsHref = process.env.NEXT_PUBLIC_API_DOCS_URL || "/reports";
  const isApiDocsExternal = /^https?:\/\//i.test(apiDocsHref);
  const userRole = String(user?.role || "").toLowerCase();

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => canAccessItem(item, userRole)),
        }))
        .filter((group) => group.items.length > 0),
    [userRole],
  );

  const activeItem = useMemo(() => resolveActiveItem(pathname, visibleGroups), [pathname, visibleGroups]);

  const activeGroup = useMemo(() => {
    if (activeItem) {
      return visibleGroups.find((group) => group.id === activeItem.groupId) || visibleGroups[0] || groups[0];
    }
    return visibleGroups[0] || groups[0];
  }, [activeItem, visibleGroups]);

  const userInitials = useMemo(() => {
    const name = String(user?.name || user?.email || "Leaf").trim();
    if (!name) return "L";
    const chunks = name.split(/\s+/).filter(Boolean);
    if (chunks.length === 1) {
      return chunks[0].slice(0, 2).toUpperCase();
    }
    return `${chunks[0][0] || ""}${chunks[1][0] || ""}`.toUpperCase();
  }, [user]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const onSignOut = async () => {
    try {
      await signOut();
    } finally {
      router.replace("/login");
    }
  };

  return (
    <>
      <header className="app-topbar">
        <div className="app-topbar-left">
          <button
            type="button"
            className="app-menu-toggle"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Abrir menu"
          >
            Menu
          </button>
          <span className="app-topbar-avatar app-topbar-avatar-compact">{userInitials.slice(0, 1)}</span>
          <span className="app-topbar-crumb">Personal</span>
          <span className="app-topbar-separator">•</span>
          <span className="app-topbar-project">Default project</span>
          <span className="app-topbar-separator">/</span>
          <span className="app-topbar-page">{activeItem?.label || activeGroup.label}</span>
        </div>
        <div className="app-topbar-right">
          <Link href="/dashboard" className="app-topbar-link">
            Dashboard
          </Link>
          <Link
            href={apiDocsHref}
            className="app-topbar-link"
            target={isApiDocsExternal ? "_blank" : undefined}
            rel={isApiDocsExternal ? "noreferrer" : undefined}
          >
            API Docs
          </Link>
          <Link href="/support" className="app-topbar-link">
            Settings
          </Link>
          <div className="app-topbar-avatar" title={user?.name || user?.email || "Admin"}>
            {userInitials}
          </div>
        </div>
      </header>

      <div
        className={mobileOpen ? "app-sidebar-backdrop app-sidebar-backdrop-visible" : "app-sidebar-backdrop"}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside className={mobileOpen ? "app-sidebar app-sidebar-open" : "app-sidebar"}>
        <div className="app-sidebar-head">
          <div className="app-logo">L</div>
          <div>
            <p className="app-sidebar-title">Personal</p>
            <p className="app-sidebar-subtitle">Default project</p>
          </div>
        </div>

        <nav className="app-sidebar-nav" aria-label="Navegacao principal">
          {visibleGroups.map((group) => {
            const groupActive = group.id === activeGroup.id;
            return (
              <section key={group.id} className="app-sidebar-group">
                <p className="app-sidebar-section">{group.section}</p>
                <h3 className={groupActive ? "app-sidebar-group-title app-sidebar-group-title-active" : "app-sidebar-group-title"}>
                  {group.label}
                </h3>
                <div className="app-sidebar-links">
                  {group.items.map((item) => {
                    const active = activeItem?.href === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={active ? "app-sidebar-link app-sidebar-link-active" : "app-sidebar-link"}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>

        <div className="app-sidebar-foot">
          <div className="app-sidebar-card">
            <p className="app-sidebar-card-title">Live observability</p>
            <p className="app-sidebar-card-text">Atualização contínua a cada 5s.</p>
          </div>
          <div className="app-sidebar-user">
            <div className="app-sidebar-avatar">{userInitials}</div>
            <div>
              <p className="app-sidebar-user-name">{user?.name || "Administrador"}</p>
              <p className="app-sidebar-user-email">{user?.email || "-"}</p>
            </div>
          </div>
          <button type="button" className="app-sidebar-signout" onClick={onSignOut}>
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
