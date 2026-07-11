"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid } from "@/src/components/ui/DataViews";

const DASHBOARD_REFRESH_MS = 60000;

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCount(value, missingLabel = "Sem dado") {
  const numeric = toOptionalNumber(value);
  return numeric === null ? missingLabel : numeric.toLocaleString("pt-BR");
}

function formatPercent(value, missingLabel = "Sem dado") {
  const numeric = toOptionalNumber(value);
  return numeric === null ? missingLabel : `${numeric.toLocaleString("pt-BR")}%`;
}

function brlFromValue(value, missingLabel = "Sem dado") {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return missingLabel;
  return `R$ ${numeric.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeFinancialMetrics(financial = {}) {
  return {
    totalRevenue: toOptionalNumber(financial.totalRevenue ?? financial.totalValue),
    averageTicket: toOptionalNumber(financial.averageTicket ?? financial.averageValue),
    totalRides: toOptionalNumber(financial.totalRides),
    reconciledRides: toOptionalNumber(financial.reconciledRides),
    pendingReconciliationRides: toOptionalNumber(financial.pendingReconciliationRides),
    reserveFundLosses: toOptionalNumber(financial.reserveFundLosses),
  };
}

export default function MetricsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const [overview, ridesDaily, financial] = await Promise.all([
          leafAPI.getMetricsOverview(),
          leafAPI.getMetricsRidesDaily(),
          leafAPI.getMetricsFinancial(),
        ]);
        if (mounted) setData({ overview, ridesDaily, financial });
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar métricas");
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
  }, []);

  const financialMetrics = useMemo(
    () => normalizeFinancialMetrics(data?.financial || {}),
    [data?.financial],
  );
  const missingLabel = error && data === null ? "Indisponível" : loading && data === null ? "—" : "Sem dado";
  const hasRidesDaily = Boolean(data?.ridesDaily && typeof data.ridesDaily === "object");

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Métricas</h1>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando métricas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Corridas hoje" value={formatCount(data?.ridesDaily?.totalToday, missingLabel)} />
          <KpiCard
            title="Concluídas hoje"
            value={formatCount(data?.ridesDaily?.completedToday, missingLabel)}
            tone="positive"
          />
          <KpiCard
            title="Taxa de Cancelamento"
            value={formatPercent(data?.ridesDaily?.cancellationRate, missingLabel)}
            tone="warning"
          />
          <KpiCard
            title="Receita"
            value={brlFromValue(financialMetrics.totalRevenue, missingLabel)}
            tone="positive"
          />
        </section>

        <section className="grid">
          <Panel className="panel-span-full" title="Distribuição de corridas" subtitle="Leitura operacional do dia.">
            {hasRidesDaily ? (
              <div className="bar-list">
                {[
                  { label: "Total", value: toOptionalNumber(data.ridesDaily.totalToday), tone: "default" },
                  { label: "Completadas", value: toOptionalNumber(data.ridesDaily.completedToday), tone: "positive" },
                  {
                    label: "Canceladas",
                    value: toOptionalNumber(data.ridesDaily.cancelledAfterAcceptance),
                    tone: "danger",
                  },
                ].map((item) => {
                  const max = toOptionalNumber(data.ridesDaily.totalToday);
                  const pct = item.value !== null && max !== null && max > 0
                    ? Math.min((item.value / max) * 100, 100)
                    : 0;
                  return (
                    <div key={item.label} className="bar-item">
                      <div className="bar-label">
                        <span>{item.label}</span>
                        <strong>{formatCount(item.value)}</strong>
                      </div>
                      <div className="bar-track">
                        <div className={`bar-fill bar-${item.tone}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted">Dados diários não disponíveis.</p>
            )}
          </Panel>
        </section>

        <details className="metrics-secondary-disclosure">
          <summary>Métricas secundárias e detalhamento</summary>
          <section className="grid">
            <Panel title="Visão geral">
              <KeyValueGrid
                data={data?.overview || {}}
                labels={{
                  waitlistCount: "Entradas na waitlist",
                  calculatorSimulations: "Simulações do cálculo",
                  totalUsers: "Usuários totais",
                  totalDrivers: "Motoristas totais",
                  totalCustomers: "Passageiros totais",
                }}
              />
            </Panel>
            <Panel title="Corridas diárias">
              <KeyValueGrid
                data={data?.ridesDaily || {}}
                labels={{
                  totalToday: "Corridas hoje",
                  completedToday: "Concluídas hoje",
                  cancelledAfterAcceptance: "Canceladas após aceite",
                  cancellationRate: "Taxa de cancelamento (%)",
                  averagePickupMinutes: "Pickup médio (min)",
                  averageWaitMinutes: "Espera média (min)",
                  averagePaymentApprovalToPickupMinutes: "Pagamento -> embarque (min)",
                }}
                valueFormatter={(key, value) => {
                  const numeric = toOptionalNumber(value);
                  if (numeric === null) return "Sem dado";
                  if (key === "cancellationRate") return `${numeric.toFixed(1)}%`;
                  if (
                    key === "averagePickupMinutes" ||
                    key === "averageWaitMinutes" ||
                    key === "averagePaymentApprovalToPickupMinutes"
                  ) {
                    return `${numeric.toFixed(1)} min`;
                  }
                  return value;
                }}
              />
            </Panel>
            <Panel title="Financeiro">
              <KeyValueGrid
                data={financialMetrics}
                labels={{
                  totalRevenue: "Receita total",
                  averageTicket: "Ticket médio",
                  totalRides: "Corridas contabilizadas",
                  reconciledRides: "Corridas reconciliadas",
                  pendingReconciliationRides: "Pendentes de reconciliação",
                  reserveFundLosses: "Perdas fundo reserva",
                }}
                valueFormatter={(key, value) => {
                  if (["totalRevenue", "averageTicket", "reserveFundLosses"].includes(key)) {
                    return brlFromValue(value);
                  }
                  return formatCount(value);
                }}
              />
            </Panel>
          </section>
        </details>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
