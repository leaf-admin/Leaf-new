"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const DASHBOARD_REFRESH_MS = 30000;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCompact(value) {
  return toNumber(value).toLocaleString("pt-BR", {
    maximumFractionDigits: toNumber(value) >= 1000 ? 1 : 0,
    notation: toNumber(value) >= 10000 ? "compact" : "standard",
  });
}

function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(1)}%`;
}

function brlFromCents(value) {
  return `R$ ${(toNumber(value) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)} min`;
}

function statusTone(status) {
  if (status === "healthy") return "positive";
  if (status === "warning") return "warning";
  return "danger";
}

function statusLabel(status) {
  if (status === "healthy") return "Operação saudável";
  if (status === "warning") return "Atenção operacional";
  return "Ação necessária";
}

function buildKpis(snapshot) {
  const metrics = snapshot?.dailyMetrics || {};
  const support = snapshot?.support || {};
  const campaigns = snapshot?.campaigns || {};
  const status = snapshot?.status || "unhealthy";

  return [
    {
      id: "services",
      title: "Serviços",
      value: statusLabel(status),
      subtitle: `Cache ${snapshot?.cache?.status || "-"} · ${snapshot?.scope?.ttlSeconds || 0}s`,
      tone: statusTone(status),
    },
    {
      id: "drivers",
      title: "Motoristas ativos",
      value: formatCompact(metrics.activeDrivers),
      subtitle: `${formatCompact(metrics.totalDrivers)} cadastrados`,
      tone: metrics.activeDrivers > 0 ? "positive" : "warning",
    },
    {
      id: "rides",
      title: "Corridas em tempo real",
      value: formatCompact(metrics.activeRides),
      subtitle: `${formatCompact(metrics.completedRidesToday)} finalizadas hoje`,
      tone: metrics.activeRides > 0 ? "positive" : "default",
    },
    {
      id: "gmv",
      title: "GMV hoje",
      value: brlFromCents(metrics.gmvCents),
      subtitle: `Ticket médio ${brlFromCents(metrics.averageRideTicketCents)}`,
      tone: "default",
    },
    {
      id: "revenue",
      title: "Receita bruta Leaf",
      value: brlFromCents(metrics.grossRevenueCents),
      subtitle: `ARPU base ${brlFromCents(metrics.arpuBaseCents)}`,
      tone: "default",
    },
    {
      id: "support",
      title: "Suporte aberto",
      value: formatCompact(support.totalOpenTickets),
      subtitle: `${formatCompact(support.overdueAckCount + support.overdueFirstResponseCount)} fora do SLA`,
      tone: support.overdueAckCount + support.overdueFirstResponseCount > 0 ? "danger" : "positive",
    },
    {
      id: "campaigns",
      title: "Campanhas ativas",
      value: formatCompact(campaigns.active),
      subtitle: `${formatCompact(campaigns.impressions)} views · CTR ${formatPercent(campaigns.ctr)}`,
      tone: campaigns.active > 0 ? "positive" : "default",
    },
  ];
}

function SourceRows({ sources = [] }) {
  if (!sources.length) return <p className="text-muted">Sem fontes carregadas.</p>;
  return (
    <div className="metric-list">
      {sources.map((source) => (
        <div className="row" key={source.id}>
          <div className="label">
            <span className={source.status === "ok" ? "status-ok" : "status-bad"}>{source.label}</span>
          </div>
          <div className="value">
            {source.status === "ok" ? `${source.durationMs} ms` : source.error || "falhou"}
          </div>
        </div>
      ))}
    </div>
  );
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

  const kpis = useMemo(() => buildKpis(snapshot), [snapshot]);
  const support = snapshot?.support || {};
  const campaigns = snapshot?.campaigns || {};
  const services = snapshot?.services || {};
  const costControls = snapshot?.costControls || {};

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Command Center</h1>
            <p>Operação diária com snapshot cacheado. Usuário: {user?.email || "n/a"}</p>
          </div>
          <div className="filters">
            <span className={snapshot?.status === "healthy" ? "status-ok" : snapshot?.status === "warning" ? "status-warn" : "status-bad"}>
              {statusLabel(snapshot?.status)}
            </span>
            <span className="meta-badge">Refresh {DASHBOARD_REFRESH_MS / 1000}s</span>
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
        {loading ? <LoadingState message="Carregando command center..." /> : null}

        <section className="grid grid-kpi">
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.id}
              title={kpi.title}
              value={kpi.value}
              subtitle={kpi.subtitle}
              tone={kpi.tone}
            />
          ))}
        </section>

        <section className="grid">
          <Panel
            title="Status dos serviços"
            subtitle="Uma chamada agregada; os detalhes técnicos continuam disponíveis em Observabilidade."
            actions={<Link href="/observability">Abrir detalhes</Link>}
          >
            <SourceRows sources={services.sources || []} />
          </Panel>

          <Panel title="Suporte em tempo real" actions={<Link href="/support">Abrir suporte</Link>}>
            <div className="metric-list">
              <div className="row">
                <div className="label">Tickets abertos</div>
                <div className="value">{formatCompact(support.totalOpenTickets)}</div>
              </div>
              <div className="row">
                <div className="label">Backlog N1 / N2 / N3</div>
                <div className="value">
                  {formatCompact(support.backlogByPriority?.N1)} / {formatCompact(support.backlogByPriority?.N2)} / {formatCompact(support.backlogByPriority?.N3)}
                </div>
              </div>
              <div className="row">
                <div className="label">Sem responsável</div>
                <div className="value">{formatCompact(support.ticketsWithoutOwner)}</div>
              </div>
              <div className="row">
                <div className="label">Mediana 1ª resposta</div>
                <div className="value">{formatMinutes(support.medianFirstResponseMinutes)}</div>
              </div>
            </div>
          </Panel>

          <Panel title="Monitor de campanhas" actions={<Link href="/campaign-center">Abrir campanhas</Link>}>
            <div className="metric-list">
              <div className="row">
                <div className="label">Ativas / pausadas</div>
                <div className="value">{formatCompact(campaigns.active)} / {formatCompact(campaigns.paused)}</div>
              </div>
              <div className="row">
                <div className="label">Impressões / cliques</div>
                <div className="value">{formatCompact(campaigns.impressions)} / {formatCompact(campaigns.clicks)}</div>
              </div>
              <div className="row">
                <div className="label">Valor contratado</div>
                <div className="value">{brlFromCents(campaigns.campaignValueCents)}</div>
              </div>
              <div className="row">
                <div className="label">eCPM / eCPC</div>
                <div className="value">{brlFromCents(campaigns.effectiveCpmCents)} / {brlFromCents(campaigns.effectiveCpcCents)}</div>
              </div>
            </div>
          </Panel>

          <Panel title="Controle de custo">
            <div className="metric-list">
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

        <Panel title="Drill-down">
          <div className="filters">
            <Link href="/observability">Observabilidade</Link>
            <Link href="/metrics/marketplace">Marketplace Health</Link>
            <Link href="/support">Suporte</Link>
            <Link href="/campaign-center">Campanhas</Link>
            <Link href="/maps">Mapa operacional</Link>
          </div>
        </Panel>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
