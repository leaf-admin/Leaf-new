"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import MaterialLineIcon from "@/src/components/dashboard/MaterialLineIcon";
import { dashboardGroups, resolveActiveItem } from "@/src/components/dashboard/navigation";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import { canAccessItem, isLaunchFeatureEnabled } from "@/src/utils/dashboard-access";

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState("today");
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);
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

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const updateViewport = () => {
      setIsMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport || !mobileOpen) return undefined;
    const sidebar = sidebarRef.current;
    if (!sidebar) return undefined;

    const focusableSelector = 'a[href]:not([tabindex="-1"]), button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => {
      const activeLink = sidebar.querySelector('[aria-current="page"]');
      const firstControl = sidebar.querySelector(focusableSelector);
      (activeLink || firstControl)?.focus();
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(sidebar.querySelectorAll(focusableSelector))
        .filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileViewport, mobileOpen]);

  const visibleGroups = useMemo(
    () => dashboardGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (!canAccessItem(item, user)) return false;
          if (!item.featureFlag) return true;
          const launchFlags = runtimeFlags?.launch && typeof runtimeFlags.launch === "object"
            ? runtimeFlags.launch
            : {};
          if (item.requireExplicitFeatureFlag) return launchFlags[item.featureFlag] === true;
          return !runtimeFlags || isLaunchFeatureEnabled(runtimeFlags, item.featureFlag);
        }),
      }))
      .filter((group) => group.items.length > 0),
    [runtimeFlags, user],
  );

  const activeItem = useMemo(() => resolveActiveItem(pathname, visibleGroups), [pathname, visibleGroups]);
  const activeGroup = visibleGroups.find((group) => group.id === activeItem?.groupId) || visibleGroups[0];

  useEffect(() => {
    setMobileOpen(false);
    if (activeItem?.groupId) setExpandedGroupId(activeItem.groupId);
  }, [activeItem?.groupId, pathname]);

  const userInitials = useMemo(() => {
    const chunks = String(user?.name || user?.email || "Leaf").trim().split(/\s+/).filter(Boolean);
    if (!chunks.length) return "L";
    if (chunks.length === 1) return chunks[0].slice(0, 2).toUpperCase();
    return `${chunks[0][0] || ""}${chunks[1][0] || ""}`.toUpperCase();
  }, [user]);

  const runtimeLabel = runtimeFlags
    ? runtimeFlags?.launchProfile || runtimeFlags?.launch?.profile || "Runtime sincronizado"
    : "Runtime indisponível";

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
            ref={menuButtonRef}
            type="button"
            className="app-menu-toggle"
            onClick={() => setMobileOpen((current) => !current)}
            aria-label={mobileOpen ? "Fechar navegação" : "Abrir navegação"}
            aria-expanded={mobileOpen}
            aria-controls="leaf-dashboard-sidebar"
          >
            <MaterialLineIcon name="menu" />
          </button>
          <span className="app-topbar-crumb">Leaf</span>
          <span className="app-topbar-separator" aria-hidden="true">/</span>
          <span className="app-topbar-page">{activeItem?.label || activeGroup?.label || "Operação"}</span>
        </div>
        <div className="app-topbar-right">
          <span className={runtimeFlags ? "app-runtime-chip app-runtime-chip-ok" : "app-runtime-chip app-runtime-chip-warn"}>
            {runtimeLabel}
          </span>
          <div className="app-topbar-avatar" title={user?.name || user?.email || "Administrador"}>
            {userInitials}
          </div>
        </div>
      </header>

      <div
        className={mobileOpen ? "app-sidebar-backdrop app-sidebar-backdrop-visible" : "app-sidebar-backdrop"}
        onClick={() => {
          setMobileOpen(false);
          window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        }}
        aria-hidden="true"
      />

      <div
        ref={sidebarRef}
        id="leaf-dashboard-sidebar"
        className={mobileOpen ? "app-sidebar app-sidebar-open" : "app-sidebar"}
        aria-hidden={isMobileViewport && !mobileOpen ? "true" : undefined}
        inert={isMobileViewport && !mobileOpen}
      >
        <div className="app-sidebar-head">
          <div className="app-logo" aria-hidden="true">L</div>
          <div>
            <p className="app-sidebar-title">Leaf</p>
            <p className="app-sidebar-subtitle">Centro de operação</p>
          </div>
        </div>

        <nav className="app-sidebar-nav" aria-label="Navegação principal">
          {visibleGroups.map((group) => {
            const expanded = expandedGroupId === group.id;
            const groupActive = group.id === activeItem?.groupId;
            return (
              <section key={group.id} className="app-sidebar-group">
                <button
                  type="button"
                  className={groupActive ? "app-sidebar-group-toggle app-sidebar-group-toggle-active" : "app-sidebar-group-toggle"}
                  aria-expanded={expanded}
                  aria-controls={`nav-group-${group.id}`}
                  onClick={() => setExpandedGroupId((current) => current === group.id ? "" : group.id)}
                >
                  <MaterialLineIcon name={group.icon} />
                  <span>{group.label}</span>
                  <span className="app-sidebar-chevron" aria-hidden="true" />
                </button>
                <div id={`nav-group-${group.id}`} className={expanded ? "app-sidebar-links app-sidebar-links-open" : "app-sidebar-links"}>
                  {group.items.map((item) => {
                    const active = activeItem?.href === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={active ? "app-sidebar-link app-sidebar-link-active" : "app-sidebar-link"}
                        aria-current={active ? "page" : undefined}
                        tabIndex={expanded ? undefined : -1}
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
          <Link
            href={apiDocsHref}
            className="app-sidebar-docs"
            target={isApiDocsExternal ? "_blank" : undefined}
            rel={isApiDocsExternal ? "noreferrer" : undefined}
          >
            Documentação da API
          </Link>
          <div className="app-sidebar-user">
            <div className="app-sidebar-avatar">{userInitials}</div>
            <div className="app-sidebar-user-copy">
              <p className="app-sidebar-user-name">{user?.name || "Administrador"}</p>
              <p className="app-sidebar-user-email">{user?.email || "-"}</p>
            </div>
            <button type="button" className="app-sidebar-signout" onClick={onSignOut}>Sair</button>
          </div>
        </div>
      </div>
    </>
  );
}
