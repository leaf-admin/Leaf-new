"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import { wsService } from "@/src/services/websocket-service";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const periodMap = {
  "24h": "today",
  "3d": "week",
  week: "week",
  month: "month",
};

function brl(value) {
  return `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const [period, setPeriod] = useState("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wsStatus, setWsStatus] = useState("desconectado");
  const [model, setModel] = useState({
    newDrivers: 0,
    newCustomers: 0,
    totalRides: 0,
    ridesRevenue: 0,
    operationalFee: 0,
    subscriptionRevenue: 0,
    reserveFundLosses: 0,
    revenueEvolution: [],
    recentActivity: [],
  });

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }

        const apiPeriod = periodMap[period] || "today";
        const [driversData, customersData, ridesData, feeData, subscriptionData, evolutionData, recentActivity] =
          await Promise.all([
            leafAPI.getNewDrivers(period).catch(() => ({ users: [] })),
            leafAPI.getNewCustomers(period).catch(() => ({ users: [] })),
            leafAPI.getRidesStats(apiPeriod).catch(() => ({})),
            leafAPI.getOperationalFeeStats(apiPeriod).catch(() => ({})),
            leafAPI.getSubscriptionRevenue("30d").catch(() => ({ revenue: { total: 0 } })),
            leafAPI.getRevenueEvolution(30).catch(() => []),
            leafAPI.getRecentActivity().catch(() => ({ activities: [] })),
          ]);

        if (!mounted) return;

        setModel({
          newDrivers: driversData?.users?.length || driversData?.count || 0,
          newCustomers: customersData?.users?.length || customersData?.count || 0,
          totalRides: ridesData?.totalRides || 0,
          ridesRevenue: ridesData?.totalValue || 0,
          operationalFee: feeData?.totalOperationalFee || 0,
          subscriptionRevenue: subscriptionData?.revenue?.total || subscriptionData?.total || 0,
          reserveFundLosses: ridesData?.reserveFundLosses || 0,
          revenueEvolution: Array.isArray(evolutionData) ? evolutionData : evolutionData?.data || [],
          recentActivity: recentActivity?.activities || recentActivity?.data || [],
        });
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar dashboard");
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
  }, [period]);

  useEffect(() => {
    let active = true;
    wsService
      .connect()
      .then(() => {
        if (active) setWsStatus("conectado");
      })
      .catch(() => {
        if (active) setWsStatus("erro");
      });

    return () => {
      active = false;
      wsService.disconnect();
    };
  }, []);

  const evolutionMax = useMemo(
    () =>
      Math.max(
        1,
        ...model.revenueEvolution.map((item) =>
          Number(item?.ridesRevenue || 0) + Number(item?.operationalFee || 0) + Number(item?.subscriptionRevenue || 0),
        ),
      ),
    [model.revenueEvolution],
  );

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Dashboard Leaf</h1>
            <p>Usuario: {user?.email || "n/a"}</p>
          </div>
          <div className="filters">
            <span className={wsStatus === "conectado" ? "status-ok" : "status-warn"}>WS: {wsStatus}</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
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
        {loading ? <LoadingState message="Carregando dashboard..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Novos motoristas" value={model.newDrivers} tone="positive" />
          <KpiCard title="Novos clientes" value={model.newCustomers} />
          <KpiCard title="Corridas" value={model.totalRides} />
          <KpiCard title="Receita corridas" value={brl(model.ridesRevenue)} tone="positive" />
          <KpiCard title="Taxa operacional" value={brl(model.operationalFee)} />
          <KpiCard title="Assinaturas" value={brl(model.subscriptionRevenue)} tone="positive" />
          <KpiCard title="Perdas reserva" value={brl(model.reserveFundLosses)} tone="danger" />
        </section>

        <section className="grid">
          <Panel title="Evolucao de receita (30 dias)">
            {model.revenueEvolution.length === 0 ? (
              <p className="text-muted">Sem dados de evolucao.</p>
            ) : (
              <div className="bar-list">
                {model.revenueEvolution.slice(-10).map((item, idx) => {
                  const total =
                    Number(item?.ridesRevenue || 0) +
                    Number(item?.operationalFee || 0) +
                    Number(item?.subscriptionRevenue || 0);
                  const pct = Math.max(0, Math.min((total / evolutionMax) * 100, 100));
                  return (
                    <div key={`${item?.date || "d"}-${idx}`} className="bar-item">
                      <div className="bar-label">
                        <span>{item?.date || `dia ${idx + 1}`}</span>
                        <strong>{brl(total)}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill bar-default" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Atividade recente">
            {model.recentActivity.length === 0 ? (
              <p className="text-muted">Sem eventos recentes.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Horario</th>
                    <th>Tipo</th>
                    <th>Descricao</th>
                  </tr>
                </thead>
                <tbody>
                  {model.recentActivity.slice(0, 15).map((event, idx) => (
                    <tr key={event.id || `${event.timestamp}-${idx}`}>
                      <td>{event.timestamp ? new Date(event.timestamp).toLocaleString("pt-BR") : "-"}</td>
                      <td>{event.type || event.event || "-"}</td>
                      <td>{event.description || event.message || JSON.stringify(event)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Payload bruto">
            <pre>{JSON.stringify(model, null, 2)}</pre>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
