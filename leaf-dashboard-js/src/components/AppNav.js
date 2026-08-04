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

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const menuButtonRef = useRef(null);
  const wasMobileOpenRef = useRef(false);
  const apiDocsHref = process.env.NEXT_PUBLIC_API_DOCS_URL || "/reports";
  const isApiDocsExternal = /^https?:\/\//i.test(apiDocsHref);
  const campaignCenterVisible = runtimeFlags?.launch?.campaignCenterEnabled === true;
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
          <span className="app-topbar-avatar app-topbar-avatar-compact">{userInitials.slice(0, 1)}</span>
          <span className="app-topbar-crumb">Leaf</span>
          <span className="app-topbar-separator">•</span>
          <span className="app-topbar-project">Backoffice operacional</span>
          <span className="app-topbar-separator">/</span>
          <span className="app-topbar-page">{activeItem?.label || activeGroup.label}</span>
        </div>
        <div className="app-topbar-right">
          <Link href="/dashboard" className="app-topbar-link">
            Visão geral
          </Link>
          <Link href="/support" className="app-topbar-link">
            Suporte
          </Link>
          {campaignCenterVisible ? (
            <Link href="/campaign-center" className="app-topbar-link">
              Campanhas
            </Link>
          ) : null}
          {canAccessItem({ allowedRoles: ["admin", "super-admin", "manager"] }, user) ? (
            <Link href="/drivers/review-queue" className="app-topbar-link">
              Cadastro
            </Link>
          ) : null}
          <Link
            href={apiDocsHref}
            className="app-topbar-link app-topbar-link-secondary"
            target={isApiDocsExternal ? "_blank" : undefined}
            rel={isApiDocsExternal ? "noreferrer" : undefined}
          >
            API Docs
          </Link>
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
                        aria-current={active ? "page" : undefined}
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
            <p className="app-sidebar-card-text">Console limpo para operação assistida.</p>
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
