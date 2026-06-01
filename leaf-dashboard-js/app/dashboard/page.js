"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const DASHBOARD_REFRESH_MS = 30000;

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
  if (status === "healthy") return "positive";
  if (status === "warning") return "warning";
  return "danger";
}

function statusClass(status) {
  if (status === "healthy") return "status-ok";
  if (status === "warning") return "status-warn";
  return "status-bad";
}

function statusLabel(status) {
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
        <div className="row" key={item.id}>
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
              {item.title}
            </span>
            <small>{item.description}</small>
          </div>
          <div className="value">
            <Link href={item.href || "/dashboard"}>{item.priority}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function CanaryPackPanel({ canaryPack }) {
  if (!canaryPack) return <p className="text-muted">Canary Pack ainda não carregado.</p>;
  return (
    <div className="canary-pack">
      <div className="canary-pack-summary">
        <div>
          <span>Pagamento</span>
          <strong>{runtimeEnvironmentLabel(canaryPack.paymentRuntime?.defaultEnvironment)}</strong>
          <small>
            {canaryPack.paymentRuntime?.sandboxProfileCount || 0} perfil(is) sandbox ·{" "}
            {canaryPack.paymentRuntime?.canarySandboxEnabled ? "canary habilitado" : "canary por produção"}
          </small>
        </div>
        <Link href={canaryPack.paymentRuntime?.href || "/payment-runtime"}>Ajustar runtime</Link>
      </div>

      <div className="canary-readiness-grid">
        {(canaryPack.readiness || []).map((item) => (
          <article key={item.id} className="canary-readiness-item">
            <span className={readinessClass(item.status)}>{readinessLabel(item.status)}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>

      <div className="canary-link-row">
        {(canaryPack.links || []).map((link) => (
          <Link href={link.href} key={link.href}>{link.label}</Link>
        ))}
      </div>

      <details className="support-advanced-drawer">
        <summary>Checklist do canary</summary>
        <div className="canary-checklist-grid">
          <div>
            <h3>Passos</h3>
            <ul>
              {(canaryPack.flowSteps || []).map((step) => <li key={step}>{step}</li>)}
            </ul>
          </div>
          <div>
            <h3>Sucesso</h3>
            <ul>
              {(canaryPack.successCriteria || []).map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
          </div>
          <div>
            <h3>Falha</h3>
            <ul>
              {(canaryPack.failureCriteria || []).map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}

function SkuCostMonitorPanel({ skuMonitor }) {
  const finance = skuMonitor?.finance || {};
  const rows = Array.isArray(skuMonitor?.rows) ? skuMonitor.rows : [];
  const sampledRides = toNumber(skuMonitor?.sampledRides);
  const completedRidesToday = toNumber(skuMonitor?.completedRidesToday);

  return (
    <div className="sku-monitor">
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

function buildWorkspaces(snapshot) {
  const metrics = snapshot?.dailyMetrics || {};
  const support = snapshot?.support || {};
  const campaigns = snapshot?.campaigns || {};
  const driverOnboarding = snapshot?.driverOnboarding || {};
  const supportBreaches = toNumber(support.overdueAckCount) + toNumber(support.overdueFirstResponseCount);

  return [
    {
      id: "overview",
      eyebrow: "Visão geral",
      title: statusLabel(snapshot?.status),
      description: "Serviços, motoristas ativos, corridas, GMV e receita em um snapshot cacheado.",
      href: "/dashboard",
      actionLabel: "Abrir visão geral",
      tone: statusTone(snapshot?.status),
      status: snapshot?.cache?.status || "-",
      footnote: `ARPU base ${brlFromCents(metrics.arpuBaseCents)} · ticket médio ${brlFromCents(metrics.averageRideTicketCents)}`,
      metrics: [
        { label: "Motoristas ativos", value: formatCompact(metrics.activeDrivers) },
        { label: "Corridas agora", value: formatCompact(metrics.activeRides) },
        { label: "GMV hoje", value: brlFromCents(metrics.gmvCents) },
        { label: "Receita Leaf", value: brlFromCents(metrics.grossRevenueCents) },
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
    {
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
    },
    {
      id: "driver-onboarding",
      eyebrow: "Cadastro motorista",
      title: `${formatCompact(driverOnboarding.pendingDocuments)} documentos pendentes`,
      description: "Fila de cadastro, KYC e documentos de motorista para aprovar sem perder contexto.",
      href: "/drivers/review-queue",
      actionLabel: "Abrir cadastro",
      tone: driverOnboarding.pendingDocuments > 0 ? "warning" : "positive",
      status: driverOnboarding.pendingDocuments > 0 ? "revisar" : "limpo",
      footnote: `Fila total: ${formatCompact(driverOnboarding.totalDocuments)} documentos`,
      metrics: [
        { label: "Pendentes", value: formatCompact(driverOnboarding.pendingDocuments) },
        { label: "Aprovados", value: formatCompact(driverOnboarding.approvedDocuments) },
        { label: "Reprovados", value: formatCompact(driverOnboarding.rejectedDocuments) },
        { label: "Fonte", value: driverOnboarding.reviewQueueSource || "all" },
      ],
    },
  ];
}

export default function DashboardPage() {
  const { user, signOut } = useAuth();
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

    load();
    const timer = setInterval(load, DASHBOARD_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const workspaces = useMemo(() => buildWorkspaces(snapshot), [snapshot]);
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
            <p>Quatro janelas para acompanhar a Leaf sem consumir APIs pagas sem necessidade.</p>
          </div>
          <div className="filters">
            <span className={statusClass(snapshot?.status)}>
              {statusLabel(snapshot?.status)}
            </span>
            <span className="meta-badge">Atualizado {formatTime(snapshot?.generatedAt)}</span>
            <span className="meta-badge">Cache {snapshot?.cache?.status || "-"}</span>
            <button
              onClick={async () => {
                await signOut();
                window.location.href = "/login";
              }}
            >
              Sair
            </button>
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

        <section className="grid ops-detail-grid">
          <Panel
            title="Monitor SKU e margem"
            subtitle="Custo por chamada, taxa operacional e saldo líquido projetado sem criar fan-out caro."
          >
            <SkuCostMonitorPanel skuMonitor={costControls.skuMonitor} />
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
                <div className="value">{costControls.externalPaidApisCalled ? "sim" : "não"}</div>
              </div>
              <div className="row">
                <div className="label">Fan-out do dashboard</div>
                <div className="value">{costControls.dashboardFanOutReduced ? "reduzido" : "não reduzido"}</div>
              </div>
              <div className="row">
                <div className="label">Cache</div>
                <div className="value">
                  {snapshot?.cache?.status || "-"} · idade {snapshot?.cache?.ageSeconds ?? "-"}s
                </div>
              </div>
              <div className="row">
                <div className="label">Mapa operacional</div>
                <div className="value">separado para evitar custo acidental</div>
              </div>
            </div>
          </Panel>
        </section>

        <section className="grid ops-detail-grid">
          <Panel
            title="Ações sugeridas"
            subtitle="Próximo passo operacional calculado no snapshot, sem fan-out no navegador."
          >
            <ActionItems items={snapshot?.actionItems || []} />
          </Panel>

          <Panel
            title="Canary Pack"
            subtitle="Roteiro operacional para testar com backend como fonte de verdade, sem trocar build."
          >
            <CanaryPackPanel canaryPack={snapshot?.canaryPack} />
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

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
