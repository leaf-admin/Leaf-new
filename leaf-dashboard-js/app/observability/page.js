"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

const grafanaBase = process.env.NEXT_PUBLIC_GRAFANA_URL || "";

export default function ObservabilityPage() {
  const [metrics, setMetrics] = useState(null);
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
        const response = await leafAPI.getObservabilityMetrics();
        if (mounted) setMetrics(response);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar observabilidade");
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

  const opsByType = useMemo(() => metrics?.redis?.operationsByType || {}, [metrics?.redis?.operationsByType]);
  const opsMax = useMemo(
    () => Math.max(1, ...Object.values(opsByType).map((item) => Number(item?.total || 0))),
    [opsByType],
  );

  const quickLinks = [
    { name: "Grafana", href: grafanaBase || null },
    { name: "Traces", href: grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/explore` : null },
    { name: "Dashboards", href: grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/dashboards` : null },
  ].filter((item) => item.href);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Observability</h1>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando observabilidade..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Redis Ops" value={metrics?.redis?.operations?.total || 0} />
          <KpiCard
            title="Redis Erros"
            value={metrics?.redis?.operations?.errors || 0}
            tone={(metrics?.redis?.operations?.errors || 0) > 0 ? "danger" : "positive"}
          />
          <KpiCard
            title="Latencia P95"
            value={`${Number(metrics?.redis?.latency?.p95 || 0).toFixed(2)} ms`}
            tone="warning"
          />
          <KpiCard title="Events publicados" value={metrics?.events?.published || 0} />
          <KpiCard title="Events consumidos" value={metrics?.events?.consumed || 0} />
          <KpiCard
            title="Command failures"
            value={metrics?.commands?.failures || 0}
            tone={(metrics?.commands?.failures || 0) > 0 ? "danger" : "positive"}
          />
        </section>

        <section className="grid">
          <Panel title="Acesso rapido">
            {quickLinks.length === 0 ? (
              <p className="text-muted">Configure NEXT_PUBLIC_GRAFANA_URL para habilitar links operacionais.</p>
            ) : (
              <div className="filters">
                {quickLinks.map((link) => (
                  <a key={link.name} href={link.href} target="_blank" rel="noreferrer" className="nav-link">
                    {link.name}
                  </a>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Redis ops por tipo">
            <div className="bar-list">
              {Object.entries(opsByType).map(([name, payload]) => {
                const value = Number(payload?.total || 0);
                const pct = (value / opsMax) * 100;
                return (
                  <div key={name} className="bar-item">
                    <div className="bar-label">
                      <span>{name}</span>
                      <strong>{value}</strong>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill bar-default" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Redis">
            <pre>{JSON.stringify(metrics?.redis || {}, null, 2)}</pre>
          </Panel>
          <Panel title="System">
            <pre>{JSON.stringify(metrics?.system || {}, null, 2)}</pre>
          </Panel>
          <Panel title="Commands/Events">
            <pre>
              {JSON.stringify(
                {
                  commands: metrics?.commands || {},
                  events: metrics?.events || {},
                },
                null,
                2,
              )}
            </pre>
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
