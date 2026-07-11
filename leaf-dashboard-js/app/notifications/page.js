"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";
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

function segmentLabel(userTypes = []) {
  const labels = [];
  if (userTypes.includes("driver")) labels.push("Motoristas");
  if (userTypes.includes("customer")) labels.push("Passageiros");
  return labels.length ? labels.join(" e ") : "Nenhum público selecionado";
}

function filterLabel(filters = {}) {
  const labels = [];
  if (filters.registeredWithinHours) labels.push(`cadastro nas últimas ${filters.registeredWithinHours}h`);
  if (filters.registeredWithinDays) labels.push(`cadastro nos últimos ${filters.registeredWithinDays} dias`);
  if (filters.registeredMoreThanMonths) labels.push(`cadastro há mais de ${filters.registeredMoreThanMonths} meses`);
  return labels.length ? labels.join(" · ") : "Sem filtro adicional";
}

function audienceEstimate(stats, userTypes = [], filters = {}) {
  const totalUsers = Number(stats?.totalUsers || 0);
  const coversAllRoles = userTypes.includes("driver") && userTypes.includes("customer");
  const hasFilters = Object.keys(filters).length > 0;

  if (coversAllRoles && !hasFilters && totalUsers > 0) {
    return `Até ${totalUsers.toLocaleString("pt-BR")} usuário(s) registrados; o backend confirma os tokens elegíveis no envio.`;
  }

  return "A quantidade final será resolvida pelo backend conforme segmento, filtros e tokens elegíveis.";
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [toDrivers, setToDrivers] = useState(false);
  const [toPassengers, setToPassengers] = useState(false);
  const [registeredWithinHours, setRegisteredWithinHours] = useState("");
  const [registeredWithinDays, setRegisteredWithinDays] = useState("");
  const [registeredMoreThanMonths, setRegisteredMoreThanMonths] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");
  const [composerStep, setComposerStep] = useState("message");
  const [pendingPayload, setPendingPayload] = useState(null);

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
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = setInterval(loadWhenVisible, 60000);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", loadWhenVisible);
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

  const selectedUserTypes = useMemo(() => {
    const userTypes = [];
    if (toDrivers) userTypes.push("driver");
    if (toPassengers) userTypes.push("customer");
    return userTypes;
  }, [toDrivers, toPassengers]);

  const selectedFilters = useMemo(() => {
    const filters = {};
    if (registeredWithinHours) filters.registeredWithinHours = Number(registeredWithinHours);
    if (registeredWithinDays) filters.registeredWithinDays = Number(registeredWithinDays);
    if (registeredMoreThanMonths) filters.registeredMoreThanMonths = Number(registeredMoreThanMonths);
    return filters;
  }, [registeredMoreThanMonths, registeredWithinDays, registeredWithinHours]);

  const continueToAudience = () => {
    if (!title.trim() || !body.trim()) {
      setSendStatus("");
      setError("Informe título e mensagem antes de escolher o público");
      return;
    }
    setError("");
    setComposerStep("audience");
  };

  const continueToReview = () => {
    if (selectedUserTypes.length === 0) {
      setSendStatus("");
      setError("Selecione explicitamente pelo menos um público");
      return;
    }
    setError("");
    setComposerStep("review");
  };

  const requestSendConfirmation = () => {
    if (!title.trim() || !body.trim() || selectedUserTypes.length === 0) {
      setError("Revise mensagem e público antes de confirmar o envio");
      return;
    }
    setError("");
    setSendStatus("");
    setPendingPayload({
      title: title.trim(),
      body: body.trim(),
      userTypes: selectedUserTypes,
      filters: selectedFilters,
      data: {
        source: "dashboard_notifications",
      },
    });
  };

  const sendNotification = async () => {
    if (!pendingPayload) return;

    try {
      setSending(true);
      setError("");
      setSendStatus("");

      const response = await leafAPI.sendPushNotification({
        ...pendingPayload,
        data: {
          ...pendingPayload.data,
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
      setPendingPayload(null);
      setToDrivers(false);
      setToPassengers(false);
      setRegisteredWithinHours("");
      setRegisteredWithinDays("");
      setRegisteredMoreThanMonths("");
      setComposerStep("message");
    } catch (err) {
      setError(err?.message || "Falha ao enviar notificação");
      setPendingPayload(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell notifications-page">
        <header className="header">
          <div>
            <h1>Notificações</h1>
            <p>Envio segmentado, saúde de entrega e canais configurados.</p>
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando notificações..." /> : null}

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

        <section className="grid notifications-workspace">
          <Panel
            title="Enviar notificação"
            subtitle="Mensagem curta com segmentação por perfil e janela de cadastro."
            className="notifications-composer"
          >
            <div className="filters" aria-label="Etapas do envio">
              <span className={composerStep === "message" ? "status-ok" : "meta-badge"}>1. Mensagem</span>
              <span className={composerStep === "audience" ? "status-ok" : "meta-badge"}>2. Público</span>
              <span className={composerStep === "review" ? "status-ok" : "meta-badge"}>3. Revisar</span>
            </div>

            {composerStep === "message" ? (
              <div className="section-stack">
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
                    <textarea
                      rows={3}
                      placeholder="Mensagem"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </label>
                </div>
                <div className="row-actions">
                  <button type="button" className="primary-action" onClick={continueToAudience} disabled={!title.trim() || !body.trim()}>
                    Continuar para público
                  </button>
                </div>
              </div>
            ) : null}

            {composerStep === "audience" ? (
              <div className="section-stack">
                <p className="text-muted">Nenhum público vem pré-selecionado. Escolha explicitamente quem receberá a mensagem.</p>
                <div className="form-grid">
                  <label className="form-field form-field-checkbox">
                    Motoristas
                    <input type="checkbox" checked={toDrivers} onChange={(e) => setToDrivers(e.target.checked)} />
                  </label>
                  <label className="form-field form-field-checkbox">
                    Passageiros
                    <input type="checkbox" checked={toPassengers} onChange={(e) => setToPassengers(e.target.checked)} />
                  </label>
                </div>
                <details className="notification-audience-filters">
                  <summary>Refinar público por data de cadastro</summary>
                  <div className="form-grid">
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
                  </div>
                </details>
                <div className="row-actions">
                  <button type="button" className="button-secondary" onClick={() => setComposerStep("message")}>
                    Voltar à mensagem
                  </button>
                  <button type="button" className="primary-action" onClick={continueToReview} disabled={selectedUserTypes.length === 0}>
                    Revisar envio
                  </button>
                </div>
              </div>
            ) : null}

            {composerStep === "review" ? (
              <div className="section-stack">
                <KeyValueGrid
                  data={{
                    titulo: title.trim(),
                    mensagem: body.trim(),
                    segmentos: segmentLabel(selectedUserTypes),
                    filtros: filterLabel(selectedFilters),
                    quantidade: audienceEstimate(stats, selectedUserTypes, selectedFilters),
                    consequencia: "Push imediato para os tokens elegíveis; o envio não pode ser desfeito.",
                  }}
                  labels={{
                    titulo: "Título",
                    mensagem: "Mensagem",
                    segmentos: "Segmentos",
                    filtros: "Filtros",
                    quantidade: "Quantidade estimada",
                    consequencia: "Consequência",
                  }}
                  maxItems={6}
                />
                <div className="row-actions">
                  <button type="button" className="button-secondary" onClick={() => setComposerStep("audience")}>
                    Ajustar público
                  </button>
                  <button type="button" className="primary-action" onClick={requestSendConfirmation} disabled={sending}>
                    Continuar para confirmação
                  </button>
                </div>
              </div>
            ) : null}
            {sendStatus ? <p className="status-ok">{sendStatus}</p> : null}
          </Panel>

          <Panel title="Endpoints disponíveis">
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
              <div
                className="table-shell"
                role="region"
                tabIndex={0}
                aria-label="Endpoints de notificações"
              >
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

        <ConfirmActionDialog
          open={Boolean(pendingPayload)}
          title="Confirmar envio da notificação"
          description="Esta ação dispara um push imediato e não pode ser desfeita. Confira mensagem, público e alcance antes de continuar."
          confirmLabel="Enviar agora"
          tone="danger"
          busy={sending}
          onConfirm={sendNotification}
          onCancel={() => setPendingPayload(null)}
        >
          <div className="section-stack">
            <div>
              <strong>Título</strong>
              <p>{pendingPayload?.title || "-"}</p>
            </div>
            <div>
              <strong>Mensagem</strong>
              <p>{pendingPayload?.body || "-"}</p>
            </div>
            <KeyValueGrid
              data={{
                segmentos: segmentLabel(pendingPayload?.userTypes || []),
                filtros: filterLabel(pendingPayload?.filters || {}),
                quantidade: audienceEstimate(stats, pendingPayload?.userTypes || [], pendingPayload?.filters || {}),
                consequencia: "O backend resolverá os usuários e tokens elegíveis e iniciará o envio imediatamente.",
              }}
              labels={{
                segmentos: "Segmentos escolhidos",
                filtros: "Filtros",
                quantidade: "Quantidade estimada",
                consequencia: "Consequência",
              }}
              maxItems={4}
            />
          </div>
        </ConfirmActionDialog>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
