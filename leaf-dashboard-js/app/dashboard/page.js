"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import { TechnicalDetails } from "@/src/components/ui/DataViews";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

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

function brlFromCents(value) {
  return `R$ ${(toNumber(value) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)} min`;
}

function statusClass(status) {
  if (!status) return "meta-badge";
  if (["healthy", "ok", "ready"].includes(status)) return "status-ok";
  if (["warning", "attention"].includes(status)) return "status-warn";
  return "status-bad";
}

function statusLabel(status) {
  if (status === "healthy") return "Operação saudável";
  if (status === "warning") return "Atenção operacional";
  if (status === "unhealthy") return "Ação necessária";
  return "Aguardando leitura";
}

function priorityTone(priority) {
  if (priority === "alta") return "danger";
  if (priority === "media") return "warning";
  return "positive";
}

function actionTitle(item) {
  return item?.title || item?.label || "Prioridade operacional";
}

function actionDescription(item) {
  return item?.description || item?.detail || "Abra o contexto para revisar a próxima ação.";
}

function PriorityCenter({ status, items = [] }) {
  const primary = items[0] || null;
  const secondary = items.slice(1, 4);
  const tone = primary ? priorityTone(primary.priority) : status === "healthy" ? "positive" : "warning";

  return (
    <section className={`dashboard-action-center dashboard-action-center-${tone}`} aria-labelledby="dashboard-action-title">
      <div className="dashboard-action-copy">
        <span className={primary ? statusClass(primary.priority === "alta" ? "danger" : "warning") : statusClass(status)}>
          {primary ? `${primary.priority || "atenção"}` : statusLabel(status)}
        </span>
        <p className="dashboard-action-eyebrow">Atenção agora</p>
        <h2 id="dashboard-action-title">
          {primary ? actionTitle(primary) : "Nenhuma intervenção crítica neste momento"}
        </h2>
        <p>
          {primary ? actionDescription(primary) : "A operação não sinalizou uma decisão urgente. Continue acompanhando os sinais abaixo."}
        </p>
        {primary ? (
          <Link href={primary.href || "/dashboard"} className="primary-action dashboard-action-link">
            Tratar agora
          </Link>
        ) : (
          <Link href="/maps" className="dashboard-action-secondary-link">Abrir mapa operacional</Link>
        )}
      </div>

      <div className="dashboard-next-actions">
        <p>Na sequência</p>
        {secondary.length ? secondary.map((item, index) => (
          <Link href={item.href || "/dashboard"} key={item.id || `${actionTitle(item)}-${index}`}>
            <span className={`dashboard-priority-dot dashboard-priority-dot-${priorityTone(item.priority)}`} aria-hidden="true" />
            <span>
              <strong>{actionTitle(item)}</strong>
              <small>{actionDescription(item)}</small>
            </span>
          </Link>
        )) : (
          <div className="dashboard-calm-state">
            <strong>Fila limpa</strong>
            <small>Novas prioridades aparecem aqui automaticamente.</small>
          </div>
        )}
      </div>
    </section>
  );
}

function MetricSignal({ label, value, detail, tone = "default", href }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );

  return href ? (
    <Link href={href} className={`dashboard-signal dashboard-signal-${tone}`}>{content}</Link>
  ) : (
    <article className={`dashboard-signal dashboard-signal-${tone}`}>{content}</article>
  );
}

function ActionList({ items = [] }) {
  if (!items.length) {
    return <p className="dashboard-empty-line">Sem pendências calculadas pelo snapshot atual.</p>;
  }

  return (
    <div className="dashboard-action-list">
      {items.map((item, index) => (
        <Link href={item.href || "/dashboard"} key={item.id || `${actionTitle(item)}-${index}`}>
          <span className={`dashboard-priority-marker dashboard-priority-marker-${priorityTone(item.priority)}`} aria-hidden="true" />
          <span>
            <strong>{actionTitle(item)}</strong>
            <small>{actionDescription(item)}</small>
          </span>
          <span className="dashboard-row-action">Abrir</span>
        </Link>
      ))}
    </div>
  );
}

function HealthList({ domains = [] }) {
  if (!domains.length) return <p className="text-muted">Sem leitura de domínios.</p>;
  return (
    <div className="dashboard-compact-list">
      {domains.map((domain, index) => (
        <div key={domain.id || domain.label || domain.name || `domain-${index}`}>
          <span className={statusClass(domain.status)}>{domain.label || domain.name || domain.id || "Domínio"}</span>
          <span>
            <strong>{domain.source || "Leaf"}</strong>
            <small>{domain.action}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function SourceList({ sources = [] }) {
  if (!sources.length) return <p className="text-muted">Sem fontes carregadas.</p>;
  return (
    <div className="dashboard-compact-list">
      {sources.map((source, index) => (
        <div key={source.id || source.label || source.name || `source-${index}`}>
          <span className={source.status === "ok" ? "status-ok" : source.status === "warning" ? "status-warn" : "status-bad"}>
            {source.label}
          </span>
          <span>
            <strong>{source.status === "ok" ? `${source.durationMs} ms` : source.error || "indisponível"}</strong>
            <small>Leitura consolidada no backend</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function OperationalContext({ snapshot }) {
  const metrics = snapshot?.dailyMetrics || {};
  const support = snapshot?.support || {};
  const driverOnboarding = snapshot?.driverOnboarding || {};
  const campaigns = snapshot?.campaigns || {};

  const rows = [
    {
      label: "Corridas concluídas hoje",
      value: formatCompact(metrics.completedRidesToday),
      detail: `Ticket médio ${brlFromCents(metrics.averageRideTicketCents)}`,
      href: "/metrics",
    },
    {
      label: "Suporte aberto",
      value: formatCompact(support.totalOpenTickets),
      detail: `1ª resposta ${formatMinutes(support.medianFirstResponseMinutes)}`,
      href: "/support",
    },
    {
      label: "Documentos pendentes",
      value: formatCompact(driverOnboarding.pendingDocuments),
      detail: `${formatCompact(driverOnboarding.totalDocuments)} na fila total`,
      href: "/drivers/review-queue",
    },
    {
      label: "Campanhas ativas",
      value: formatCompact(campaigns.active),
      detail: `${formatCompact(campaigns.impressions)} impressões`,
      href: "/campaign-center",
    },
  ];

  return (
    <div className="dashboard-context-list">
      {rows.map((row) => (
        <Link href={row.href} key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </Link>
      ))}
    </div>
  );
}

function DiagnosticArea({ snapshot }) {
  const costControls = snapshot?.costControls || {};
  const readGuard = costControls.firestoreReadGuard || {};
  const canaryPack = snapshot?.canaryPack || {};
  const services = snapshot?.services || {};
  const paymentRuntime = snapshot?.paymentRuntime || {};

  return (
    <details className="dashboard-details-disclosure">
      <summary>
        <span>
          <strong>Diagnóstico e governança</strong>
          <small>Custos, canary, serviços e fontes técnicas sob demanda.</small>
        </span>
        <span className="meta-badge">Detalhes</span>
      </summary>
      <div className="dashboard-diagnostic-grid">
        <Panel title="Saúde por domínio" subtitle="Somente sinais consolidados pela Leaf.">
          <HealthList domains={services.domainHealth || []} />
        </Panel>

        <Panel title="Custo do backoffice" subtitle="Leitura de consumo sem fan-out no navegador.">
          <div className="dashboard-fact-list">
            <div><span>Reads hoje</span><strong>{formatCompact(readGuard.dailyEstimatedFirestoreReads)} / {formatCompact(readGuard.dailyBudgetReads)}</strong></div>
            <div><span>Uso do orçamento</span><strong>{toNumber(readGuard.budgetUsagePercent).toFixed(1)}%</strong></div>
            <div><span>Cache</span><strong>{snapshot?.cache?.status || "-"} · {snapshot?.cache?.ageSeconds ?? "-"}s</strong></div>
            <div><span>APIs pagas no snapshot</span><strong>{costControls.externalPaidApisCalled ? "verificar" : "não"}</strong></div>
          </div>
        </Panel>

        <Panel title="Canary e pagamento" subtitle="Contexto do ambiente; nenhuma regra é alterada aqui.">
          <div className="dashboard-fact-list">
            <div><span>Ambiente padrão</span><strong>{paymentRuntime.defaultEnvironment || canaryPack.paymentRuntime?.defaultEnvironment || "-"}</strong></div>
            <div><span>Perfis sandbox</span><strong>{formatCompact(paymentRuntime.sandboxProfileCount ?? canaryPack.paymentRuntime?.sandboxProfileCount)}</strong></div>
            {(canaryPack.readiness || []).slice(0, 4).map((item) => (
              <div key={item.id || item.label}>
                <span>{item.label}</span>
                <strong className={statusClass(item.status)}>{item.status}</strong>
              </div>
            ))}
          </div>
          <Link href="/payment-runtime" className="dashboard-text-link">Abrir perfil de pagamento</Link>
        </Panel>

        <Panel title="Fontes do snapshot" subtitle="Latência e disponibilidade das leituras agregadas.">
          <SourceList sources={services.sources || []} />
        </Panel>
      </div>

      <TechnicalDetails
        title="Payload técnico consolidado"
        data={{
          scope: snapshot?.scope,
          cache: snapshot?.cache,
          costControls,
          canaryPack,
          services,
        }}
      />
    </details>
  );
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!snapshot && !silent) setLoading(true);
      if (snapshot && !silent) setRefreshing(true);
      setError("");
      const payload = await leafAPI.getCommandCenterSnapshot({ hours: 1, period: "today" });
      setSnapshot(payload);
    } catch (err) {
      setError(err?.message || "Falha ao carregar o centro operacional");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [snapshot]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load({ silent: true });
    };
    const timer = window.setInterval(loadWhenVisible, DASHBOARD_REFRESH_MS);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, [load]);

  const actionItems = useMemo(() => snapshot?.actionItems || [], [snapshot]);
  const metrics = snapshot?.dailyMetrics || {};
  const support = snapshot?.support || {};
  const supportRisk = toNumber(support.overdueAckCount) + toNumber(support.overdueFirstResponseCount);
  const pendingPayments = toNumber(metrics.paymentPendingCount);

  return (
    <ProtectedRoute>
      <main className="page-shell dashboard-shell">
        <header className="header dashboard-header">
          <div>
            <p className="dashboard-page-eyebrow">Centro de operação</p>
            <h1>Operação diária</h1>
            <p>Prioridades, saúde e contexto para decidir sem procurar entre dezenas de indicadores.</p>
          </div>
          <div className="dashboard-header-context">
            <span className={statusClass(snapshot?.status)}>{statusLabel(snapshot?.status)}</span>
            <span className="meta-badge">Atualizado {formatTime(snapshot?.generatedAt)}</span>
            <button type="button" onClick={() => load()} disabled={loading || refreshing}>
              {refreshing ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </header>

        <AppNav />
        {loading && !snapshot ? <LoadingState message="Carregando operação diária..." /> : null}
        {!loading && !snapshot ? <ErrorText message={error || "Snapshot indisponível."} /> : null}

        {snapshot ? (
          <>
            <PriorityCenter status={snapshot.status} items={actionItems} />

            <section className="dashboard-signal-grid" aria-label="Sinais prioritários">
              <MetricSignal
                label="Corridas ativas"
                value={formatCompact(metrics.activeRides)}
                detail={`${formatCompact(metrics.completedRidesToday)} concluídas hoje`}
                href="/metrics"
              />
              <MetricSignal
                label="Motoristas disponíveis"
                value={formatCompact(metrics.availableDrivers ?? metrics.activeDrivers)}
                detail={`${formatCompact(metrics.activeDrivers)} online`}
                tone={toNumber(metrics.activeDrivers) > 0 ? "positive" : "warning"}
                href="/maps"
              />
              <MetricSignal
                label="SLA em risco"
                value={formatCompact(supportRisk)}
                detail={`${formatCompact(support.ticketsWithoutOwner)} sem responsável`}
                tone={supportRisk > 0 ? "danger" : "positive"}
                href="/support"
              />
              <MetricSignal
                label="Pagamentos pendentes"
                value={formatCompact(pendingPayments)}
                detail={`Pix em fila ou disputa · GMV ${brlFromCents(metrics.gmvCents)}`}
                tone={pendingPayments > 0 ? "warning" : "positive"}
                href="/financial-reconciliation"
              />
            </section>

            <section className="dashboard-workbench-grid">
              <Panel title="Prioridades operacionais" subtitle="Fila ordenada pelo backend; trate um item por vez.">
                <ActionList items={actionItems} />
              </Panel>
              <Panel title="Contexto ao vivo" subtitle="Sinais complementares, sem repetir a decisão principal.">
                <OperationalContext snapshot={snapshot} />
              </Panel>
            </section>

            <DiagnosticArea snapshot={snapshot} />
            <ErrorText message={error} />
          </>
        ) : null}
      </main>
    </ProtectedRoute>
  );
}
