"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const grafanaBase = process.env.NEXT_PUBLIC_GRAFANA_URL || "";
const POLL_INTERVAL_MS = 5000;

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
};

export default function ObservabilityPage() {
  const [metrics, setMetrics] = useState(null);
  const [systemStatus, setSystemStatus] = useState([]);
  const [monitoringHealth, setMonitoringHealth] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  useEffect(() => {
    let mounted = true;
    let firstLoad = true;

    const load = async () => {
      try {
        if (mounted && firstLoad) {
          setLoading(true);
        }
        setError("");

        const [metricsResult, systemResult, healthResult] = await Promise.allSettled([
          leafAPI.getObservabilityMetrics(),
          leafAPI.getSystemStatus(),
          leafAPI.getMonitoringHealth(),
        ]);

        if (!mounted) return;

        if (metricsResult.status === "fulfilled") {
          setMetrics(metricsResult.value || null);
        }
        if (systemResult.status === "fulfilled") {
          setSystemStatus(Array.isArray(systemResult.value) ? systemResult.value : []);
        }
        if (healthResult.status === "fulfilled") {
          setMonitoringHealth(healthResult.value || null);
        }

        const failed = [metricsResult, systemResult, healthResult].filter((result) => result.status === "rejected");
        if (failed.length === 3) {
          setError("Falha ao carregar dados de observabilidade.");
        }

        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar observabilidade");
      } finally {
        if (mounted) {
          setLoading(false);
          firstLoad = false;
        }
      }
    };

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
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
  const realtimeByChannel = useMemo(() => metrics?.realtime?.byChannel || {}, [metrics?.realtime?.byChannel]);
  const realtimeChannels = useMemo(
    () =>
      Object.entries(realtimeByChannel)
        .map(([channel, payload]) => ({
          channel,
          total: toNumber(payload?.total),
          results: payload?.results || {},
        }))
        .sort((a, b) => b.total - a.total),
    [realtimeByChannel],
  );
  const createBookingErrors = useMemo(() => metrics?.critical?.createBooking?.topErrors || [], [metrics?.critical?.createBooking?.topErrors]);
  const operationalIndicators = useMemo(
    () => metrics?.critical?.operationalIndicators || {},
    [metrics?.critical?.operationalIndicators],
  );
  const commandRows = useMemo(
    () =>
      Object.entries(metrics?.commands?.byCommand || {})
        .map(([commandName, payload]) => ({
          commandName,
          total: toNumber(payload?.total),
          success: toNumber(payload?.success),
          failures: toNumber(payload?.failures),
        }))
        .sort((a, b) => b.total - a.total),
    [metrics?.commands?.byCommand],
  );
  const hotpathRows = useMemo(
    () =>
      Object.entries(metrics?.hotpath?.byPath || {})
        .map(([pathName, payload]) => ({
          pathName,
          total: toNumber(payload?.total),
          success: toNumber(payload?.success),
          failures: toNumber(payload?.failures),
          avgLatencyMs: toNumber(payload?.avgLatencyMs),
        }))
        .sort((a, b) => b.total - a.total),
    [metrics?.hotpath?.byPath],
  );

  const quickLinks = [
    { name: "Grafana", href: grafanaBase || null },
    { name: "Traces", href: grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/explore` : null },
    { name: "Dashboards", href: grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/dashboards` : null },
  ].filter((item) => item.href);

  return (
    <ProtectedRoute>
      <main className="page-shell usage-page-shell">
        <AppNav />
        <section className="usage-page-card">
          <header className="header usage-header">
            <div>
              <h1>Usage</h1>
              <p>Painel em tempo real para disponibilidade e sinais críticos.</p>
            </div>
            <div className="filters usage-toolbar">
              <span className="meta-badge">All projects</span>
              <span className="meta-badge">{formatDateTime(metrics?.timestamp || lastUpdatedAt)}</span>
              <span className="meta-badge">Atualização: {POLL_INTERVAL_MS / 1000}s</span>
              <button type="button">Export</button>
            </div>
          </header>
        {loading ? <LoadingState message="Carregando observabilidade..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Create Booking Erros" value={toNumber(metrics?.critical?.createBooking?.errors)} tone={toNumber(metrics?.critical?.createBooking?.errors) > 0 ? "danger" : "positive"} />
          <KpiCard title="Create Booking Erro %" value={`${toNumber(metrics?.critical?.createBooking?.errorRatePct).toFixed(2)}%`} tone={toNumber(metrics?.critical?.createBooking?.errorRatePct) > 1 ? "danger" : "positive"} />
          <KpiCard title="auth_busy_retries" value={toNumber(operationalIndicators?.authBusyRetries)} tone={toNumber(operationalIndicators?.authBusyRetries) > 0 ? "warning" : "positive"} />
          <KpiCard title="setDriverStatus_errors" value={toNumber(operationalIndicators?.setDriverStatusErrors)} tone={toNumber(operationalIndicators?.setDriverStatusErrors) > 0 ? "warning" : "positive"} />
          <KpiCard title="online_not_ready" value={toNumber(operationalIndicators?.onlineNotReady)} tone={toNumber(operationalIndicators?.onlineNotReady) > 0 ? "warning" : "positive"} />
          <KpiCard title="location_required" value={toNumber(operationalIndicators?.locationRequired)} tone={toNumber(operationalIndicators?.locationRequired) > 0 ? "warning" : "positive"} />
          <KpiCard title="create_booking_retry" value={toNumber(operationalIndicators?.createBookingRetry)} tone={toNumber(operationalIndicators?.createBookingRetry) > 0 ? "warning" : "positive"} />
          <KpiCard title="doc_in_review" value={toNumber(operationalIndicators?.docInReview)} tone={toNumber(operationalIndicators?.docInReview) > 0 ? "warning" : "positive"} />
          <KpiCard title="doc_failed" value={toNumber(operationalIndicators?.docFailed)} tone={toNumber(operationalIndicators?.docFailed) > 0 ? "danger" : "positive"} />
          <KpiCard title="Socket Busy Timeout" value={toNumber(metrics?.critical?.socketAdmission?.busyTimeout)} tone={toNumber(metrics?.critical?.socketAdmission?.busyTimeout) > 0 ? "warning" : "positive"} />
          <KpiCard title="Redis Ops" value={metrics?.redis?.operations?.total || 0} />
          <KpiCard
            title="Redis Erros"
            value={metrics?.redis?.operations?.errors || 0}
            tone={(metrics?.redis?.operations?.errors || 0) > 0 ? "danger" : "positive"}
          />
          <KpiCard title="Event Loop P95" value={`${toNumber(metrics?.eventLoopLag?.p95Ms).toFixed(2)} ms`} tone={toNumber(metrics?.eventLoopLag?.p95Ms) > 100 ? "danger" : "positive"} />
          <KpiCard title="Workers Ativos" value={toNumber(metrics?.workers?.total)} />
          <KpiCard title="Rides Solicitadas" value={toNumber(metrics?.rides?.requested)} />
          <KpiCard title="Rides Concluídas" value={toNumber(metrics?.rides?.completed)} />
          <KpiCard
            title="Latencia P95"
            value={`${Number(metrics?.redis?.latency?.p95 || 0).toFixed(2)} ms`}
            tone="warning"
          />
          <KpiCard title="Events publicados" value={metrics?.events?.published || 0} />
          <KpiCard title="Events consumidos" value={metrics?.events?.consumed || 0} />
          <KpiCard
            title="OTEL Ingest"
            value={metrics?.otel?.ingest?.totalRequests || 0}
            tone={(metrics?.otel?.enabled && (metrics?.otel?.ingest?.totalRequests || 0) > 0) ? "positive" : "warning"}
          />
          <KpiCard
            title="Command failures"
            value={metrics?.commands?.failures || 0}
            tone={(metrics?.commands?.failures || 0) > 0 ? "danger" : "positive"}
          />
        </section>

        <section className="grid">
          <Panel title="Sinais Críticos (P0)">
            <KeyValueGrid
              data={{
                createBookingErrors: toNumber(metrics?.critical?.createBooking?.errors),
                createBookingErrorRatePct: `${toNumber(metrics?.critical?.createBooking?.errorRatePct).toFixed(2)}%`,
                requestRideFailures: toNumber(metrics?.critical?.requestRideCommand?.failures),
                requestRideFailureRatePct: `${toNumber(metrics?.critical?.requestRideCommand?.failureRatePct).toFixed(2)}%`,
                authBusy: toNumber(metrics?.critical?.auth?.authBusy),
                authInvalidToken: toNumber(metrics?.critical?.auth?.invalidToken),
                onlineNotReady: toNumber(metrics?.critical?.driverOnlineGate?.onlineNotReady),
                locationRequired: toNumber(metrics?.critical?.driverOnlineGate?.locationRequired),
                socketBusyRetry: toNumber(metrics?.critical?.socketAdmission?.busyRetry),
                socketBusyTimeout: toNumber(metrics?.critical?.socketAdmission?.busyTimeout),
                authBusyRetries: toNumber(operationalIndicators?.authBusyRetries),
                setDriverStatusErrors: toNumber(operationalIndicators?.setDriverStatusErrors),
                createBookingRetry: toNumber(operationalIndicators?.createBookingRetry),
                docInReview: toNumber(operationalIndicators?.docInReview),
                docFailed: toNumber(operationalIndicators?.docFailed),
              }}
              labels={{
                createBookingErrors: "Create booking com erro",
                createBookingErrorRatePct: "Taxa de erro create booking",
                requestRideFailures: "Falhas request_ride",
                requestRideFailureRatePct: "Taxa falha request_ride",
                authBusy: "Auth busy",
                authInvalidToken: "Auth token inválido",
                onlineNotReady: "ONLINE_NOT_READY",
                locationRequired: "LOCATION_REQUIRED",
                socketBusyRetry: "Socket admission retry",
                socketBusyTimeout: "Socket admission timeout",
                authBusyRetries: "auth_busy_retries",
                setDriverStatusErrors: "setDriverStatus_errors",
                createBookingRetry: "create_booking_retry",
                docInReview: "doc_in_review",
                docFailed: "doc_failed",
              }}
            />
          </Panel>

          <Panel title="Create Booking - Top Erros">
            {createBookingErrors.length === 0 ? (
              <p className="text-muted">Sem erros de create_booking registrados no período atual.</p>
            ) : (
              <div className="bar-list">
                {createBookingErrors.map((item) => (
                  <div key={item.error} className="bar-item">
                    <div className="bar-label">
                      <span>{item.error}</span>
                      <strong>{toNumber(item.count)}</strong>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill bar-danger"
                        style={{
                          width: `${Math.max(4, (toNumber(item.count) / Math.max(1, toNumber(createBookingErrors[0]?.count))) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

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

          <Panel title="Health de Serviços">
            <div className="filters">
              <span className={monitoringHealth?.status === "healthy" ? "status-ok" : monitoringHealth?.status === "warning" || monitoringHealth?.status === "degraded" ? "status-warn" : "status-bad"}>
                Overall: {monitoringHealth?.status || "n/a"}
              </span>
              <span className="meta-badge">Checks: {Object.keys(monitoringHealth?.checks || {}).length}</span>
            </div>
            <KeyValueGrid
              data={{
                redis: monitoringHealth?.checks?.redis?.status || "n/a",
                firebase: monitoringHealth?.checks?.firebase?.status || "n/a",
                websocket: monitoringHealth?.checks?.websocket?.status || "n/a",
                system: monitoringHealth?.checks?.system?.status || "n/a",
              }}
              labels={{
                redis: "Redis",
                firebase: "Firebase",
                websocket: "WebSocket",
                system: "Sistema",
              }}
            />
            <TechnicalDetails title="Serviços detalhados" data={{ monitoringHealth, systemStatus }} />
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

          <Panel title="Realtime por Canal">
            {realtimeChannels.length === 0 ? (
              <p className="text-muted">Sem volume realtime registrado.</p>
            ) : (
              <div className="list-scroll">
                <div className="metric-list">
                  {realtimeChannels.map((channel) => (
                    <div key={channel.channel} className="row">
                      <div className="label">{channel.channel}</div>
                      <div className="value">{toNumber(channel.total)}</div>
                      <div className="text-muted">
                        {Object.entries(channel.results)
                          .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
                          .slice(0, 4)
                          .map(([result, count]) => `${result}: ${toNumber(count)}`)
                          .join(" | ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Fluxo de Corrida (Commands)">
            {commandRows.length === 0 ? (
              <p className="text-muted">Sem métricas de comando disponíveis.</p>
            ) : (
              <div className="bar-list">
                {commandRows.slice(0, 10).map((row) => {
                  const failureRate = row.total > 0 ? (row.failures / row.total) * 100 : 0;
                  return (
                    <div key={row.commandName} className="bar-item">
                      <div className="bar-label">
                        <span>{row.commandName}</span>
                        <strong>{row.total}</strong>
                      </div>
                      <div className="bar-track">
                        <div
                          className={`bar-fill ${failureRate > 2 ? "bar-danger" : failureRate > 0 ? "bar-warning" : "bar-positive"}`}
                          style={{ width: `${Math.max(3, (row.total / Math.max(1, commandRows[0]?.total || 1)) * 100)}%` }}
                        />
                      </div>
                      <p className="text-muted">falhas: {row.failures} ({failureRate.toFixed(2)}%)</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Hotpath">
            <KeyValueGrid
              data={{
                total: toNumber(metrics?.hotpath?.total),
                failures: toNumber(metrics?.hotpath?.failures),
                avgLatencyMs: toNumber(metrics?.hotpath?.avgLatencyMs).toFixed(2),
                eventLoopMeanMs: toNumber(metrics?.eventLoopLag?.meanMs).toFixed(2),
                eventLoopP95Ms: toNumber(metrics?.eventLoopLag?.p95Ms).toFixed(2),
                eventLoopMaxMs: toNumber(metrics?.eventLoopLag?.maxMs).toFixed(2),
              }}
              labels={{
                total: "Eventos hotpath",
                failures: "Falhas hotpath",
                avgLatencyMs: "Latência média hotpath (ms)",
                eventLoopMeanMs: "Event loop média (ms)",
                eventLoopP95Ms: "Event loop p95 (ms)",
                eventLoopMaxMs: "Event loop máx (ms)",
              }}
            />
            {hotpathRows.length > 0 ? (
              <div className="bar-list">
                {hotpathRows.slice(0, 8).map((row) => (
                  <div key={row.pathName} className="bar-item">
                    <div className="bar-label">
                      <span>{row.pathName}</span>
                      <strong>{row.total}</strong>
                    </div>
                    <div className="bar-track">
                      <div
                        className={row.failures > 0 ? "bar-fill bar-warning" : "bar-fill bar-positive"}
                        style={{ width: `${Math.max(3, (row.total / Math.max(1, hotpathRows[0]?.total || 1)) * 100)}%` }}
                      />
                    </div>
                    <p className="text-muted">avg: {row.avgLatencyMs.toFixed(2)}ms | falhas: {row.failures}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel title="Redis">
            <KeyValueGrid
              data={{
                totalOps: metrics?.redis?.operations?.total || 0,
                errors: metrics?.redis?.operations?.errors || 0,
                p50LatencyMs: Number(metrics?.redis?.latency?.p50 || 0).toFixed(2),
                p95LatencyMs: Number(metrics?.redis?.latency?.p95 || 0).toFixed(2),
                poolHits: metrics?.redis?.pool?.hits || 0,
                poolMisses: metrics?.redis?.pool?.misses || 0,
              }}
              labels={{
                totalOps: "Operacoes totais",
                errors: "Erros",
                p50LatencyMs: "Latencia p50 (ms)",
                p95LatencyMs: "Latencia p95 (ms)",
                poolHits: "Pool hits",
                poolMisses: "Pool misses",
              }}
            />
          </Panel>
          <Panel title="System">
            <KeyValueGrid data={metrics?.system || {}} />
          </Panel>
          <Panel title="Rides / Workers">
            <KeyValueGrid
              data={{
                ridesRequested: toNumber(metrics?.rides?.requested),
                ridesAccepted: toNumber(metrics?.rides?.accepted),
                ridesCancelled: toNumber(metrics?.rides?.cancelled),
                ridesCompleted: toNumber(metrics?.rides?.completed),
                timeToAcceptAvgSec: toNumber(metrics?.rides?.timeToAcceptAvgSec).toFixed(2),
                rideDurationAvgSec: toNumber(metrics?.rides?.rideDurationAvgSec).toFixed(2),
                workersTotal: toNumber(metrics?.workers?.total),
              }}
              labels={{
                ridesRequested: "Corridas solicitadas",
                ridesAccepted: "Corridas aceitas",
                ridesCancelled: "Corridas canceladas",
                ridesCompleted: "Corridas concluídas",
                timeToAcceptAvgSec: "Tempo médio até aceite (s)",
                rideDurationAvgSec: "Duração média corrida (s)",
                workersTotal: "Workers ativos",
              }}
            />
          </Panel>
          <Panel title="OTEL / Tracing">
            <KeyValueGrid
              data={{
                enabled: metrics?.otel?.enabled || false,
                ingestRequests: metrics?.otel?.ingest?.totalRequests || 0,
                ingestErrors: metrics?.otel?.ingest?.errors || 0,
                tracesExported: metrics?.otel?.traces?.exported || 0,
                spansDropped: metrics?.otel?.traces?.dropped || 0,
              }}
              labels={{
                enabled: "OTEL habilitado",
                ingestRequests: "Requisicoes de ingest",
                ingestErrors: "Erros de ingest",
                tracesExported: "Traces exportados",
                spansDropped: "Spans descartados",
              }}
            />
          </Panel>
          <Panel title="Commands/Events">
            <KeyValueGrid
              data={{
                commandFailures: metrics?.commands?.failures || 0,
                commandProcessed: metrics?.commands?.processed || 0,
                eventsPublished: metrics?.events?.published || 0,
                eventsConsumed: metrics?.events?.consumed || 0,
              }}
              labels={{
                commandFailures: "Falhas em comandos",
                commandProcessed: "Comandos processados",
                eventsPublished: "Eventos publicados",
                eventsConsumed: "Eventos consumidos",
              }}
            />
            <TechnicalDetails
              title="Ver payload técnico completo"
              data={{
                metrics: metrics || {},
                monitoringHealth: monitoringHealth || {},
                systemStatus: systemStatus || [],
              }}
            />
          </Panel>
        </section>
        <ErrorText message={error} />
        </section>
      </main>
    </ProtectedRoute>
  );
}
