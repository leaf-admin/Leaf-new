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

const periodMap = {
  "24h": "today",
  "3d": "week",
  week: "week",
  month: "month",
};
const DASHBOARD_REFRESH_MS = 120000;

function get(obj, path, fallback = null) {
  if (!obj || !path) return fallback;
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ?? fallback;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)} min`;
}

function formatDecimal(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(2);
}

function brl(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toneGte(value, target) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "warning";
  return Number(value) >= target ? "positive" : "danger";
}

function toneLte(value, target) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "warning";
  return Number(value) <= target ? "positive" : "danger";
}

function worstTone(...tones) {
  if (tones.includes("danger")) return "danger";
  if (tones.includes("warning")) return "warning";
  if (tones.includes("positive")) return "positive";
  return "default";
}

function buildMainSignals(data) {
  const d30 = get(data, "metrics.growth.driverRetentionD30");
  const d60 = get(data, "metrics.growth.driverRetentionD60");
  const ridesPerDriver = get(data, "metrics.drivers.ridesPerDriverPerDay");
  const cpa = get(data, "metrics.financial.driverAcquisitionCost");
  const activation = get(data, "metrics.growth.driverActivationRate");
  const supportResponse = get(data, "metrics.support.averageFirstResponseMinutes");
  const churn = get(data, "metrics.growth.driverChurnRate");

  return [
    {
      id: "retention",
      title: "Retenção D30 / D60",
      value: `${formatPercent(d30)} / ${formatPercent(d60)}`,
      subtitle: "Meta: 65% / 55%",
      tone: worstTone(toneGte(d30, 0.65), toneGte(d60, 0.55)),
    },
    {
      id: "ridesPerDriver",
      title: "Corridas por motorista",
      value: formatDecimal(ridesPerDriver),
      subtitle: "Meta: >= 10 por dia",
      tone: toneGte(ridesPerDriver, 10),
    },
    {
      id: "cpa",
      title: "CPA motorista",
      value: brl(cpa),
      subtitle: "Verba / novos motoristas",
      tone: cpa == null ? "warning" : "default",
    },
    {
      id: "activation",
      title: "Taxa de ativação",
      value: formatPercent(activation),
      subtitle: "Primeira corrida em até 7 dias",
      tone: toneGte(activation, 0.7),
    },
    {
      id: "support",
      title: "1ª resposta suporte",
      value: formatMinutes(supportResponse),
      subtitle: "Meta: <= 30 min",
      tone: toneLte(supportResponse, 30),
    },
    {
      id: "churn",
      title: "Churn motorista",
      value: formatPercent(churn),
      subtitle: "Meta: <= 15%",
      tone: toneLte(churn, 0.15),
    },
  ];
}

function buildActionItems(data) {
  const items = [];
  const d30 = get(data, "metrics.growth.driverRetentionD30");
  const d60 = get(data, "metrics.growth.driverRetentionD60");
  const ridesPerDriver = get(data, "metrics.drivers.ridesPerDriverPerDay");
  const cpa = get(data, "metrics.financial.driverAcquisitionCost");
  const activation = get(data, "metrics.growth.driverActivationRate");
  const supportResponse = get(data, "metrics.support.averageFirstResponseMinutes");
  const supportOverdue = Number(get(data, "metrics.support.overdueFirstResponseCount", 0) || 0);
  const churn = get(data, "metrics.growth.driverChurnRate");

  if ((d30 != null && d30 < 0.65) || (d60 != null && d60 < 0.55)) {
    items.push({
      label: "Retenção",
      text: "Acionar recuperação de motorista inativo e medir retorno por coorte.",
      tone: "status-bad",
    });
  }

  if (activation != null && activation < 0.7) {
    items.push({
      label: "Onboarding",
      text: "Priorizar pendências de KYC/documentos e lembretes de primeira corrida.",
      tone: "status-bad",
    });
  }

  if (ridesPerDriver != null && ridesPerDriver < 10) {
    items.push({
      label: "Oferta",
      text: "Revisar demanda por zona e disparar smart push somente onde houver pedido ativo.",
      tone: "status-warn",
    });
  }

  if ((supportResponse != null && supportResponse > 30) || supportOverdue > 0) {
    items.push({
      label: "Suporte",
      text: "Destravar fila N1/N2 antes de aumentar volume de aquisição.",
      tone: "status-bad",
    });
  }

  if (churn != null && churn > 0.15) {
    items.push({
      label: "Churn",
      text: "Segmentar motoristas sem corrida recente para campanha de winback.",
      tone: "status-bad",
    });
  }

  if (cpa == null) {
    items.push({
      label: "CPA",
      text: "Configurar verba de aquisição para o painel deixar de mostrar custo desconhecido.",
      tone: "status-warn",
    });
  }

  if (items.length === 0) {
    items.push({
      label: "Operação",
      text: "Sem desvio crítico nos sinais principais do período.",
      tone: "status-ok",
    });
  }

  return items.slice(0, 4);
}

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const [period, setPeriod] = useState("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marketplace, setMarketplace] = useState(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }

        const apiPeriod = periodMap[period] || "today";
        const payload = await leafAPI.getMarketplaceMetrics(apiPeriod);

        if (mounted) setMarketplace(payload);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar dashboard");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, DASHBOARD_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [period]);

  const signals = useMemo(() => buildMainSignals(marketplace), [marketplace]);
  const actions = useMemo(() => buildActionItems(marketplace), [marketplace]);
  const dangerCount = signals.filter((signal) => signal.tone === "danger").length;
  const warningCount = signals.filter((signal) => signal.tone === "warning").length;
  const operationTone = dangerCount > 0 ? "status-bad" : warningCount > 0 ? "status-warn" : "status-ok";
  const operationLabel = dangerCount > 0 ? "Atenção agora" : warningCount > 0 ? "Monitorar" : "Operação estável";

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Painel principal</h1>
            <p>Usuario: {user?.email || "n/a"}</p>
          </div>
          <div className="filters">
            <span className={operationTone}>{operationLabel}</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="24h">Ultimas 24h</option>
              <option value="3d">Ultimos 3 dias</option>
              <option value="week">Ultima semana</option>
              <option value="month">Ultimo mes</option>
            </select>
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
        {loading ? <LoadingState message="Carregando painel principal..." /> : null}

        <section className="grid grid-kpi">
          {signals.map((signal) => (
            <KpiCard
              key={signal.id}
              title={signal.title}
              value={signal.value}
              subtitle={signal.subtitle}
              tone={signal.tone}
            />
          ))}
        </section>

        <section className="grid">
          <Panel title="Prioridade operacional">
            <div className="metric-list">
              {actions.map((item) => (
                <div className="row" key={`${item.label}-${item.text}`}>
                  <div className="label">
                    <span className={item.tone}>{item.label}</span>
                  </div>
                  <div className="value">{item.text}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Contexto mínimo">
            <div className="metric-list">
              <div className="row">
                <div className="label">Corridas no período</div>
                <div className="value">{Number(get(marketplace, "metrics.summary.ridesRequested", 0)).toLocaleString("pt-BR")}</div>
              </div>
              <div className="row">
                <div className="label">Motoristas ativos</div>
                <div className="value">{Number(get(marketplace, "metrics.drivers.activeDrivers", 0)).toLocaleString("pt-BR")}</div>
              </div>
              <div className="row">
                <div className="label">Receita total</div>
                <div className="value">{brl(get(marketplace, "metrics.financial.totalRevenue"))}</div>
              </div>
              <div className="row">
                <div className="label">Tickets abertos</div>
                <div className="value">{Number(get(marketplace, "metrics.support.totalOpenTickets", 0)).toLocaleString("pt-BR")}</div>
              </div>
            </div>
          </Panel>
        </section>

        <Panel
          title="Drill-down"
          actions={<span className="meta-badge">Dados completos fora da home</span>}
        >
          <div className="filters">
            <Link href="/metrics/marketplace">Marketplace Health</Link>
            <Link href="/support">Suporte</Link>
            <Link href="/subscriptions">Cobrança</Link>
            <Link href="/notifications">Comunicação</Link>
          </div>
        </Panel>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
