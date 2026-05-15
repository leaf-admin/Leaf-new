"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [stats, setStats] = useState(null);
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
      setError("Informe título e mensagem");
      return;
    }

    const userTypes = [];
    if (toDrivers) userTypes.push("driver");
    if (toPassengers) userTypes.push("customer");
    if (userTypes.length === 0) {
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

      setSendStatus(
        `Envio concluído: ${response?.sent || response?.successful || 0} enviados` +
        `${response?.failed ? `, ${response.failed} falhas` : ""}`
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
                totalSent: stats?.totalSent || 0,
                successful: stats?.successful || 0,
                failed: stats?.failed || 0,
                successRate: `${successRate}%`,
                endpointsConfigured: Object.keys(endpoints).length,
                queues: notifications?.data?.queues || notifications?.queues || "-",
              }}
              labels={{
                totalSent: "Envios totais",
                successful: "Envios com sucesso",
                failed: "Falhas",
                successRate: "Taxa de sucesso",
                endpointsConfigured: "Canais configurados",
                queues: "Filas de envio",
              }}
            />
            <TechnicalDetails
              title="Ver payload técnico de notificações"
              data={{ stats, notifications }}
            />
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
