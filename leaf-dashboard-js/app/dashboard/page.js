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

function hasSnapshotData(snapshot) {
  return Boolean(snapshot && typeof snapshot.status === "string" && snapshot.status.length > 0);
}

function snapshotText(snapshot, value) {
  return hasSnapshotData(snapshot) ? value : "—";
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

const TASK_COPY = {
  "support-sla": {
    title: "Responder tickets atrasados",
    description: "Há atendimentos que já passaram do prazo combinado.",
  },
  "support-owner": {
    title: "Distribuir tickets sem responsável",
    description: "Atribua cada atendimento para alguém da equipe.",
  },
  "driver-docs": {
    title: "Aprovar documentos de motoristas",
    description: "Confira os documentos pendentes e decida na ficha do motorista.",
  },
  "payment-global-sandbox": {
    title: "Revisar ambiente de cobrança",
    description: "O ambiente de testes está ativo para toda a operação.",
  },
  "payment-canary-profile": {
    title: "Preparar cobrança de teste",
    description: "Configure um perfil sandbox antes de testar um pagamento.",
  },
  "workers-attention": {
    title: "Verificar processamento",
    description: "Há eventos aguardando processamento no sistema.",
  },
  "sku-cost-monitor": {
    title: "Revisar custo por corrida",
    description: "O custo operacional está acima do esperado.",
  },
  "ride-cost-anomaly": {
    title: "Revisar custo de uma corrida",
    description: "Uma corrida ficou acima do limite de custo configurado.",
  },
  "directions-anomaly": {
    title: "Revisar uso de rotas",
    description: "O uso de rotas por corrida está acima do limite de acompanhamento.",
  },
};

function taskPriorityLabel(priority) {
  if (priority === "alta") return "Urgente";
  if (priority === "media") return "Hoje";
  return "Acompanhar";
}

function presentTask(item) {
  const id = String(item?.id || "");
  const copy = TASK_COPY[id];
  if (copy) return { ...item, ...copy };
  if (id.startsWith("source-")) {
    return {
      ...item,
      title: "Verificar serviço da plataforma",
      description: [item?.title, item?.description].filter(Boolean).join(" · "),
    };
  }
  return {
    ...item,
    title: item?.title || item?.label || "Tarefa operacional",
    description: item?.description || item?.detail || "Verifique o fluxo indicado.",
  };
}

function ActionItems({ items = [] }) {
  if (!items.length) return <p className="text-muted">Sem ações sugeridas agora.</p>;
  return (
    <div className="metric-list task-queue-list">
      {items.map((rawItem) => {
        const item = presentTask(rawItem);
        const tone = item.priority === "alta" ? "status-bad" : item.priority === "media" ? "status-warn" : "status-ok";
        return (
          <div className="row task-queue-row" key={item.id || item.title || item.description}>
            <div className="label task-queue-main">
              <span className={tone}>{taskPriorityLabel(item.priority)}</span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </div>
            <div className="value">
              <Link className="task-queue-action" href={item.href || "/dashboard"}>Resolver</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyTaskQueue({ snapshot, items }) {
  if (!hasSnapshotData(snapshot)) return null;
  const hasTasks = items.length > 0;
  return (
    <section className="ops-attention-panel" aria-label="Tarefas de hoje">
      <Panel
        title="Tarefas de hoje"
        subtitle="Resolva primeiro o que depende de uma decisão da equipe."
      >
        {hasTasks ? (
          <ActionItems items={items} />
        ) : (
          <div className="task-queue-empty">
            <span className="status-ok">Tudo em dia</span>
            <strong>Nenhuma tarefa crítica agora</strong>
            <p>A operação continua sendo acompanhada automaticamente.</p>
          </div>
        )}
      </Panel>
    </section>
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

function OperationsTrendPanel({ points = [] }) {
  const chartPoints = Array.isArray(points) ? points.slice(-24) : [];
  const hasActivity = chartPoints.some(
    (point) => toNumber(point?.rides) > 0 || toNumber(point?.gmvCents) > 0,
  );

  if (!chartPoints.length || !hasActivity) {
    return (
      <section className="ops-trend-panel" aria-label="Ritmo operacional">
        <Panel
          title="Ritmo do dia"
          subtitle="Corridas e GMV por hora, consolidados pelo backend."
        >
          <div className="ops-trend-empty">
            <strong>Sem movimentação registrada hoje</strong>
            <span>O gráfico aparece quando houver uma série horária disponível.</span>
          </div>
        </Panel>
      </section>
    );
  }

  const width = 760;
  const height = 210;
  const padding = { top: 18, right: 18, bottom: 34, left: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxRides = Math.max(1, ...chartPoints.map((point) => toNumber(point.rides)));
  const maxGmv = Math.max(1, ...chartPoints.map((point) => toNumber(point.gmvCents)));
  const columnWidth = chartWidth / chartPoints.length;
  const barWidth = Math.max(7, columnWidth * 0.42);
  const gmvLine = chartPoints
    .map((point, index) => {
      const x = padding.left + columnWidth * index + columnWidth / 2;
      const y = padding.top + chartHeight - (toNumber(point.gmvCents) / maxGmv) * chartHeight;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <section className="ops-trend-panel" aria-label="Ritmo operacional">
      <Panel
        title="Ritmo do dia"
        subtitle="Corridas e GMV por hora, consolidados pelo backend."
        actions={<span className="meta-badge">últimas 24h</span>}
      >
        <div className="ops-trend-legend" aria-hidden="true">
          <span><i className="ops-trend-dot ops-trend-dot-rides" /> Corridas</span>
          <span><i className="ops-trend-dot ops-trend-dot-gmv" /> GMV</span>
        </div>
        <div className="ops-trend-chart-wrap">
          <svg
            className="ops-trend-chart"
            data-testid="ops-trend-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Gráfico horário de corridas e GMV"
          >
            {[0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padding.top + chartHeight - ratio * chartHeight;
              return (
                <line
                  key={ratio}
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  className="ops-trend-gridline"
                />
              );
            })}
            {chartPoints.map((point, index) => {
              const rides = toNumber(point.rides);
              const barHeight = (rides / maxRides) * chartHeight;
              const x = padding.left + columnWidth * index + (columnWidth - barWidth) / 2;
              const y = padding.top + chartHeight - barHeight;
              const showLabel = index === 0 || index === chartPoints.length - 1 || index % 4 === 0;
              return (
                <g key={`${point.label || point.hour}-${index}`}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(2, barHeight)}
                    rx="4"
                    className="ops-trend-bar"
                  >
                    <title>{`${point.label || `${point.hour}:00`}: ${rides} corrida(s), ${brlFromCents(point.gmvCents)} GMV`}</title>
                  </rect>
                  {showLabel ? (
                    <text
                      x={padding.left + columnWidth * index + columnWidth / 2}
                      y={height - 10}
                      textAnchor="middle"
                      className="ops-trend-axis-label"
                    >
                      {point.label || `${point.hour}:00`}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <polyline points={gmvLine} className="ops-trend-line" />
          </svg>
        </div>
        <div className="ops-trend-summary">
          <span>{formatCompact(chartPoints.reduce((sum, point) => sum + toNumber(point.rides), 0))} corridas solicitadas</span>
          <span>{formatCompact(chartPoints.reduce((sum, point) => sum + toNumber(point.completed), 0))} concluídas</span>
          <span>{brlFromCents(chartPoints.reduce((sum, point) => sum + toNumber(point.gmvCents), 0))} GMV</span>
        </div>
      </Panel>
    </section>
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
  const canaryNeedsAttention = canaryReadiness.some((item) => item.status !== "ready");

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
      {canaryNeedsAttention ? (
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
  const driverOnboarding = snapshot?.driverOnboarding || {};
  const supportBreaches = toNumber(support.overdueAckCount) + toNumber(support.overdueFirstResponseCount);
  const hasData = hasSnapshotData(snapshot);

  return [
    {
      id: "operations",
      eyebrow: "Operação",
      title: hasData ? `${formatCompact(metrics.activeRides)} em curso` : "Sem leitura",
      description: "Corridas ao vivo e motoristas.",
      href: "/maps",
      actionLabel: "Ver corridas ao vivo",
      tone: hasData && metrics.totalDrivers > 0 && metrics.activeDrivers === 0 ? "warning" : "default",
      status: hasData && metrics.totalDrivers > 0 && metrics.activeDrivers === 0 ? "sem online" : null,
      metrics: [
        { label: "Motoristas online", value: snapshotText(snapshot, formatCompact(metrics.activeDrivers)) },
        { label: "Finalizadas hoje", value: snapshotText(snapshot, formatCompact(metrics.completedRidesToday)) },
      ],
    },
    {
      id: "driver-onboarding",
      eyebrow: "Cadastros",
      title: hasData ? `${formatCompact(driverOnboarding.pendingDocuments)} pendentes` : "Sem leitura",
      description: "Aprove ou peça correção nos documentos.",
      href: "/drivers/review-queue",
      actionLabel: "Aprovar cadastros",
      tone: hasData && driverOnboarding.pendingDocuments > 0 ? "warning" : "default",
      status: hasData && driverOnboarding.pendingDocuments > 0 ? "ação necessária" : null,
      metrics: [
        { label: "Rejeitados", value: snapshotText(snapshot, formatCompact(driverOnboarding.rejectedDocuments)) },
        { label: "Fila total", value: snapshotText(snapshot, formatCompact(driverOnboarding.totalDocuments)) },
      ],
    },
    {
      id: "finance",
      eyebrow: "Financeiro",
      title: hasData ? `GMV ${brlFromCents(metrics.gmvCents)}` : "Sem leitura",
      description: "Confira pagamentos e repasses.",
      href: "/financial-reconciliation",
      actionLabel: "Conferir pagamentos",
      tone: hasData && metrics.paymentPendingCount > 0 ? "warning" : "default",
      status: hasData && metrics.paymentPendingCount > 0 ? "pendência" : null,
      metrics: [
        { label: "Receita Leaf", value: snapshotText(snapshot, brlFromCents(metrics.grossRevenueCents)) },
        { label: "Pagamentos pendentes", value: snapshotText(snapshot, formatCompact(metrics.paymentPendingCount)) },
      ],
    },
    {
      id: "support",
      eyebrow: "Suporte",
      title: hasData ? `${formatCompact(support.totalOpenTickets)} abertos` : "Sem leitura",
      description: "Atenda tickets e acompanhe prazos.",
      href: "/support",
      actionLabel: "Atender suporte",
      tone: hasData && supportBreaches > 0 ? "danger" : "default",
      status: hasData && supportBreaches > 0 ? "SLA" : null,
      metrics: [
        { label: "Fora do SLA", value: snapshotText(snapshot, formatCompact(supportBreaches)) },
        { label: "Sem responsável", value: snapshotText(snapshot, formatCompact(support.ticketsWithoutOwner)) },
      ],
    },
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
  const driverOnboarding = snapshot?.driverOnboarding || {};
  const support = snapshot?.support || {};
  const supportBreaches = toNumber(support.overdueAckCount) + toNumber(support.overdueFirstResponseCount);
  const pendingCount =
    toNumber(driverOnboarding.pendingDocuments) +
    toNumber(metrics.paymentPendingCount) +
    supportBreaches;

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
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando operação diária..." /> : null}

        <section className="ops-command-strip" aria-label="Resumo operacional">
          <CommandStat
            label="Corridas"
            value={snapshotText(snapshot, `${formatCompact(metrics.activeRides)} em curso`)}
            detail={snapshotText(snapshot, `${formatCompact(metrics.completedRidesToday)} finalizadas hoje`)}
          />
          <CommandStat
            label="Motoristas"
            value={snapshotText(snapshot, `${formatCompact(metrics.activeDrivers)} online`)}
            detail={snapshotText(snapshot, `${formatCompact(metrics.totalDrivers)} cadastrados`)}
          />
          <CommandStat
            label="Vendas e receita"
            value={snapshotText(snapshot, brlFromCents(metrics.gmvCents))}
            detail={snapshotText(snapshot, `Leaf ${brlFromCents(metrics.grossRevenueCents)}`)}
          />
          <CommandStat
            label="Pendências"
            value={snapshotText(snapshot, formatCompact(pendingCount))}
            detail={snapshotText(
              snapshot,
              `cadastros ${formatCompact(driverOnboarding.pendingDocuments)} · pagamentos ${formatCompact(metrics.paymentPendingCount)} · suporte ${formatCompact(supportBreaches)}`,
            )}
            tone={hasSnapshotData(snapshot) && pendingCount > 0 ? "warning" : "default"}
          />
        </section>

        <section className="ops-workspace-grid" aria-label="Janelas principais">
          {workspaces.map((workspace) => (
            <WorkspaceCard key={workspace.id} {...workspace} />
          ))}
        </section>

        <OperationsTrendPanel points={metrics.trend} />

        <DailyTaskQueue snapshot={snapshot} items={attentionItems} />

        <section className="ops-health-panel" aria-label="Saúde da plataforma">
          <Panel
            title="Saúde da plataforma"
            subtitle="Serviços, pagamentos e custos em uma única leitura."
          >
            <CommandCenterHealth snapshot={snapshot} />
          </Panel>
        </section>

        <details className="ops-advanced-panel">
          <summary>Detalhes técnicos e custos</summary>
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
