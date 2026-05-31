"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import { canAccessItem, isLaunchFeatureEnabled } from "@/src/utils/dashboard-access";

const groups = [
  {
    id: "daily",
    section: "Diário",
    label: "Operação diária",
    href: "/dashboard",
    items: [
      { href: "/dashboard", label: "Visão geral" },
      { href: "/support", label: "Suporte" },
      { href: "/campaign-center", label: "Campanhas", allowedRoles: ["admin", "super-admin", "manager", "development"] },
      { href: "/drivers/review-queue", label: "Cadastro motorista" },
    ],
  },
  {
    id: "overview",
    section: "Análise",
    label: "Dados e saúde",
    href: "/observability",
    items: [
      { href: "/observability", label: "Observabilidade", allowedRoles: ["admin", "super-admin", "manager", "development"] },
      { href: "/metrics", label: "Métricas", blockedRoles: ["support"] },
      { href: "/metrics/history", label: "Histórico", blockedRoles: ["support"] },
      { href: "/metrics/marketplace", label: "Marketplace", blockedRoles: ["support"] },
      { href: "/maps", label: "Mapa operacional" },
      { href: "/audit", label: "Auditoria", allowedRoles: ["admin", "super-admin", "manager", "development"] },
    ],
  },
  {
    id: "organization",
    section: "Gestão",
    label: "Pessoas e financeiro",
    href: "/drivers",
    items: [
      { href: "/drivers", label: "Motoristas" },
      { href: "/users", label: "Usuários" },
      { href: "/subscriptions", label: "Assinaturas", blockedRoles: ["support", "development"] },
      { href: "/programs", label: "Programas", allowedRoles: ["admin", "super-admin", "manager", "development"], featureFlag: "referralProgramsEnabled" },
      { href: "/notifications", label: "Notificações" },
      { href: "/reports", label: "Relatórios" },
      { href: "/promotions", label: "Promoções" },
      { href: "/financial-reconciliation", label: "Reconciliação", allowedRoles: ["admin", "super-admin", "manager"] },
      { href: "/financial-simulator", label: "Simulador", blockedRoles: ["support", "development"] },
      { href: "/waitlist", label: "Waitlist", allowedRoles: ["admin", "super-admin", "manager"] },
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

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const apiDocsHref = process.env.NEXT_PUBLIC_API_DOCS_URL || "/reports";
  const isApiDocsExternal = /^https?:\/\//i.test(apiDocsHref);

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
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (!canAccessItem(item, user)) return false;
            if (item.featureFlag && runtimeFlags && !isLaunchFeatureEnabled(runtimeFlags, item.featureFlag)) {
              return false;
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
            Visão geral
          </Link>
          <Link href="/support" className="app-topbar-link">
            Suporte
          </Link>
          <Link href="/campaign-center" className="app-topbar-link">
            Campanhas
          </Link>
          <Link href="/drivers/review-queue" className="app-topbar-link">
            Cadastro
          </Link>
          <Link
            href={apiDocsHref}
            className="app-topbar-link app-topbar-link-secondary"
            target={isApiDocsExternal ? "_blank" : undefined}
            rel={isApiDocsExternal ? "noreferrer" : undefined}
          >
            API Docs
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
