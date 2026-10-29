"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import { canAccessItem, isLaunchFeatureEnabled } from "@/src/utils/dashboard-access";
import { dashboardNavigationGroups } from "@/src/config/dashboard-navigation";

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

const NAV_GROUPS_STORAGE_KEY = "leaf.dashboard.nav-groups";

const NAV_ICON_PATHS = {
  today: "M3 10.5L10 4l7 6.5M5 9v7h4v-4h2v4h4V9",
  operations: "M7 9a3 3 0 100-6 3 3 0 000 6zM2 17c0-3 2.2-5 5-5s5 2 5 5M13.5 9a2.5 2.5 0 100-5M14 12c2.4.3 4 2.2 4 5",
  finance: "M3 6.5A2.5 2.5 0 015.5 4h9A2.5 2.5 0 0117 6.5v7a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 013 13.5v-7zM3 8h14M13 12h1.5",
  growth: "M3 15l5-5 3 3 6-6M12 7h5v5",
  system: "M2 10h3l2-5 4 10 2-5h5",
};

function NavGroupIcon({ name }) {
  return (
    <svg className="app-sidebar-group-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={NAV_ICON_PATHS[name] || NAV_ICON_PATHS.today}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Which menu groups the operator opened or closed; the active one starts open.
  const [openGroups, setOpenGroups] = useState({});
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const menuButtonRef = useRef(null);
  const wasMobileOpenRef = useRef(false);
  const adminMutationsEnabled = runtimeFlags?.launch?.adminMutationsEnabled !== false;

  useEffect(() => {
    let mounted = true;
    leafAPI.getRuntimeFlags()
      .then((payload) => {
        if (mounted) setRuntimeFlags(payload || null);
      })
      .catch(() => {
        if (mounted) setRuntimeFlags(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const visibleGroups = useMemo(
    () =>
      dashboardNavigationGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (!canAccessItem(item, user)) return false;
            if (item.featureFlag) {
              const launchFlags =
                runtimeFlags?.launch && typeof runtimeFlags.launch === "object"
                  ? runtimeFlags.launch
                  : {};
              if (item.requireExplicitFeatureFlag) {
                return launchFlags[item.featureFlag] === true;
              }
              if (runtimeFlags && !isLaunchFeatureEnabled(runtimeFlags, item.featureFlag)) {
                return false;
              }
            }
            return true;
          }),
        }))
        .filter((group) => group.items.length > 0),
    [runtimeFlags, user],
  );

  const activeItem = useMemo(() => resolveActiveItem(pathname, visibleGroups), [pathname, visibleGroups]);

  const activeGroup = useMemo(() => {
    if (activeItem) {
      return visibleGroups.find((group) => group.id === activeItem.groupId) || visibleGroups[0] || dashboardNavigationGroups[0];
    }
    return visibleGroups[0] || dashboardNavigationGroups[0];
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

  useEffect(() => {
    if (mobileOpen) {
      const handleKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setMobileOpen(false);
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
    if (wasMobileOpenRef.current) menuButtonRef.current?.focus();
    return undefined;
  }, [mobileOpen]);

  useEffect(() => {
    wasMobileOpenRef.current = mobileOpen;
  }, [mobileOpen]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY) || "{}");
      if (stored && typeof stored === "object") setOpenGroups(stored);
    } catch {
      // Sem armazenamento local: grupos voltam ao padrão (o ativo aberto).
    }
  }, []);

  const toggleGroup = (groupId, nextExpanded) => {
    setOpenGroups((current) => {
      const next = { ...current, [groupId]: nextExpanded };
      try {
        window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Preferência só desta sessão.
      }
      return next;
    });
  };

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
            ref={menuButtonRef}
            className="app-menu-toggle"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
            aria-controls="app-sidebar-nav"
          >
            {mobileOpen ? "Fechar" : "Menu"}
          </button>
          <span className="app-topbar-crumb">{activeGroup.section}</span>
          <span className="app-topbar-separator">/</span>
          <span className="app-topbar-page">{activeItem?.label || activeGroup.label}</span>
        </div>
        <div className="app-topbar-right">
          {canAccessItem({ allowedRoles: ["admin", "super-admin", "manager"] }, user) ? (
            <Link href="/drivers?tab=review" className="app-topbar-link">
              Aprovar motoristas
            </Link>
          ) : null}
          {runtimeFlags && !adminMutationsEnabled ? (
            <span className="app-topbar-readonly" role="status">
              Somente leitura
            </span>
          ) : null}
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
            <p className="app-sidebar-title">Leaf</p>
            <p className="app-sidebar-subtitle">Backoffice operacional</p>
          </div>
        </div>

        <nav id="app-sidebar-nav" className="app-sidebar-nav" aria-label="Navegação principal">
          {visibleGroups.map((group) => {
            const groupActive = group.id === activeGroup.id;
            // "Hoje" (support, approvals) and the current area start open; the rest is one click away.
            const expanded = openGroups[group.id] ?? (groupActive || group.id === "today");
            const linksId = `app-sidebar-links-${group.id}`;
            return (
              <section
                key={group.id}
                className={groupActive ? "app-sidebar-group app-sidebar-group-active" : "app-sidebar-group"}
              >
                <button
                  type="button"
                  className="app-sidebar-group-toggle"
                  aria-expanded={expanded}
                  aria-controls={linksId}
                  onClick={() => toggleGroup(group.id, !expanded)}
                >
                  <NavGroupIcon name={group.icon} />
                  <span className="app-sidebar-group-label">{group.section}</span>
                  {!expanded && group.items.length > 1 ? (
                    <span className="app-sidebar-group-count">{group.items.length}</span>
                  ) : null}
                  <svg className="app-sidebar-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {expanded ? (
                  <div className="app-sidebar-links" id={linksId}>
                    {group.items.map((item) => {
                      const active = activeItem?.href === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={active ? "app-sidebar-link app-sidebar-link-active" : "app-sidebar-link"}
                          aria-current={active ? "page" : undefined}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>

        <div className="app-sidebar-foot">
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
