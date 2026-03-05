"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const [notifData, statsData] = await Promise.all([
          leafAPI.getNotifications(),
          leafAPI.getNotificationStats(),
        ]);
        if (!mounted) return;
        setNotifications(notifData);
        setStats(statsData);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar notificacoes");
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

  const successRate = useMemo(() => {
    const total = Number(stats?.totalSent || 0);
    const ok = Number(stats?.successful || 0);
    if (total <= 0) return 0;
    return Number(((ok / total) * 100).toFixed(1));
  }, [stats]);

  const endpoints = notifications?.data?.endpoints || {};

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Notificacoes</h1>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando notificacoes..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Enviadas" value={stats?.totalSent || 0} />
          <KpiCard title="Sucesso" value={stats?.successful || 0} tone="positive" />
          <KpiCard
            title="Falhas"
            value={stats?.failed || 0}
            tone={(stats?.failed || 0) > 0 ? "danger" : "positive"}
          />
          <KpiCard title="Taxa de sucesso" value={`${successRate}%`} tone={successRate >= 95 ? "positive" : "warning"} />
        </section>

        <section className="grid">
          <Panel title="Estatisticas do servico">
            <table className="table">
              <tbody>
                <tr>
                  <td>Total enviadas</td>
                  <td>{stats?.totalSent || 0}</td>
                </tr>
                <tr>
                  <td>Sucesso</td>
                  <td>{stats?.successful || 0}</td>
                </tr>
                <tr>
                  <td>Falhas</td>
                  <td>{stats?.failed || 0}</td>
                </tr>
                <tr>
                  <td>Taxa de sucesso</td>
                  <td>{successRate}%</td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <Panel title="Endpoints disponiveis">
            {Object.keys(endpoints).length === 0 ? (
              <p className="text-muted">Nenhum endpoint informado pelo backend.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th>Endpoint</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(endpoints).map(([name, value]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td><code>{String(value)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Payload bruto">
            <pre>{JSON.stringify({ stats, notifications }, null, 2)}</pre>
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
