"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/metrics", label: "Métricas" },
  { href: "/metrics/history", label: "Histórico" },
  { href: "/observability", label: "Observability" },
  { href: "/maps", label: "Mapas" },
  { href: "/notifications", label: "Notificações" },
  { href: "/users", label: "Usuários" },
  { href: "/drivers", label: "Motoristas" },
  { href: "/waitlist", label: "Waitlist" },
  { href: "/support", label: "Suporte" },
  { href: "/financial-simulator", label: "Simulador" },
  { href: "/reports", label: "Relatórios" },
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "nav-link nav-link-active" : "nav-link"}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
