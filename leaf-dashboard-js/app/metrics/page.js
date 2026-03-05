"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

export default function MetricsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) setLoading(true);
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
    const timer = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Métricas</h1>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando métricas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Waitlist" value={data?.overview?.waitlistCount ?? 0} />
          <KpiCard title="Simulações" value={data?.overview?.calculatorSimulations ?? 0} />
          <KpiCard title="Corridas Hoje" value={data?.ridesDaily?.totalToday ?? 0} />
          <KpiCard
            title="Taxa de Cancelamento"
            value={`${data?.ridesDaily?.cancellationRate ?? 0}%`}
            tone="warning"
          />
          <KpiCard
            title="Receita"
            value={`R$ ${Number(data?.financial?.totalRevenue || 0).toLocaleString("pt-BR")}`}
            tone="positive"
          />
          <KpiCard
            title="Ticket Médio"
            value={`R$ ${Number(data?.financial?.averageTicket || 0).toLocaleString("pt-BR")}`}
          />
        </section>

        <section className="grid">
          <Panel title="Visão geral">
            <pre>{JSON.stringify(data?.overview || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Corridas diárias">
            <pre>{JSON.stringify(data?.ridesDaily || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Financeiro">
            <pre>{JSON.stringify(data?.financial || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Distribuição de corridas (visual)">
            <div className="bar-list">
              {[
                { label: "Total", value: Number(data?.ridesDaily?.totalToday || 0), tone: "default" },
                { label: "Completadas", value: Number(data?.ridesDaily?.completedToday || 0), tone: "positive" },
                {
                  label: "Canceladas",
                  value: Number(data?.ridesDaily?.cancelledAfterAcceptance || 0),
                  tone: "danger",
                },
              ].map((item) => {
                const max = Number(data?.ridesDaily?.totalToday || 1);
                const pct = max > 0 ? Math.min((item.value / max) * 100, 100) : 0;
                return (
                  <div key={item.label} className="bar-item">
                    <div className="bar-label">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                    <div className="bar-track">
                      <div className={`bar-fill bar-${item.tone}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
