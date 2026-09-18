"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const DASHBOARD_REFRESH_MS = 60000;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCompact(value) {
  const numeric = toNumber(value);
  return numeric.toLocaleString("pt-BR", {
    maximumFractionDigits: numeric >= 1000 ? 1 : 0,
    notation: numeric >= 10000 ? "compact" : "standard",
  });
}

function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(1)}%`;
}

function formatPercentValue(value) {
  return `${toNumber(value).toFixed(1)}%`;
}

function brlFromCents(value) {
  return `R$ ${(toNumber(value) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function brlFromValue(value, maximumFractionDigits = 2) {
  return `R$ ${toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  })}`;
}

function formatUsd(value) {
  return `US$ ${toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
}

function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)} min`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusTone(status) {
  if (!status) return "default";
  if (status === "healthy") return "positive";
  if (status === "warning") return "warning";
  return "danger";
}

function statusClass(status) {
  if (!status) return "meta-badge";
  if (status === "healthy") return "status-ok";
  if (status === "warning") return "status-warn";
  return "status-bad";
}

function statusLabel(status) {
  if (!status) return "Sem leitura";
  if (status === "healthy") return "Operação saudável";
  if (status === "warning") return "Atenção operacional";
  return "Ação necessária";
}

function costGuardClass(status) {
  if (status === "ok") return "status-ok";
  if (status === "warning") return "status-warn";
  return "status-bad";
}

function costGuardLabel(status) {
  if (status === "ok") return "Dentro do teto";
  if (status === "warning") return "Acompanhar";
  if (status === "danger") return "Perto do limite";
  if (status === "limit") return "Limite atingido";
  return "Sem leitura";
}

function runtimeEnvironmentLabel(environment) {
  if (environment === "sandbox") return "sandbox";
  if (environment === "production") return "produção";
  return "não definido";
}

function readinessClass(status) {
  if (status === "ready") return "status-ok";
  if (status === "attention") return "status-warn";
  return "status-bad";
}

function readinessLabel(status) {
  if (status === "ready") return "pronto";
  if (status === "attention") return "atenção";
  return "bloqueado";
}

function skuStatusClass(status) {
  if (status === "healthy") return "status-ok";
  if (status === "warning") return "status-warn";
  if (status === "danger") return "status-bad";
  return "status-warn";
}

function skuStatusLabel(status) {
  if (status === "healthy") return "normal";
  if (status === "warning") return "acompanhar";
  if (status === "danger") return "fora da curva";
  return "sem amostra";
}

function SourceRows({ sources = [] }) {
  if (!sources.length) return <p className="text-muted">Sem fontes carregadas.</p>;
  return (
    <div className="metric-list">
      {sources.map((source) => (
        <div className="row" key={source.id}>
          <div className="label">
            <span
              className={
                source.status === "ok"
                  ? "status-ok"
                  : source.status === "warning"
                    ? "status-warn"
                    : "status-bad"
              }
            >
              {source.label}
            </span>
          </div>
          <div className="value">
            {source.status === "ok"
              ? `${source.durationMs} ms`
              : source.status === "warning"
                ? source.error || "atenção"
                : source.error || "falhou"}
          </div>
        </div>
      ))}
    </div>
  );
}

function DomainHealthRows({ domains = [] }) {
  if (!domains.length) return <p className="text-muted">Sem domínios carregados.</p>;
  return (
    <div className="metric-list">
      {domains.map((domain) => (
        <div className="row" key={domain.id}>
          <div className="label">
            <span className={statusClass(domain.status)}>{domain.label}</span>
            <small>{domain.action}</small>
          </div>
          <div className="value">{domain.source}</div>
        </div>
      ))}
    </div>
  );
}

function ActionItems({ items = [] }) {
  if (!items.length) return <p className="text-muted">Sem ações sugeridas agora.</p>;
  return (
    <div className="metric-list">
      {items.map((item) => (
        <div className="row" key={item.id || item.title || item.label || item.description}>
          <div className="label">
            <span
              className={
                item.priority === "alta"
                  ? "status-bad"
                  : item.priority === "media"
                    ? "status-warn"
                    : "status-ok"
              }
            >
              {item.title || item.label || "Ação operacional"}
            </span>
            <small>{item.description || item.detail || "Verificar no fluxo indicado."}</small>
          </div>
          <div className="value">
            <Link href={item.href || "/dashboard"}>{item.priority || item.status || "ver"}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildAttentionItems(snapshot) {
  const launchFlags = snapshot?.launchFlags || {};
  const items = Array.isArray(snapshot?.actionItems) ? snapshot.actionItems : [];
  return items
    .filter((item) => launchFlags.campaignCenterEnabled === true || !String(item.id || "").startsWith("campaigns-"))
    .sort((left, right) => {
      const rank = { alta: 0, media: 1, baixa: 2 };
      return (rank[left.priority] ?? 3) - (rank[right.priority] ?? 3);
    })
    .slice(0, 6);
}

function RideCostAnomalyBanner({ anomaly }) {
  if (!anomaly) return null;
  const tone = anomaly.status === "danger"
    ? "status-bad"
    : anomaly.status === "warning"
      ? "status-warn"
      : "status-ok";

  if (anomaly.status === "no_data" || anomaly.status === "healthy") {
    return (
      <div className="ops-mini-bars" style={{ marginBottom: "0.5rem" }}>
        <div>
          <span className={tone}>
            {anomaly.status === "healthy" ? "Custo dentro do esperado" : "Sem corridas suficientes para avaliar"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-incident" style={{ marginBottom: "0.5rem", padding: "0.5rem", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)" }}>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <span className={tone}>
          {anomaly.status === "danger" ? "ALERTA CRÍTICO" : "ATENÇÃO"}
        </span>
        <strong>
            R$ {toNumber(anomaly.averageBrl).toFixed(4)} / corrida
        </strong>
        <span className="meta-badge">
          {anomaly.aboveWarningCount} de {anomaly.completedRides} acima do aviso (R$ {toNumber(anomaly.warningThreshold).toFixed(2)})
        </span>
        {anomaly.aboveCriticalCount > 0 ? (
          <span className="status-bad">
            {anomaly.aboveCriticalCount} acima do crítico (R$ {toNumber(anomaly.criticalThreshold).toFixed(2)})
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
        <small>
          Google médio: R$ {toNumber(anomaly.averageGoogleBrl).toFixed(4)}
        </small>
        <small>
          Directions: {toNumber(anomaly.directionsPerRide).toFixed(2)} / corrida
          {anomaly.directionsPerRide >= anomaly.directionsCriticalPerRide
            ? " (acima do crítico)"
            : anomaly.directionsPerRide >= anomaly.directionsWarningPerRide
              ? " (acima do aviso)"
              : ""}
        </small>
        <small>
          Máxima: R$ {toNumber(anomaly.maxBrl).toFixed(4)}
        </small>
        <span className="meta-badge">
          Limites configurados no backend: aviso R$ {toNumber(anomaly.warningThreshold).toFixed(2)} · crítico R$ {toNumber(anomaly.criticalThreshold).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function SkuCostMonitorPanel({ skuMonitor, rideCostAnomaly }) {
  const finance = skuMonitor?.finance || {};
  const rows = Array.isArray(skuMonitor?.rows) ? skuMonitor.rows : [];
  const sampledRides = toNumber(skuMonitor?.sampledRides);
  const completedRidesToday = toNumber(skuMonitor?.completedRidesToday);

  return (
    <div className="sku-monitor">
      <RideCostAnomalyBanner anomaly={rideCostAnomaly} />
      <div className="sku-monitor-summary">
        <div className="sku-monitor-card">
          <span>Status</span>
          <strong className={skuStatusClass(skuMonitor?.status)}>
            {skuStatusLabel(skuMonitor?.status)}
          </strong>
          <small>{formatCompact(sampledRides)} corrida(s) na janela recente</small>
        </div>
        <div className="sku-monitor-card">
          <span>Taxa operacional média</span>
          <strong>{brlFromCents(finance.operationalFeeAverageCents)}</strong>
          <small>{brlFromCents(finance.operationalFeeTotalCents)} acumulados hoje</small>
        </div>
        <div className="sku-monitor-card">
          <span>Custo variável/corrida</span>
          <strong>{brlFromCents(finance.variableCostWithoutWooviPerRideCents)}</strong>
          <small>{toNumber(finance.costRatioPercent).toFixed(1)}% da taxa média, sem Woovi</small>
        </div>
        <div className="sku-monitor-card">
          <span>Líquido operacional</span>
          <strong>{brlFromCents(finance.netAfterInfraCents)}</strong>
          <small>{toNumber(finance.marginAfterInfraPercent).toFixed(1)}% após infra estimada</small>
        </div>
      </div>

      <div className="sku-explainer">
        <strong>Como ler:</strong> o painel usa a telemetria recente já gravada no Redis, projeta o custo médio
        para as {formatCompact(completedRidesToday)} corrida(s) finalizadas hoje e separa Woovi da infraestrutura.
        O dashboard não chama Google, Firebase, Redis externo ou Woovi para montar esta visão.
      </div>

      <div className="metric-list">
        <div className="row">
          <div className="label">
            <span>Infra projetada hoje</span>
            <small>Google, Redis, Firebase, backend e infra fixa configurada</small>
          </div>
          <div className="value">{brlFromCents(finance.projectedCostWithoutWooviTodayCents)}</div>
        </div>
        <div className="row">
          <div className="label">
            <span>Woovi separado</span>
            <small>Visível para reconciliação, sem esconder na margem operacional</small>
          </div>
          <div className="value">{brlFromCents(finance.projectedWooviTodayCents)}</div>
        </div>
        <div className="row">
          <div className="label">
            <span>Líquido após tudo</span>
            <small>Taxa Leaf menos infra estimada e Woovi quando configurado</small>
          </div>
          <div className="value">{brlFromCents(finance.netAfterAllCents)}</div>
        </div>
      </div>

      <div className="table-shell sku-table-shell">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Fornecedor/SKU</th>
              <th>Uso</th>
              <th>Custo unit.</th>
              <th>Total janela</th>
              <th>Proj. hoje</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.slice(0, 12).map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.sku}</strong>
                  <span className="table-muted">{row.provider} · {row.detail}</span>
                </td>
                <td>
                  {formatCompact(row.usage)}
                  <span className="table-muted">{row.unitLabel}</span>
                </td>
                <td>{brlFromValue(row.unitCostBrl, 4)}</td>
                <td>{brlFromValue(row.totalCostBrl, 4)}</td>
                <td>{brlFromCents(row.projectedTodayCents)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5}>Sem telemetria recente de corrida. O painel começa a preencher após novos fluxos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ops-mini-bars">
        {(skuMonitor?.notes || []).slice(0, 4).map((note) => (
          <div key={note}>
            <span>{note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandStat({ label, value, detail, tone = "default" }) {
  return (
    <article className={`ops-command-stat ops-command-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function WorkspaceCard({
  eyebrow,
  title,
  description,
  href,
  actionLabel,
  tone = "default",
  status,
  metrics,
  footnote,
}) {
  return (
    <article className={`ops-workspace-card ops-workspace-card-${tone}`}>
      <div className="ops-workspace-head">
        <div>
          <p className="ops-workspace-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {status ? <span className={`ops-workspace-status ops-workspace-status-${tone}`}>{status}</span> : null}
      </div>

      <div className="ops-workspace-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      {footnote ? <p className="ops-workspace-footnote">{footnote}</p> : null}

      <Link href={href} className="ops-workspace-link">
        {actionLabel}
      </Link>
    </article>
  );
}

function CommandCenterHealth({ snapshot }) {
  const services = snapshot?.services || {};
  const costControls = snapshot?.costControls || {};
  const firestoreReadGuard = costControls.firestoreReadGuard || {};
  const paymentRuntime = snapshot?.paymentRuntime || {};
  const domains = Array.isArray(services.domainHealth) ? services.domainHealth : [];
  const healthyDomains = domains.filter((domain) => domain.status === "healthy").length;
  const canaryReadiness = Array.isArray(snapshot?.canaryPack?.readiness)
    ? snapshot.canaryPack.readiness
    : [];

  const healthItems = [
    {
      label: "Serviços",
      value: statusLabel(snapshot?.status),
      detail: domains.length ? `${healthyDomains}/${domains.length} domínios saudáveis` : "Leitura consolidada do backend",
      tone: statusClass(snapshot?.status),
      href: "/observability",
    },
    {
      label: "Pagamento",
      value: runtimeEnvironmentLabel(paymentRuntime.defaultEnvironment),
      detail: `${formatCompact(paymentRuntime.sandboxProfileCount)} sandbox · ${formatCompact(snapshot?.dailyMetrics?.paymentPendingCount)} pendências`,
      tone: paymentRuntime.globalSandboxEnabled ? "status-bad" : paymentRuntime.canarySandboxEnabled ? "status-ok" : "status-warn",
      href: "/payment-runtime",
    },
    {
      label: "Custo do dashboard",
      value: costGuardLabel(firestoreReadGuard.budgetStatus),
      detail: `${formatPercentValue(firestoreReadGuard.budgetUsagePercent)} do orçamento de reads`,
      tone: costGuardClass(firestoreReadGuard.budgetStatus),
      href: "/metrics",
    },
  ];

  return (
    <div className="ops-health-summary">
      <div className="ops-health-list">
        {healthItems.map((item) => (
          <Link href={item.href} className="ops-health-row" key={item.label}>
            <span>
              <small>{item.label}</small>
              <strong className={item.tone}>{item.value}</strong>
            </span>
            <span>
              <small>{item.detail}</small>
              <b aria-hidden="true">→</b>
            </span>
          </Link>
        ))}
      </div>
      {canaryReadiness.length ? (
        <div className="ops-health-canary">
          <div>
            <span className="ops-workspace-eyebrow">Canary Pack</span>
            <strong>{canaryReadiness.filter((item) => item.status === "ready").length}/{canaryReadiness.length} pronto</strong>
          </div>
          <div className="ops-health-canary-items">
            {canaryReadiness.slice(0, 3).map((item) => (
              <span key={item.id} className={readinessClass(item.status)}>
                {item.label}: {readinessLabel(item.status)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildWorkspaces(snapshot) {
  const metrics = snapshot?.dailyMetrics || {};
  const support = snapshot?.support || {};
  const campaigns = snapshot?.campaigns || {};
  const driverOnboarding = snapshot?.driverOnboarding || {};
  const launchFlags = snapshot?.launchFlags || {};
  const supportBreaches = toNumber(support.overdueAckCount) + toNumber(support.overdueFirstResponseCount);

  return [
    {
      id: "operations",
      eyebrow: "Operação",
      title: `${formatCompact(metrics.activeRides)} corridas em curso`,
      description: "Motoristas, corridas e território ficam em uma única entrada operacional.",
      href: "/maps",
      actionLabel: "Abrir operação",
      tone: metrics.activeRides > 0 ? "positive" : "default",
      status: metrics.activeDrivers > 0 ? "online" : "sem motoristas",
      footnote: `Total cadastrado: ${formatCompact(metrics.totalDrivers)} motoristas`,
      metrics: [
        { label: "Motoristas ativos", value: formatCompact(metrics.activeDrivers) },
        { label: "Corridas agora", value: formatCompact(metrics.activeRides) },
        { label: "Finalizadas hoje", value: formatCompact(metrics.completedRidesToday) },
        { label: "Motoristas", value: formatCompact(metrics.totalDrivers) },
      ],
    },
    {
      id: "driver-onboarding",
      eyebrow: "Cadastro",
      title: `${formatCompact(driverOnboarding.pendingDocuments)} para revisar`,
      description: "Uma fila única para documentos, reenvios e decisões de KYC.",
      href: "/drivers/review-queue",
      actionLabel: "Abrir documentos",
      tone: driverOnboarding.pendingDocuments > 0 ? "warning" : "positive",
      status: driverOnboarding.pendingDocuments > 0 ? "ação necessária" : "em dia",
      footnote: `Fila total: ${formatCompact(driverOnboarding.totalDocuments)} documentos`,
      metrics: [
        { label: "Pendentes", value: formatCompact(driverOnboarding.pendingDocuments) },
        { label: "Aprovados", value: formatCompact(driverOnboarding.approvedDocuments) },
        { label: "Rejeitados", value: formatCompact(driverOnboarding.rejectedDocuments) },
        { label: "Fonte", value: driverOnboarding.reviewQueueSource || "agregada" },
      ],
    },
    {
      id: "finance",
      eyebrow: "Financeiro",
      title: brlFromCents(metrics.grossRevenueCents),
      description: "GMV, receita, pagamentos pendentes e reconciliação em um só ponto.",
      href: "/financial-reconciliation",
      actionLabel: "Abrir financeiro",
      tone: metrics.paymentPendingCount > 0 ? "warning" : "positive",
      status: metrics.paymentPendingCount > 0 ? "acompanhar" : "normal",
      footnote: `Ticket médio ${brlFromCents(metrics.averageRideTicketCents)} · ARPU ${brlFromCents(metrics.arpuBaseCents)}`,
      metrics: [
        { label: "GMV hoje", value: brlFromCents(metrics.gmvCents) },
        { label: "Receita Leaf", value: brlFromCents(metrics.grossRevenueCents) },
        { label: "Pendências", value: formatCompact(metrics.paymentPendingCount) },
        { label: "Ambiente Woovi", value: runtimeEnvironmentLabel(snapshot?.paymentRuntime?.defaultEnvironment) },
      ],
    },
    {
      id: "support",
      eyebrow: "Suporte",
      title: `${formatCompact(support.totalOpenTickets)} tickets abertos`,
      description: "Fila de atendimento, dono, SLA e classificação N1/N2/N3 para ação rápida.",
      href: "/support",
      actionLabel: "Abrir suporte",
      tone: supportBreaches > 0 ? "danger" : "positive",
      status: supportBreaches > 0 ? "SLA" : "ok",
      footnote: `1ª resposta mediana: ${formatMinutes(support.medianFirstResponseMinutes)}`,
      metrics: [
        { label: "N1 / N2 / N3", value: `${formatCompact(support.backlogByPriority?.N1)} / ${formatCompact(support.backlogByPriority?.N2)} / ${formatCompact(support.backlogByPriority?.N3)}` },
        { label: "Fora do SLA", value: formatCompact(supportBreaches) },
        { label: "Sem responsável", value: formatCompact(support.ticketsWithoutOwner) },
        { label: "Abertos", value: formatCompact(support.totalOpenTickets) },
      ],
    },
    launchFlags.campaignCenterEnabled === true ? {
      id: "campaigns",
      eyebrow: "Campanhas",
      title: `${formatCompact(campaigns.active)} campanhas ativas`,
      description: "Monitor de banners, campanhas in-app, prazo, valor contratado e performance.",
      href: "/campaign-center",
      actionLabel: "Abrir campanhas",
      tone: campaigns.active > 0 ? "positive" : "default",
      status: campaigns.active > 0 ? "ativo" : "neutro",
      footnote: `eCPM ${brlFromCents(campaigns.effectiveCpmCents)} · eCPC ${brlFromCents(campaigns.effectiveCpcCents)}`,
      metrics: [
        { label: "Impressões", value: formatCompact(campaigns.impressions) },
        { label: "Cliques", value: formatCompact(campaigns.clicks) },
        { label: "CTR", value: formatPercent(campaigns.ctr) },
        { label: "Valor", value: brlFromCents(campaigns.campaignValueCents) },
      ],
    } : null,
  ].filter(Boolean);
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    let firstLoad = true;

    const load = async () => {
      try {
        if (mounted && firstLoad) setLoading(true);
        if (mounted) setError("");
        const payload = await leafAPI.getCommandCenterSnapshot({ hours: 1, period: "today" });
        if (mounted) setSnapshot(payload);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar command center");
      } finally {
        if (mounted) {
          setLoading(false);
          firstLoad = false;
        }
      }
    };

    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = setInterval(loadWhenVisible, DASHBOARD_REFRESH_MS);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, []);

  const workspaces = useMemo(() => buildWorkspaces(snapshot), [snapshot]);
  const attentionItems = useMemo(() => buildAttentionItems(snapshot), [snapshot]);
  const metrics = snapshot?.dailyMetrics || {};
  const services = snapshot?.services || {};
  const costControls = snapshot?.costControls || {};
  const firestoreReadGuard = costControls.firestoreReadGuard || {};
  const paymentRuntime = snapshot?.paymentRuntime || {};

  return (
    <ProtectedRoute>
      <main className="page-shell dashboard-shell">
        <header className="header dashboard-header">
          <div>
            <h1>Operação diária</h1>
            <p>Priorize o que precisa de ação agora; os detalhes ficam agrupados por contexto operacional.</p>
          </div>
          <div className="filters">
            <span className={statusClass(snapshot?.status)}>
              {statusLabel(snapshot?.status)}
            </span>
            <span className="meta-badge">Atualizado {formatTime(snapshot?.generatedAt)}</span>
            <span className="meta-badge">Cache {snapshot?.cache?.status || "-"}</span>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando operação diária..." /> : null}

        <section className="ops-command-strip" aria-label="Resumo operacional">
          <CommandStat
            label="Serviços"
            value={statusLabel(snapshot?.status)}
            detail={`TTL ${snapshot?.scope?.ttlSeconds || 0}s`}
            tone={statusTone(snapshot?.status)}
          />
          <CommandStat
            label="Motoristas"
            value={formatCompact(metrics.activeDrivers)}
            detail={`${formatCompact(metrics.totalDrivers)} cadastrados`}
            tone={metrics.activeDrivers > 0 ? "positive" : "warning"}
          />
          <CommandStat
            label="Corridas"
            value={formatCompact(metrics.activeRides)}
            detail={`${formatCompact(metrics.completedRidesToday)} finalizadas hoje`}
          />
          <CommandStat
            label="GMV"
            value={brlFromCents(metrics.gmvCents)}
            detail={`ticket ${brlFromCents(metrics.averageRideTicketCents)}`}
          />
          <CommandStat
            label="Receita Leaf"
            value={brlFromCents(metrics.grossRevenueCents)}
            detail={`ARPU ${brlFromCents(metrics.arpuBaseCents)}`}
          />
          <CommandStat
            label="Woovi"
            value={runtimeEnvironmentLabel(paymentRuntime.defaultEnvironment)}
            detail={`${formatCompact(paymentRuntime.sandboxProfileCount)} sandbox · ${formatCompact(metrics.paymentPendingCount)} pendências`}
            tone={paymentRuntime.globalSandboxEnabled ? "danger" : paymentRuntime.canarySandboxEnabled ? "positive" : "warning"}
          />
        </section>

        <section className="ops-workspace-grid" aria-label="Janelas principais">
          {workspaces.map((workspace) => (
            <WorkspaceCard key={workspace.id} {...workspace} />
          ))}
        </section>

        <section className="grid ops-detail-grid" aria-label="Atenção operacional">
          <Panel
            title="Atenção agora"
            subtitle="Itens priorizados pelo backend para a equipe decidir o próximo passo sem procurar em várias telas."
          >
            <ActionItems items={attentionItems} />
          </Panel>

          <Panel
            title="Saúde e atalhos"
            subtitle="Resumo operacional; os detalhes técnicos ficam nas telas próprias."
          >
            <CommandCenterHealth snapshot={snapshot} />
          </Panel>
        </section>

        <details className="ops-advanced-panel">
          <summary>Dados técnicos, custos e fontes</summary>
          <div className="ops-advanced-panel-body">
        <section className="grid ops-detail-grid">
          <Panel
            title="Monitor SKU e margem"
            subtitle="Custo por chamada, taxa operacional e saldo líquido projetado sem criar fan-out caro."
          >
            <SkuCostMonitorPanel skuMonitor={costControls.skuMonitor} rideCostAnomaly={costControls.rideCostAnomaly} />
          </Panel>

          <Panel title="Controle de custo">
            <div className="metric-list">
              <div className="row">
                <div className="label">
                  <span className={costGuardClass(firestoreReadGuard.budgetStatus)}>
                    Firestore backoffice
                  </span>
                  <small>
                    {formatCompact(firestoreReadGuard.dailyEstimatedFirestoreReads)} de{" "}
                    {formatCompact(firestoreReadGuard.dailyBudgetReads)} reads estimados hoje
                  </small>
                </div>
                <div className="value">
                  {costGuardLabel(firestoreReadGuard.budgetStatus)} · {formatPercentValue(firestoreReadGuard.budgetUsagePercent)}
                </div>
              </div>
              <div className="row">
                <div className="label">Custo estimado hoje</div>
                <div className="value">
                  {formatUsd(firestoreReadGuard.dailyEstimatedUsd)} · rota {firestoreReadGuard.routeKey || "-"}
                </div>
              </div>
              <div className="row">
                <div className="label">Reads deste snapshot</div>
                <div className="value">{formatCompact(firestoreReadGuard.estimatedFirestoreReads)}</div>
              </div>
              <div className="row">
                <div className="label">APIs pagas neste snapshot</div>
                <div className="value">
                  <span className={costControls.externalPaidApisCalled ? "status-bad" : "status-ok"}>
                    {costControls.externalPaidApisCalled ? "sim — verificar" : "não"}
                  </span>
                </div>
              </div>
              <div className="row">
                <div className="label">Fan-out do dashboard</div>
                <div className="value">
                  <span className={costControls.dashboardFanOutReduced ? "status-ok" : "status-warn"}>
                    {costControls.dashboardFanOutReduced ? "reduzido (backend agrega)" : "não reduzido"}
                  </span>
                  <small>Dashboard consome só endpoint agregado /ops/command-center</small>
                </div>
              </div>
              <div className="row">
                <div className="label">Cache do snapshot</div>
                <div className="value">
                  <span className={snapshot?.cache?.status === "HIT" ? "status-ok" : "meta-badge"}>
                    {snapshot?.cache?.status || "-"}
                  </span>
                  <small>idade {snapshot?.cache?.ageSeconds ?? "-"}s · TTL {snapshot?.scope?.ttlSeconds || 90}s</small>
                </div>
              </div>
              <div className="row">
                <div className="label">Preço do reads Firestore</div>
                <div className="value">
                  US$ {firestoreReadGuard.readPriceUsdPer100k ?? 0.06}/100k reads
                  <small>Usado para estimar custo dos reads do dashboard</small>
                </div>
              </div>
              <div className="row">
                <div className="label">Mapa operacional</div>
                <div className="value">separado para evitar custo acidental</div>
              </div>
              <div className="row">
                <div className="label">Monitor SKU</div>
                <div className="value">
                  <span className={skuStatusClass(costControls.skuMonitor?.status)}>
                    {skuStatusLabel(costControls.skuMonitor?.status)}
                  </span>
                  <small>Baseado em {formatCompact(costControls.skuMonitor?.sampledRides)} corrida(s) da telemetria recente</small>
                </div>
              </div>
              <div className="row">
                <div className="label">Alerta de custo por corrida</div>
                <div className="value">
                  {costControls.rideCostAnomaly ? (
                    <>
                      <span className={
                        costControls.rideCostAnomaly.status === "danger"
                          ? "status-bad"
                          : costControls.rideCostAnomaly.status === "warning"
                            ? "status-warn"
                            : "status-ok"
                      }>
                        {costControls.rideCostAnomaly.status === "danger"
                          ? "crítico"
                          : costControls.rideCostAnomaly.status === "warning"
                            ? "atenção"
                            : costControls.rideCostAnomaly.status === "healthy"
                              ? "normal"
                              : "sem dados"}
                      </span>
                      <small>
                        {costControls.rideCostAnomaly.status !== "no_data"
                          ? `R$ ${toNumber(costControls.rideCostAnomaly.averageBrl).toFixed(4)} médio · ${costControls.rideCostAnomaly.completedRides} corrida(s)`
                          : "Aguardando telemetria de corridas concluídas"}
                      </small>
                    </>
                  ) : (
                    <span className="meta-badge">não avaliado</span>
                  )}
                </div>
              </div>
            </div>
            <details className="support-advanced-drawer" style={{ marginTop: "0.5rem" }}>
              <summary>Origem dos dados</summary>
              <div className="metric-list" style={{ fontSize: "var(--font-size-sm)" }}>
                <div className="row">
                  <div className="label">Firestore reads</div>
                  <div className="value">Contador Redis via backoffice-cost-guard-service.js a cada request</div>
                </div>
                <div className="row">
                  <div className="label">SKU monitor</div>
                  <div className="value">Redis ride_cost_telemetry:recent via backoffice-sku-cost-monitor-service.js</div>
                </div>
                <div className="row">
                  <div className="label">Alerta de custo</div>
                  <div className="value">Redis via ride-cost-alert-service.js — limites RIDE_COST_WARNING_BRL / RIDE_COST_CRITICAL_BRL</div>
                </div>
                <div className="row">
                  <div className="label">Cache</div>
                  <div className="value">Redis TTL={snapshot?.scope?.ttlSeconds || 90}s configurado por BACKOFFICE_COMMAND_CENTER_TTL_SECONDS</div>
                </div>
                <div className="row">
                  <div className="label">Browser → provedores pagos</div>
                  <div className="value">Bloqueado: dashboard proxy para api.leaf.app.br, nunca chama Google/Woovi/Firebase direto</div>
                </div>
              </div>
            </details>
          </Panel>
        </section>

        <section className="grid ops-detail-grid">
          <Panel
            title="Saúde por domínio"
            subtitle="Leitura consolidada para API, socket, Woovi runtime, Redis, Firebase, suporte, campanhas, cadastro, financeiro e workers."
          >
            <DomainHealthRows domains={services.domainHealth || []} />
          </Panel>

          <Panel
            title="Fontes do snapshot"
            subtitle="Tudo consolidado no backend e cacheado para evitar fan-out no navegador."
            actions={<Link href="/observability">Abrir observabilidade</Link>}
          >
            <SourceRows sources={services.sources || []} />
          </Panel>
        </section>
          </div>
        </details>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
