"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

function summarizeSendResponse(response) {
  const data = response?.data || response || {};
  const summary = data?.summary || response?.summary || {};
  const sent = Number(summary.success ?? data.sent ?? data.successful ?? response?.sent ?? response?.successful ?? 0);
  const failed = Number(summary.failed ?? data.failed ?? response?.failed ?? 0);
  const target = Number(data.sentTo ?? summary.total ?? data.total ?? response?.total ?? sent + failed);

  return {
    sent,
    failed,
    target,
    filteredOutByType: Number(data.filteredOutByType || 0),
    filteredOutByRule: Number(data.filteredOutByRule || 0),
  };
}

function normalizeStatsPayload(stats) {
  const data = stats?.data || stats || {};
  const fcm = data.fcm || data.stats || {};
  const orchestration = data.orchestration || {};
  return {
    fcm,
    orchestration,
    scheduled: Number(data.scheduled || 0),
    policy: data.policy || {},
  };
}

function statusClass(status) {
  if (status === "sent") return "status-ok";
  if (status === "dry_run" || status === "persisted_only" || status === "suppressed") return "status-warn";
  if (status === "failed") return "status-bad";
  return "text-muted";
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [stats, setStats] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [toDrivers, setToDrivers] = useState(true);
  const [toPassengers, setToPassengers] = useState(true);
  const [registeredWithinHours, setRegisteredWithinHours] = useState("");
  const [registeredWithinDays, setRegisteredWithinDays] = useState("");
  const [registeredMoreThanMonths, setRegisteredMoreThanMonths] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const [notifData, statsData, matrixData, historyData] = await Promise.all([
          leafAPI.getNotifications(),
          leafAPI.getNotificationStats(),
          leafAPI.getNotificationOrchestrationMatrix(),
          leafAPI.getNotificationOrchestrationHistory({ limit: 12 }),
        ]);
        if (!mounted) return;
        setNotifications(notifData);
        setStats(statsData);
        setMatrix(matrixData?.data || null);
        setHistory(Array.isArray(historyData?.data?.items) ? historyData.data.items : []);
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

  const statsPayload = useMemo(() => normalizeStatsPayload(stats), [stats]);
  const fcmStats = useMemo(() => statsPayload.fcm || {}, [statsPayload]);
  const fcmDelivery = useMemo(() => fcmStats.delivery || fcmStats || {}, [fcmStats]);
  const orchestrationStats = useMemo(() => statsPayload.orchestration || {}, [statsPayload]);
  const orchestrationMetrics = useMemo(() => orchestrationStats.metrics || {}, [orchestrationStats]);
  const policy = useMemo(
    () => statsPayload.policy || notifications?.data?.policy || {},
    [statsPayload.policy, notifications],
  );
  const matrixEvents = useMemo(() => Object.entries(matrix?.events || {}), [matrix]);
  const rideLifecycleMatrixEvents = useMemo(
    () => matrixEvents.filter(([, config]) => config?.category === "ride_lifecycle"),
    [matrixEvents],
  );

  const successRate = useMemo(() => {
    const total = Number(fcmDelivery?.totalSent || 0);
    const ok = Number(fcmDelivery?.successful || 0);
    if (total <= 0) return 0;
    return Number(((ok / total) * 100).toFixed(1));
  }, [fcmDelivery]);

  const endpoints = useMemo(() => notifications?.data?.endpoints || {}, [notifications]);
  const endpointEntries = useMemo(() => {
    const term = endpointFilter.trim().toLowerCase();
    const entries = Object.entries(endpoints);
    if (!term) return entries;
    return entries.filter(([name, value]) =>
      `${name} ${String(value || "")}`.toLowerCase().includes(term),
    );
  }, [endpoints, endpointFilter]);

  const sendNotification = async () => {
    if (!title.trim() || !body.trim()) {
      setSendStatus("");
      setError("Informe título e mensagem");
      return;
    }

    const userTypes = [];
    if (toDrivers) userTypes.push("driver");
    if (toPassengers) userTypes.push("customer");
    if (userTypes.length === 0) {
      setSendStatus("");
      setError("Selecione pelo menos um público");
      return;
    }

    const filters = {};
    if (registeredWithinHours) filters.registeredWithinHours = Number(registeredWithinHours);
    if (registeredWithinDays) filters.registeredWithinDays = Number(registeredWithinDays);
    if (registeredMoreThanMonths) filters.registeredMoreThanMonths = Number(registeredMoreThanMonths);

    try {
      setSending(true);
      setError("");
      setSendStatus("");

      const response = await leafAPI.sendPushNotification({
        title: title.trim(),
        body: body.trim(),
        userTypes,
        filters,
        data: {
          source: "dashboard_notifications",
          sentAt: new Date().toISOString(),
        },
      });
      const result = summarizeSendResponse(response);

      setSendStatus(
        `Envio concluído: ${result.sent} enviados de ${result.target} alvo(s)` +
        `${result.failed ? `, ${result.failed} falhas` : ""}` +
        `${result.filteredOutByType || result.filteredOutByRule
          ? `, ${result.filteredOutByType + result.filteredOutByRule} filtrados`
          : ""}`
      );
    } catch (err) {
      setError(err?.message || "Falha ao enviar notificação");
    } finally {
      setSending(false);
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Notificações</h1>
            <p>Envio segmentado, saúde de entrega e canais configurados.</p>
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando notificacoes..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Enviadas" value={fcmDelivery?.totalSent || 0} />
          <KpiCard title="Sucesso" value={fcmDelivery?.successful || 0} tone="positive" />
          <KpiCard
            title="Falhas"
            value={fcmDelivery?.failed || 0}
            tone={(fcmDelivery?.failed || 0) > 0 ? "danger" : "positive"}
          />
          <KpiCard title="Taxa de sucesso" value={`${successRate}%`} tone={successRate >= 95 ? "positive" : "warning"} />
        </section>

        <section className="grid grid-kpi">
          <KpiCard title="Tokens ativos" value={fcmStats?.activeTokens || 0} />
          <KpiCard title="Status de corrida" value={fcmDelivery?.rideStatusPushes || 0} />
          <KpiCard title="Orquestradas" value={orchestrationMetrics.sent || 0} />
          <KpiCard
            title="Smart push"
            value={orchestrationStats.smartPushMode || policy.smartPushMode || "disabled"}
            tone={(orchestrationStats.smartPushMode || policy.smartPushMode) === "enabled" ? "warning" : "positive"}
          />
        </section>

        <section className="grid">
          <Panel title="Enviar notificação" subtitle="Mensagem curta com segmentação por perfil e janela de cadastro.">
            <div className="form-grid">
              <label className="form-field">
                Título
                <input
                  placeholder="Título"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="form-field">
                Mensagem
                <input
                  placeholder="Mensagem"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <label className="form-field form-field-checkbox">
                Drivers
                <input type="checkbox" checked={toDrivers} onChange={(e) => setToDrivers(e.target.checked)} />
              </label>
              <label className="form-field form-field-checkbox">
                Passageiros
                <input type="checkbox" checked={toPassengers} onChange={(e) => setToPassengers(e.target.checked)} />
              </label>
              <label className="form-field">
                Últimas horas
                <input
                  type="number"
                  min="1"
                  placeholder="Ex.: 24"
                  value={registeredWithinHours}
                  onChange={(e) => setRegisteredWithinHours(e.target.value)}
                />
              </label>
              <label className="form-field">
                Últimos dias
                <input
                  type="number"
                  min="1"
                  placeholder="Ex.: 7"
                  value={registeredWithinDays}
                  onChange={(e) => setRegisteredWithinDays(e.target.value)}
                />
              </label>
              <label className="form-field">
                Mais de X meses
                <input
                  type="number"
                  min="1"
                  placeholder="Ex.: 3"
                  value={registeredMoreThanMonths}
                  onChange={(e) => setRegisteredMoreThanMonths(e.target.value)}
                />
              </label>
              <button onClick={sendNotification} disabled={sending}>
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
            {sendStatus ? <p className="status-ok">{sendStatus}</p> : null}
          </Panel>

          <Panel title="Endpoints disponiveis">
            <div className="filters">
              <input
                placeholder="Filtrar endpoint/canal"
                value={endpointFilter}
                onChange={(e) => setEndpointFilter(e.target.value)}
              />
            </div>
            {endpointEntries.length === 0 ? (
              <p className="text-muted">Nenhum endpoint informado pelo backend.</p>
            ) : (
              <div className="table-shell">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Endpoint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpointEntries.map(([name, value]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td><code>{String(value)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Saúde de entregas">
            <KeyValueGrid
              data={{
                totalSent: fcmDelivery?.totalSent || 0,
                successful: fcmDelivery?.successful || 0,
                failed: fcmDelivery?.failed || 0,
                successRate: `${successRate}%`,
                endpointsConfigured: Object.keys(endpoints).length,
                rideStatusPushes: fcmDelivery?.rideStatusPushes || 0,
                invalidTokensRemoved: fcmDelivery?.invalidTokensRemoved || 0,
                matrixVersion: policy.matrixVersion || orchestrationStats.version || "-",
                directSendEnabled: policy.directSendEnabled ? "sim" : "não",
                smartPushMode: orchestrationStats.smartPushMode || policy.smartPushMode || "disabled",
              }}
              labels={{
                totalSent: "Envios totais",
                successful: "Envios com sucesso",
                failed: "Falhas",
                successRate: "Taxa de sucesso",
                endpointsConfigured: "Canais configurados",
                rideStatusPushes: "Timeline de corrida",
                invalidTokensRemoved: "Tokens inválidos limpos",
                matrixVersion: "Versão da matriz",
                directSendEnabled: "Envio direto real",
                smartPushMode: "Smart push",
              }}
            />
            <TechnicalDetails
              title="Ver payload técnico de notificações"
              data={{ stats, notifications, matrix, history }}
            />
          </Panel>

          <Panel
            title="Matriz do ciclo da corrida"
            subtitle="Eventos críticos com TTL, dedupe e persistência. Smart push fica em dry-run até aprovação operacional."
          >
            {rideLifecycleMatrixEvents.length === 0 ? (
              <p className="text-muted">Matriz ainda não carregada.</p>
            ) : (
              <div className="table-shell">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Canais</th>
                      <th>TTL</th>
                      <th>Dedupe</th>
                      <th>Persistente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rideLifecycleMatrixEvents.map(([eventType, config]) => (
                      <tr key={eventType}>
                        <td><code>{eventType}</code></td>
                        <td>{(config.channels || []).join(", ")}</td>
                        <td>{config.ttlSeconds ? `${config.ttlSeconds}s` : "-"}</td>
                        <td>{config.dedupeWindowSeconds ? `${config.dedupeWindowSeconds}s` : "-"}</td>
                        <td>{config.persistentRideStatus ? "sim" : "não"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Histórico recente" subtitle="Últimas decisões do orquestrador: enviado, dry-run, persistido ou suprimido.">
            {history.length === 0 ? (
              <p className="text-muted">Sem histórico recente para hoje.</p>
            ) : (
              <div className="table-shell">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Evento</th>
                      <th>Usuário</th>
                      <th>Canal</th>
                      <th>Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id || `${item.eventType}-${item.updatedAt}`}>
                        <td><span className={statusClass(item.status)}>{item.status || "-"}</span></td>
                        <td><code>{item.eventType || "-"}</code></td>
                        <td>{item.userType || "-"} · {item.userId || "-"}</td>
                        <td>{Array.isArray(item.channels) ? item.channels.join(", ") : "-"}</td>
                        <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString("pt-BR") : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
