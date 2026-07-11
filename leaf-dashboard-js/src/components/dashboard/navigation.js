export const dashboardGroups = [
  {
    id: "today",
    label: "Hoje",
    icon: "home",
    items: [
      { href: "/dashboard", label: "Operação diária" },
      { href: "/support", label: "Suporte" },
      { href: "/maps", label: "Mapa operacional" },
      { href: "/drivers/review-queue", label: "Cadastro motorista" },
    ],
  },
  {
    id: "operation",
    label: "Operação",
    icon: "route",
    items: [
      { href: "/metrics", label: "Métricas", blockedRoles: ["support"] },
      { href: "/metrics/history", label: "Histórico", blockedRoles: ["support"] },
      { href: "/metrics/marketplace", label: "Marketplace", blockedRoles: ["support"] },
      { href: "/drivers", label: "Motoristas" },
      { href: "/users", label: "Passageiros" },
    ],
  },
  {
    id: "finance",
    label: "Financeiro",
    icon: "wallet",
    items: [
      { href: "/financial-reconciliation", label: "Reconciliação", allowedRoles: ["admin", "super-admin", "manager"] },
      { href: "/payment-runtime", label: "Perfil de pagamento", allowedRoles: ["admin", "super-admin", "manager", "development"] },
      { href: "/subscriptions", label: "Assinaturas", blockedRoles: ["support", "development"] },
      { href: "/reports", label: "Relatórios" },
      {
        href: "/financial-simulator",
        label: "Simulador",
        blockedRoles: ["support", "development"],
        featureFlag: "financialSimulatorEnabled",
        requireExplicitFeatureFlag: true,
      },
    ],
  },
  {
    id: "growth",
    label: "Crescimento",
    icon: "trend",
    items: [
      { href: "/campaign-center", label: "Campanhas", allowedRoles: ["admin", "super-admin", "manager", "development"] },
      { href: "/programs", label: "Programas", allowedRoles: ["admin", "super-admin", "manager", "development"], featureFlag: "referralProgramsEnabled" },
      { href: "/promotions", label: "Promoções" },
      { href: "/notifications", label: "Notificações" },
      { href: "/waitlist", label: "Waitlist", allowedRoles: ["admin", "super-admin", "manager"] },
    ],
  },
  {
    id: "system",
    label: "Sistema",
    icon: "settings",
    items: [
      { href: "/observability", label: "Observabilidade", allowedRoles: ["admin", "super-admin", "manager", "development"] },
      { href: "/audit", label: "Auditoria", allowedRoles: ["admin", "super-admin", "manager", "development"] },
    ],
  },
];

export function resolveActiveItem(pathname, groups = dashboardGroups) {
  const path = String(pathname || "");
  const matches = groups
    .flatMap((group) => group.items.map((item) => ({ ...item, groupId: group.id })))
    .filter((item) => path === item.href || path.startsWith(`${item.href}/`));

  return matches.sort((a, b) => b.href.length - a.href.length)[0] || null;
}
