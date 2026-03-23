"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/src/contexts/AuthContext";

const groups = [
  {
    id: "operacao",
    label: "Operacao",
    href: "/dashboard",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/maps", label: "Mapas e Geofence" },
      { href: "/drivers", label: "Motoristas" },
      { href: "/drivers/review-queue", label: "Fila de Documentos" },
      { href: "/users", label: "Usuarios" },
      { href: "/waitlist", label: "Waitlist" },
      { href: "/support", label: "Suporte" },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    href: "/metrics",
    items: [
      { href: "/metrics", label: "Metricas" },
      { href: "/metrics/marketplace", label: "Marketplace Health" },
      { href: "/metrics/history", label: "Historico" },
      { href: "/observability", label: "Observability" },
    ],
  },
  {
    id: "monetizacao",
    label: "Monetizacao",
    href: "/subscriptions",
    items: [
      { href: "/subscriptions", label: "Assinaturas" },
      { href: "/promotions", label: "Promocoes" },
      { href: "/programs", label: "Convites" },
      { href: "/financial-simulator", label: "Simulador" },
    ],
  },
  {
    id: "comunicacao",
    label: "Comunicacao",
    href: "/notifications",
    items: [
      { href: "/notifications", label: "Notificacoes" },
      { href: "/reports", label: "Relatorios" },
    ],
  },
];

function resolveActiveItem(pathname) {
  const allItems = groups.flatMap((group) =>
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

  const activeItem = useMemo(() => resolveActiveItem(pathname), [pathname]);

  const activeGroup = useMemo(() => {
    if (activeItem) {
      return groups.find((group) => group.id === activeItem.groupId) || groups[0];
    }
    return groups[0];
  }, [activeItem]);

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
          <span className="app-topbar-pill">Leaf Platform</span>
          <span className="app-topbar-project">{activeGroup.label}</span>
        </div>
        <div className="app-topbar-right">
          <Link href="/dashboard" className="app-topbar-link">
            Dashboard
          </Link>
          <Link href="/reports" className="app-topbar-link">
            Relatórios
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
            <p className="app-sidebar-title">Leaf Ops</p>
            <p className="app-sidebar-subtitle">Controle operacional</p>
          </div>
        </div>

        <nav className="app-sidebar-nav" aria-label="Navegacao principal">
          {groups.map((group) => {
            const groupActive = group.id === activeGroup.id;
            return (
              <section key={group.id} className="app-sidebar-group">
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
