"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { TechnicalDetails } from "@/src/components/ui/DataViews";

const grafanaBase = process.env.NEXT_PUBLIC_GRAFANA_URL || "";
const POLL_INTERVAL_MS = Math.max(
  30000,
  Number.parseInt(process.env.NEXT_PUBLIC_OBSERVABILITY_POLL_MS || "60000", 10) || 60000,
);

const SOURCE_DEFS = [
  { id: "metrics", label: "Métricas", critical: true },
  { id: "health", label: "Health", critical: true },
  { id: "system", label: "Sistema", critical: false },
  { id: "opsOverview", label: "Operação", critical: false },
  { id: "opsAlerts", label: "Alertas ops", critical: true },
  { id: "workerHealth", label: "Workers", critical: true },
  { id: "workerLag", label: "Lag", critical: true },
  { id: "workerDLQ", label: "DLQ", critical: true },
  { id: "workerDLQEvents", label: "DLQ lista", critical: false },
  { id: "alertList", label: "Alert service", critical: false },
  { id: "alertStats", label: "Alert stats", critical: false },
  { id: "runtimeFlags", label: "Runtime", critical: false },
];

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatCompact = (value) =>
  toNumber(value).toLocaleString("pt-BR", {
    maximumFractionDigits: toNumber(value) >= 1000 ? 1 : 0,
    notation: toNumber(value) >= 10000 ? "compact" : "standard",
  });

const formatPct = (value) => `${toNumber(value).toFixed(2)}%`;

const formatMs = (value) => `${toNumber(value).toFixed(0)} ms`;

const formatDateTime = (value) => {
  if (!value) return "aguardando";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "aguardando";
  return date.toLocaleString("pt-BR");
};

const formatAge = (seconds) => {
  const value = toNumber(seconds);
  if (value <= 0) return "-";
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}min`;
  if (value < 86400) return `${Math.floor(value / 3600)}h`;
  return `${Math.floor(value / 86400)}d`;
};

const formatError = (reason) => {
  if (!reason) return "Falha desconhecida";
  if (reason?.message) return reason.message;
  return String(reason);
};

const normalizeStatus = (status) => String(status || "").toLowerCase();

const statusTone = (status) => {
  const normalized = normalizeStatus(status);
  if (["healthy", "ok", "connected", "conectado", "online"].includes(normalized)) return "positive";
  if (["degraded", "warning", "pending"].includes(normalized)) return "warning";
  if (normalized) return "danger";
  return "default";
};

const severityTone = (severity) => {
  const normalized = String(severity || "").toLowerCase();
  if (["critical", "danger", "p0"].includes(normalized)) return "danger";
  if (["warning", "warn", "p1"].includes(normalized)) return "warning";
  return "default";
};

const toneClass = (tone) => {
  if (tone === "positive") return "status-ok";
  if (tone === "danger") return "status-bad";
  if (tone === "warning") return "status-warn";
  return "meta-badge";
};

const readDlqSize = (payload) => {
  if (payload == null) return 0;
  if (typeof payload === "number") return payload;
  return toNumber(payload.dlqSize ?? payload.size ?? payload.count);
};

const readWorkerLag = (payload) => {
  if (!payload) return 0;
  if (typeof payload === "number") return payload;
  return toNumber(payload.lag ?? payload?.lag?.lag);
};

const compactId = (value) => {
  if (!value) return "-";
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
};

const compactError = (value) => {
  if (!value) return "Erro não informado";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const contextBadges = (context = {}) =>
  Object.entries(context)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({ key, value: String(value) }));

const createSourceState = (previous = {}) => {
  const next = {};
  SOURCE_DEFS.forEach((source) => {
    next[source.id] = previous[source.id] || {
      status: "pending",
      label: source.label,
      critical: source.critical,
      updatedAt: null,
      error: "",
    };
  });
  return next;
};

function buildIncidents({
  sourceState,
  metrics,
  monitoringHealth,
  workerHealth,
  workerLag,
  workerDLQ,
  opsAlerts,
  alertList,
  runtimeFlags,
}) {
  const incidents = [];
  const add = (condition, incident) => {
    if (condition) incidents.push({ id: `${incident.source}-${incident.title}`, ...incident });
  };

  Object.values(sourceState || {}).forEach((source) => {
    add(source.status === "error", {
      severity: source.critical ? "critical" : "warning",
      source: source.label,
      title: "Fonte de dados indisponível",
      detail: source.error || "Último polling não respondeu.",
      action: source.critical ? "Conferir autenticação, API e logs antes de confiar na tela." : "Validar quando possível.",
    });
  });

  const healthStatus = normalizeStatus(monitoringHealth?.status);
  add(healthStatus && !["healthy", "ok"].includes(healthStatus), {
    severity: ["degraded", "unhealthy"].includes(healthStatus) ? "critical" : "warning",
    source: "Health",
    title: `Health ${monitoringHealth?.status}`,
    detail: `Redis ${monitoringHealth?.checks?.redis?.status || "sem dado"}, Firebase ${monitoringHealth?.checks?.firebase?.status || "sem dado"}, Sistema ${monitoringHealth?.checks?.system?.status || "sem dado"}.`,
    action: "Abrir logs do backend e confirmar o componente afetado.",
  });

  const createBookingErrors = toNumber(metrics?.critical?.createBooking?.errors);
  const createBookingErrorRate = toNumber(metrics?.critical?.createBooking?.errorRatePct);
  add(createBookingErrorRate > 1 || createBookingErrors > 5, {
    severity: createBookingErrorRate > 1 ? "critical" : "warning",
    source: "Create booking",
    title: "Falha no fluxo de criação de corrida",
    detail: `${formatCompact(createBookingErrors)} erro(s), taxa ${formatPct(createBookingErrorRate)}.`,
    action: "Checar pagamento, logs de create_booking e últimas mudanças no hot path.",
  });

  const dlqSize = readDlqSize(workerDLQ);
  add(dlqSize > 0, {
    severity: dlqSize > 20 ? "critical" : "warning",
    source: "Workers",
    title: "DLQ com eventos acumulados",
    detail: `${formatCompact(dlqSize)} evento(s) aguardando triagem.`,
    action: "Inspecionar DLQ antes de limpar; pode conter side effects perdidos.",
  });

  const lag = readWorkerLag(workerLag);
  add(lag > 100, {
    severity: lag > 1000 ? "critical" : "warning",
    source: "Workers",
    title: "Lag no Redis Stream",
    detail: `${formatCompact(lag)} evento(s) de atraso.`,
    action: "Conferir consumers ativos, pending events e CPU dos workers.",
  });

  const workerReason = String(workerHealth?.reason || "");
  add(
    workerHealth?.status &&
      normalizeStatus(workerHealth.status) !== "healthy" &&
      !(dlqSize > 0 && workerReason.toLowerCase().includes("dlq")),
    {
      severity: normalizeStatus(workerHealth?.status) === "unhealthy" ? "critical" : "warning",
      source: "Workers",
      title: `Worker ${workerHealth?.status}`,
      detail: workerHealth?.reason || `Consumers ativos: ${workerHealth?.consumers?.count ?? 0}.`,
      action: "Reiniciar ou escalar worker afetado após confirmar pending/DLQ.",
    },
  );

  const commandFailures = toNumber(metrics?.commands?.failures);
  const commandTotal = toNumber(metrics?.commands?.total);
  const commandFailureRate = commandTotal > 0 ? (commandFailures / commandTotal) * 100 : 0;
  add(commandFailures > 10 || commandFailureRate > 2, {
    severity: commandFailureRate > 5 ? "critical" : "warning",
    source: "Commands",
    title: "Falhas relevantes em commands",
    detail: `${formatCompact(commandFailures)} falha(s), taxa ${formatPct(commandFailureRate)}.`,
    action: "Ver command com maior taxa e correlacionar com logs.",
  });

  const redisErrors = toNumber(metrics?.redis?.operations?.errors);
  const redisErrorRate = toNumber(metrics?.redis?.operations?.errorRate);
  add(redisErrors > 0, {
    severity: redisErrorRate > 1 ? "critical" : "warning",
    source: "Redis",
    title: "Erros Redis",
    detail: `${formatCompact(redisErrors)} erro(s), taxa ${formatPct(redisErrorRate)}.`,
    action: "Checar latência, memória e conectividade do Redis.",
  });

  const eventLoopP95 = toNumber(metrics?.eventLoopLag?.p95Ms);
  add(eventLoopP95 > 100, {
    severity: "critical",
    source: "Node.js",
    title: "Event loop travando",
    detail: `P95 em ${formatMs(eventLoopP95)}.`,
    action: "Reduzir carga e procurar operações síncronas pesadas.",
  });

  const socketBusyTimeout = toNumber(metrics?.critical?.socketAdmission?.busyTimeout);
  add(socketBusyTimeout > 0, {
    severity: "critical",
    source: "WebSocket",
    title: "Admission timeout",
    detail: `${formatCompact(socketBusyTimeout)} handshake(s) excederam a fila.`,
    action: "Aumentar gateway ou reduzir rajada de reconexões.",
  });

  add(runtimeFlags?.success && runtimeFlags?.realSandbox?.ready === false, {
    severity: "warning",
    source: "Runtime",
    title: "Runtime com blockers",
    detail: (runtimeFlags?.realSandbox?.blockers || []).slice(0, 2).join(" | ") || "Runtime não está pronto.",
    action: "Revisar flags antes de operação real.",
  });

  const launchFlags = runtimeFlags?.launch || {};
  [
    ["adminMutationsEnabled", "Mutações administrativas", "Ações administrativas estão em modo somente leitura."],
    ["referralProgramsEnabled", "Programas de convite", "Programas de convite estão bloqueados pelo backend."],
    ["campaignCenterEnabled", "Campaign Center", "Campanhas in-app estão bloqueadas pelo backend."],
    ["leafDelasEnabled", "Leaf Delas", "Preferência Leaf Delas está bloqueada pelo backend."],
    ["driverDestinationModeEnabled", "Destino do motorista", "Destino do motorista está bloqueado pelo backend."],
    ["dynamicPricingEnabled", "Tarifa dinâmica", "Tarifa dinâmica está bloqueada pelo backend."],
    ["smartPushEnabled", "Smart push", "Smart push está bloqueado pelo backend."],
  ].forEach(([flagKey, label, detail]) => {
    add(runtimeFlags?.success && launchFlags[flagKey] === false, {
      severity: "warning",
      source: "Runtime flags",
      title: `${label} desativado`,
      detail,
      action: "Manter a UI bloqueada até a flag ser habilitada no backend.",
    });
  });

  (opsAlerts || []).forEach((alert, index) => {
    add(true, {
      severity: alert.severity || "warning",
      source: "Ops",
      title: alert.metric || `Alerta operacional ${index + 1}`,
      detail: alert.message || `Valor ${alert.value ?? "sem dado"} acima do limite ${alert.threshold ?? "sem dado"}.`,
      action: "Confirmar se o alerta ainda está ativo e registrar a resolução.",
    });
  });

  (alertList || []).slice(0, 4).forEach((alert, index) => {
    add(true, {
      severity: alert.severity || "warning",
      source: alert.service || "Alert service",
      title: alert.metric || `Alerta ${index + 1}`,
      detail: alert.message || `Valor ${alert.value ?? "sem dado"} / limite ${alert.threshold ?? "sem dado"}.`,
      action: "Confirmar se o alerta ainda está ativo.",
    });
  });

  return incidents.sort((a, b) => {
    const rank = { critical: 0, danger: 0, warning: 1 };
    return (rank[String(a.severity).toLowerCase()] ?? 2) - (rank[String(b.severity).toLowerCase()] ?? 2);
  });
}

function StatTile({ label, value, tone = "default", detail }) {
  return (
    <article className={`ops-stat ops-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function HealthChip({ label, status }) {
  const tone = statusTone(status);
  return (
    <span className={toneClass(tone)}>
      {label}: {status || "sem dado"}
    </span>
  );
}

function CompactRows({ rows, empty = "Sem dados relevantes." }) {
  const visibleRows = rows.filter((row) => row && row.value !== null && row.value !== undefined && row.value !== "");
  if (visibleRows.length === 0) return <p className="text-muted">{empty}</p>;

  return (
    <div className="ops-rows">
      {visibleRows.map((row) => (
        <div key={row.label} className="ops-row">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          {row.detail ? <small>{row.detail}</small> : null}
        </div>
      ))}
    </div>
  );
}

export default function ObservabilityPage() {
  const [metrics, setMetrics] = useState(null);
  const [systemStatus, setSystemStatus] = useState([]);
  const [monitoringHealth, setMonitoringHealth] = useState(null);
  const [opsOverview, setOpsOverview] = useState(null);
  const [opsAlerts, setOpsAlerts] = useState([]);
  const [workerHealth, setWorkerHealth] = useState(null);
  const [workerLag, setWorkerLag] = useState(null);
  const [workerDLQ, setWorkerDLQ] = useState(null);
  const [workerDLQEvents, setWorkerDLQEvents] = useState(null);
  const [alertList, setAlertList] = useState([]);
  const [alertStats, setAlertStats] = useState(null);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const [sourceState, setSourceState] = useState(() => createSourceState());
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [dlqTypeFilter, setDlqTypeFilter] = useState("all");
  const [dlqSearch, setDlqSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  useEffect(() => {
    let mounted = true;
    let firstLoad = true;

    const load = async () => {
      try {
        if (mounted && firstLoad) setLoading(true);
        setError("");

        const requestEntries = [
          ["metrics", leafAPI.getObservabilityMetrics()],
          ["system", leafAPI.getSystemStatus()],
          ["health", leafAPI.getMonitoringHealth()],
          ["opsOverview", leafAPI.getOpsOverview(1)],
          ["opsAlerts", leafAPI.getOpsAlerts(1)],
          ["workerHealth", leafAPI.getWorkerHealth()],
          ["workerLag", leafAPI.getWorkerLag()],
          ["workerDLQ", leafAPI.getWorkerDLQ()],
          ["workerDLQEvents", leafAPI.getWorkerDLQEvents({ limit: 50, direction: "desc" })],
          ["alertList", leafAPI.getAlerts(20)],
          ["alertStats", leafAPI.getAlertStats()],
          ["runtimeFlags", leafAPI.getRuntimeFlags()],
        ];

        const results = await Promise.allSettled(requestEntries.map(([, request]) => request));
        if (!mounted) return;

        const nextSourceState = createSourceState();
        requestEntries.forEach(([id], index) => {
          const result = results[index];
          const definition = SOURCE_DEFS.find((source) => source.id === id);
          nextSourceState[id] = {
            label: definition?.label || id,
            critical: definition?.critical || false,
            status: result.status === "fulfilled" ? "ok" : "error",
            updatedAt: new Date().toISOString(),
            error: result.status === "rejected" ? formatError(result.reason) : "",
          };
        });

        const valueFor = (id) => results[requestEntries.findIndex(([key]) => key === id)]?.value;
        setMetrics(valueFor("metrics") || null);
        setSystemStatus(Array.isArray(valueFor("system")) ? valueFor("system") : []);
        setMonitoringHealth(valueFor("health") || null);
        setOpsOverview(valueFor("opsOverview")?.overview || valueFor("opsOverview") || null);
        setOpsAlerts(Array.isArray(valueFor("opsAlerts")?.alerts) ? valueFor("opsAlerts").alerts : []);
        setWorkerHealth(valueFor("workerHealth") || null);
        setWorkerLag(valueFor("workerLag")?.lag || valueFor("workerLag") || null);
        setWorkerDLQ(valueFor("workerDLQ") || null);
        setWorkerDLQEvents(valueFor("workerDLQEvents") || null);
        setAlertList(Array.isArray(valueFor("alertList")?.alerts) ? valueFor("alertList").alerts : []);
        setAlertStats(valueFor("alertStats")?.stats || null);
        setRuntimeFlags(valueFor("runtimeFlags") || null);
        setSourceState(nextSourceState);

        const failed = Object.values(nextSourceState).filter((source) => source.status === "error");
        const criticalFailed = failed.filter((source) => source.critical);
        if (criticalFailed.length > 0) {
          setError(`Falha em fonte crítica: ${criticalFailed.map((source) => source.label).join(", ")}.`);
        } else if (failed.length > 0) {
          setError(`Falha parcial: ${failed.map((source) => source.label).join(", ")}.`);
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

    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = setInterval(loadWhenVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, []);

  const commandRows = useMemo(
    () =>
      Object.entries(metrics?.commands?.byCommand || {})
        .map(([commandName, payload]) => ({
          commandName,
          total: toNumber(payload?.total),
          failures: toNumber(payload?.failures),
        }))
        .sort((a, b) => b.failures - a.failures || b.total - a.total),
    [metrics?.commands?.byCommand],
  );

  const createBookingErrors = useMemo(
    () => metrics?.critical?.createBooking?.topErrors || [],
    [metrics?.critical?.createBooking?.topErrors],
  );

  const sourceRows = useMemo(() => Object.values(sourceState || {}), [sourceState]);
  const failedSources = sourceRows.filter((source) => source.status === "error");
  const allSourcesOk = sourceRows.length > 0 && failedSources.length === 0 && sourceRows.every((source) => source.status === "ok");
  const workerDlqSize = readDlqSize(workerDLQ);
  const workerLagValue = readWorkerLag(workerLag);
  const dlqEvents = useMemo(
    () => (Array.isArray(workerDLQEvents?.events) ? workerDLQEvents.events : []),
    [workerDLQEvents],
  );
  const dlqEventTypes = useMemo(
    () => Array.from(new Set(dlqEvents.map((event) => event.eventType).filter(Boolean))).sort(),
    [dlqEvents],
  );
  const filteredDlqEvents = useMemo(() => {
    const search = dlqSearch.trim().toLowerCase();
    return dlqEvents.filter((event) => {
      const matchesType = dlqTypeFilter === "all" || event.eventType === dlqTypeFilter;
      if (!matchesType) return false;
      if (!search) return true;
      const haystack = [
        event.id,
        event.originalEventId,
        event.eventType,
        event.error,
        event.failedAt,
        JSON.stringify(event.context || {}),
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }, [dlqEvents, dlqSearch, dlqTypeFilter]);

  const incidents = useMemo(
    () =>
      buildIncidents({
        sourceState,
        metrics,
        monitoringHealth,
        workerHealth,
        workerLag,
        workerDLQ,
        opsAlerts,
        alertList,
        runtimeFlags,
      }),
    [sourceState, metrics, monitoringHealth, workerHealth, workerLag, workerDLQ, opsAlerts, alertList, runtimeFlags],
  );

  const criticalIncidentCount = incidents.filter((incident) => severityTone(incident.severity) === "danger").length;
  const warningIncidentCount = incidents.filter((incident) => severityTone(incident.severity) === "warning").length;
  const overallTone = criticalIncidentCount > 0 ? "danger" : warningIncidentCount > 0 ? "warning" : "positive";
  const overallLabel = criticalIncidentCount > 0 ? "Ação imediata" : warningIncidentCount > 0 ? "Atenção" : "Operação estável";
  const topIncident = incidents[0];
  const commandFailures = toNumber(metrics?.commands?.failures);
  const commandTotal = toNumber(metrics?.commands?.total);
  const commandFailureRate = commandTotal > 0 ? (commandFailures / commandTotal) * 100 : 0;
  const quickLinks = [
    { name: "Grafana", href: grafanaBase || null },
    { name: "Traces", href: grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/explore` : null },
    { name: "Dashboards", href: grafanaBase ? `${grafanaBase.replace(/\/$/, "")}/dashboards` : null },
  ].filter((item) => item.href);
  const runtimeLoaded = Boolean(runtimeFlags?.success);
  const formatLaunchFlag = (value) => {
    if (!runtimeLoaded) return "sem dado";
    return value === false ? "bloqueado" : "habilitado";
  };
  const launchFlagRows = [
    { label: "Perfil", value: runtimeFlags?.launch?.launchProfile || "sem dado" },
    { label: "Pilot controlled", value: runtimeLoaded ? (runtimeFlags?.launch?.pilotControlled ? "sim" : "não") : "sem dado" },
    { label: "Admin mutations", value: formatLaunchFlag(runtimeFlags?.launch?.adminMutationsEnabled) },
    { label: "Programas", value: formatLaunchFlag(runtimeFlags?.launch?.referralProgramsEnabled) },
    { label: "Campaign Center", value: formatLaunchFlag(runtimeFlags?.launch?.campaignCenterEnabled) },
    { label: "Leaf Delas", value: formatLaunchFlag(runtimeFlags?.launch?.leafDelasEnabled) },
    { label: "Destino motorista", value: formatLaunchFlag(runtimeFlags?.launch?.driverDestinationModeEnabled) },
    { label: "Tarifa dinâmica", value: formatLaunchFlag(runtimeFlags?.launch?.dynamicPricingEnabled) },
    { label: "Smart push", value: formatLaunchFlag(runtimeFlags?.launch?.smartPushEnabled) },
  ];

  const metricsPayload = {
    metrics,
    monitoringHealth,
    systemStatus,
    opsOverview,
    opsAlerts,
    workerHealth,
    workerLag,
    workerDLQ,
    workerDLQEvents,
    alertList,
    alertStats,
    runtimeFlags,
    sourceState,
  };

  const copyPayload = async () => {
    try {
      await navigator.clipboard?.writeText(JSON.stringify(metricsPayload, null, 2));
      setCopyStatus("Payload copiado.");
      setTimeout(() => setCopyStatus(""), 2200);
    } catch {
      setCopyStatus("Não foi possível copiar o payload.");
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell usage-page-shell">
        <AppNav />
        <section className="usage-page-card ops-console">
          <header className="ops-header">
            <div>
              <p className="ops-eyebrow">Observabilidade</p>
              <h1>Console operacional</h1>
              <p>Leitura enxuta para decidir se a operação precisa de ação agora.</p>
            </div>
            <div className="ops-header-actions">
              <span className={toneClass(overallTone)}>{overallLabel}</span>
              <span className="meta-badge">Atualizado: {formatDateTime(metrics?.timestamp || lastUpdatedAt)}</span>
              <button type="button" onClick={copyPayload}>Exportar payload</button>
            </div>
          </header>

          {loading ? <LoadingState message="Carregando observabilidade..." /> : null}
          {copyStatus ? <p className="text-muted">{copyStatus}</p> : null}
          <ErrorText message={error} />

          <section className={`ops-hero ops-hero-${overallTone}`}>
            <div>
              <span className={toneClass(overallTone)}>
                {criticalIncidentCount} crítico(s) · {warningIncidentCount} aviso(s)
              </span>
              <h2>{topIncident?.title || "Nenhum incidente ativo"}</h2>
              <p>{topIncident ? `${topIncident.source}: ${topIncident.detail}` : "Todos os sinais prioritários estão dentro do esperado."}</p>
            </div>
            <div className="ops-hero-action">
              <strong>{topIncident?.action || "Continue monitorando a cada janela operacional."}</strong>
            </div>
          </section>

          <section className="ops-stat-grid">
            <StatTile
              label="Create booking"
              value={formatCompact(metrics?.critical?.createBooking?.errors)}
              detail={formatPct(metrics?.critical?.createBooking?.errorRatePct)}
              tone={toNumber(metrics?.critical?.createBooking?.errorRatePct) > 1 ? "danger" : "positive"}
            />
            <StatTile
              label="DLQ"
              value={formatCompact(workerDlqSize)}
              detail="eventos"
              tone={workerDlqSize > 20 ? "danger" : workerDlqSize > 0 ? "warning" : "positive"}
            />
            <StatTile
              label="Worker lag"
              value={formatCompact(workerLagValue)}
              tone={workerLagValue > 1000 ? "danger" : workerLagValue > 100 ? "warning" : "positive"}
            />
            <StatTile
              label="Redis"
              value={formatCompact(metrics?.redis?.operations?.errors)}
              detail={`${formatMs(metrics?.redis?.latency?.p95)} p95`}
              tone={toNumber(metrics?.redis?.operations?.errors) > 0 ? "danger" : "positive"}
            />
            <StatTile
              label="Event loop"
              value={formatMs(metrics?.eventLoopLag?.p95Ms)}
              detail="p95"
              tone={toNumber(metrics?.eventLoopLag?.p95Ms) > 100 ? "danger" : toNumber(metrics?.eventLoopLag?.p95Ms) > 50 ? "warning" : "positive"}
            />
            <StatTile
              label="Commands"
              value={formatCompact(commandFailures)}
              detail={`${formatPct(commandFailureRate)} falha`}
              tone={commandFailureRate > 2 ? "danger" : commandFailures > 0 ? "warning" : "positive"}
            />
            <StatTile
              label="Corridas concluídas"
              value={formatCompact(metrics?.rides?.completed)}
              tone="default"
            />
            <StatTile
              label="Fontes"
              value={failedSources.length === 0 ? "ok" : `${failedSources.length} falha(s)`}
              detail={`${sourceRows.length} conectadas`}
              tone={failedSources.some((source) => source.critical) ? "danger" : failedSources.length > 0 ? "warning" : "positive"}
            />
          </section>

          <section className="ops-main-grid">
            <Panel title="Incidentes" subtitle="Somente o que exige atenção.">
              {incidents.length === 0 ? (
                <p className="status-ok">Sem incidentes ativos.</p>
              ) : (
                <div className="ops-incident-list">
                  {incidents.slice(0, 6).map((incident, index) => (
                    <article key={`${incident.id}-${index}`} className={`ops-incident ops-incident-${severityTone(incident.severity)}`}>
                      <div>
                        <span className={toneClass(severityTone(incident.severity))}>{String(incident.severity || "warning").toUpperCase()}</span>
                        <h3>{incident.title}</h3>
                        <p>{incident.source}: {incident.detail}</p>
                      </div>
                      <strong>{incident.action}</strong>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Fila de eventos" subtitle="Workers, lag e DLQ.">
              <CompactRows
                rows={[
                  { label: "Worker", value: workerHealth?.status || "sem dado", detail: workerHealth?.reason || "" },
                  { label: "Consumers", value: workerHealth?.consumers?.count ?? 0 },
                  { label: "Pending", value: formatCompact(workerHealth?.pendingEvents) },
                  { label: "Lag", value: formatCompact(workerLagValue) },
                  { label: "DLQ", value: formatCompact(workerDlqSize), detail: workerDlqSize > 0 ? "triagem necessária" : "" },
                ]}
              />
            </Panel>

            <Panel
              title="DLQ Inspector"
              subtitle="Amostra read-only dos eventos que falharam depois dos retries."
              className="panel-span-full"
              actions={<span className="meta-badge">{formatCompact(filteredDlqEvents.length)} de {formatCompact(workerDLQEvents?.dlqSize ?? workerDlqSize)}</span>}
            >
              <div className="filters">
                <label>
                  Tipo
                  <select value={dlqTypeFilter} onChange={(event) => setDlqTypeFilter(event.target.value)}>
                    <option value="all">Todos</option>
                    {dlqEventTypes.map((eventType) => (
                      <option key={eventType} value={eventType}>{eventType}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Buscar
                  <input
                    value={dlqSearch}
                    onChange={(event) => setDlqSearch(event.target.value)}
                    placeholder="erro, booking, driver, trace..."
                  />
                </label>
                <span className="meta-badge">Últimos {formatCompact(workerDLQEvents?.limit || 50)}</span>
                <span className="meta-badge">Sem ações destrutivas</span>
              </div>

              {filteredDlqEvents.length === 0 ? (
                <p className="text-muted">
                  {workerDlqSize > 0
                    ? "A lista ainda não está disponível neste polling ou os filtros não retornaram eventos."
                    : "DLQ vazia."}
                </p>
              ) : (
                <div className="table-shell table-shell-tall">
                  <table className="table table-compact dlq-table">
                    <thead>
                      <tr>
                        <th>Falha</th>
                        <th>Evento</th>
                        <th>Erro</th>
                        <th>Contexto</th>
                        <th>Detalhe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDlqEvents.map((event) => {
                        const badges = contextBadges(event.context);
                        return (
                          <tr key={event.id}>
                            <td>
                              <strong>{formatDateTime(event.failedAt)}</strong>
                              <span className="table-muted">{formatAge(event.ageSeconds)} atrás</span>
                            </td>
                            <td>
                              <code>{event.eventType || "unknown"}</code>
                              <span className="table-muted">DLQ {compactId(event.id)}</span>
                              <span className="table-muted">Origem {compactId(event.originalEventId)}</span>
                            </td>
                            <td>
                              <span className="dlq-error">{compactError(event.error)}</span>
                              <span className="table-muted">{formatCompact(event.retries)} retry(s)</span>
                            </td>
                            <td>
                              {badges.length > 0 ? (
                                <div className="dlq-context">
                                  {badges.map((badge) => (
                                    <span key={badge.key} className="meta-badge">
                                      {badge.key}: {compactId(badge.value)}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="table-muted">Sem IDs detectados</span>
                              )}
                            </td>
                            <td>
                              <details className="technical-details dlq-event-details">
                                <summary>JSON</summary>
                                <pre>{JSON.stringify(event, null, 2)}</pre>
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Fluxo crítico" subtitle="Criação de corrida e commands.">
              <CompactRows
                rows={[
                  {
                    label: "Create booking",
                    value: `${formatCompact(metrics?.critical?.createBooking?.errors)} erro(s)`,
                    detail: formatPct(metrics?.critical?.createBooking?.errorRatePct),
                  },
                  {
                    label: "Request ride",
                    value: `${formatCompact(metrics?.critical?.requestRideCommand?.failures)} falha(s)`,
                    detail: formatPct(metrics?.critical?.requestRideCommand?.failureRatePct),
                  },
                  {
                    label: "Command failures",
                    value: formatCompact(commandFailures),
                    detail: formatPct(commandFailureRate),
                  },
                  {
                    label: "Socket admission",
                    value: `${formatCompact(metrics?.critical?.socketAdmission?.busyTimeout)} timeout(s)`,
                  },
                ]}
              />
              {createBookingErrors.length > 0 ? (
                <div className="ops-mini-bars">
                  {createBookingErrors.slice(0, 3).map((item) => (
                    <div key={item.error}>
                      <span>{item.error}</span>
                      <strong>{formatCompact(item.count)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </Panel>

            <Panel title="Infraestrutura" subtitle="Serviços essenciais.">
              <div className="ops-chip-row">
                <HealthChip label="Health" status={monitoringHealth?.status} />
                <HealthChip label="Redis" status={monitoringHealth?.checks?.redis?.status} />
                <HealthChip label="Firebase" status={monitoringHealth?.checks?.firebase?.status} />
                <HealthChip label="WebSocket" status={monitoringHealth?.checks?.websocket?.status} />
                <HealthChip label="Sistema" status={monitoringHealth?.checks?.system?.status} />
              </div>
              <CompactRows
                rows={[
                  { label: "Redis ops", value: formatCompact(metrics?.redis?.operations?.total), detail: `${formatPct(metrics?.redis?.operations?.errorRate)} erro` },
                  { label: "Hotpath", value: formatCompact(metrics?.hotpath?.total), detail: `${formatMs(metrics?.hotpath?.avgLatencyMs)} média` },
                  { label: "OTEL ingest", value: formatCompact(metrics?.otel?.ingest?.totalRequests), detail: toNumber(metrics?.otel?.ingest?.errors) > 0 ? `${formatCompact(metrics?.otel?.ingest?.errors)} erro(s)` : "" },
                ]}
              />
            </Panel>

            <Panel title="Operação" subtitle="Corridas, suporte e disputas.">
              <CompactRows
                rows={[
                  { label: "Solicitadas", value: formatCompact(metrics?.rides?.requested) },
                  { label: "Aceitas", value: formatCompact(metrics?.rides?.accepted) },
                  { label: "Concluídas", value: formatCompact(metrics?.rides?.completed) },
                  { label: "Tempo até aceite", value: `${toNumber(metrics?.rides?.timeToAcceptAvgSec).toFixed(2)} s` },
                  {
                    label: "Reassignment preso",
                    value: formatCompact(opsOverview?.rideHealth?.reassignmentPending?.stuck),
                    detail: `${formatCompact(opsOverview?.rideHealth?.reassignmentPending?.total)} pendente(s)`,
                  },
                  {
                    label: "Review encerramento",
                    value: formatCompact(opsOverview?.rideHealth?.earlyEndedReview?.recent),
                    detail: `${formatCompact(opsOverview?.rideHealth?.earlyEndedReview?.total)} em revisão`,
                  },
                  {
                    label: "Sinal motorista stale",
                    value: formatCompact(opsOverview?.rideHealth?.driverSignal?.stale),
                    detail: `${formatCompact(opsOverview?.rideHealth?.driverSignal?.total)} ativa(s) monitorada(s)`,
                  },
                  { label: "Backlog suporte", value: formatCompact(opsOverview?.supportQueue?.criticalBacklogCount) },
                  { label: "Disputas abertas", value: formatCompact(opsOverview?.disputes?.openCount) },
                ]}
              />
            </Panel>

            <Panel title="Conectividade" subtitle="Fontes usadas pela tela.">
              <div className="ops-chip-row">
                <span className={allSourcesOk ? "status-ok" : failedSources.length > 0 ? "status-warn" : "meta-badge"}>
                  {allSourcesOk ? "Todas conectadas" : `${failedSources.length} fonte(s) com falha`}
                </span>
                <span className="meta-badge">Polling: {POLL_INTERVAL_MS / 1000}s</span>
                <span className="meta-badge">Alertas: {formatCompact(alertStats?.total)}</span>
              </div>
              {failedSources.length > 0 ? (
                <div className="ops-rows">
                  {failedSources.map((source) => (
                    <div key={source.label} className="ops-row">
                      <span>{source.label}</span>
                      <strong>{source.critical ? "crítica" : "parcial"}</strong>
                      <small>{source.error}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">Sem falhas de integração no último polling.</p>
              )}
            </Panel>

            <Panel title="Flags runtime" subtitle="Estado que governa telas e mutações do dashboard.">
              <CompactRows rows={launchFlagRows} />
              {runtimeFlags?.realSandbox?.blockers?.length > 0 ? (
                <div className="ops-chip-row">
                  {runtimeFlags.realSandbox.blockers.slice(0, 4).map((blocker) => (
                    <span key={blocker} className="status-warn">{blocker}</span>
                  ))}
                </div>
              ) : null}
            </Panel>

            {quickLinks.length > 0 ? (
              <Panel title="Acesso rápido">
                <div className="filters">
                  {quickLinks.map((link) => (
                    <a key={link.name} href={link.href} target="_blank" rel="noreferrer" className="nav-link">
                      {link.name}
                    </a>
                  ))}
                </div>
              </Panel>
            ) : null}

            <Panel title="Detalhe técnico" className="panel-span-full" subtitle="Aberto só quando precisar investigar.">
              <TechnicalDetails title="Payload completo" data={metricsPayload} />
            </Panel>
          </section>
        </section>
      </main>
    </ProtectedRoute>
  );
}
