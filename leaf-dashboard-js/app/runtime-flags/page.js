"use client";

import { useEffect, useMemo, useState } from "react";
import AppNav from "@/src/components/AppNav";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import { hasAnyRole, roleBlockedMessage } from "@/src/utils/dashboard-access";

const ADMIN_ROLES = ["admin", "super-admin", "manager", "development"];
const SAFE_DOMAINS = [
  "featureGates",
  "mapsRoutingPolicy",
  "notificationPolicy",
  "driverOnlinePolicy",
  "campaignSurfaces",
  "legalUrls",
  "supportPolicy",
  "biometricRuntime",
];
const CRITICAL_DOMAINS = new Set(["biometricRuntime", "driverOnlinePolicy", "mapsRoutingPolicy"]);

const domainLabels = {
  featureGates: "Feature gates",
  mapsRoutingPolicy: "Maps e rotas",
  notificationPolicy: "Push e notificacoes",
  driverOnlinePolicy: "Motorista online",
  campaignSurfaces: "Campanhas",
  legalUrls: "Links legais",
  supportPolicy: "Suporte",
  biometricRuntime: "Biometria/KYC",
};

const domainExamples = {
  featureGates: '{\n  "smartPushEnabled": false\n}',
  mapsRoutingPolicy: '{\n  "clientDirectGoogleFallback": false,\n  "routeTrafficEnabled": false\n}',
  notificationPolicy: '{\n  "smartPushMode": "disabled",\n  "dedupeWindowSeconds": 60\n}',
  driverOnlinePolicy: '{\n  "geofenceEnforced": false,\n  "requireLivenessWhenStale": true\n}',
  campaignSurfaces: '{\n  "passengerHome": true,\n  "driverHome": true\n}',
  legalUrls: '{\n  "privacy": "https://leaf.app.br/privacy"\n}',
  supportPolicy: '{\n  "supportCopilotMode": "guarded",\n  "autoReplyEnabled": false\n}',
  biometricRuntime: '{\n  "strictModeEnabled": false,\n  "requireTrustedBiometricMatch": false\n}',
};

function nowPlusHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function defaultForm() {
  return {
    overrideId: `runtime-${Date.now().toString(36)}`,
    name: "Canary runtime",
    domain: "featureGates",
    status: "paused",
    scope: "canary",
    userIds: "",
    phones: "",
    startsAtIso: "",
    expiresAtIso: nowPlusHours(4),
    priority: 100,
    reason: "",
    json: domainExamples.featureGates,
  };
}

function splitList(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "status-ok";
  if (normalized === "paused") return "status-warn";
  return "status-bad";
}

function statusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "ativo";
  if (normalized === "paused") return "pausado";
  if (normalized === "archived") return "arquivado";
  return normalized || "-";
}

function yesNo(value) {
  return value ? "sim" : "nao";
}

function summarizeDomain(config, domain) {
  const data = config?.[domain] && typeof config[domain] === "object" ? config[domain] : {};
  if (domain === "paymentRuntime") {
    return [
      ["provider", data.provider],
      ["ambiente default", data.summary?.defaultEnvironment],
      ["sandbox canary", yesNo(data.summary?.canarySandboxEnabled)],
      ["app chama provedor", yesNo(data.appMayCallProviderDirectly)],
    ];
  }
  if (domain === "mapsRoutingPolicy") {
    return [
      ["backend only", yesNo(data.backendOnly)],
      ["Google direto no app", yesNo(data.clientDirectGoogleFallback)],
      ["traffic", yesNo(data.routeTrafficEnabled)],
      ["alternativas", yesNo(data.routeAlternativesEnabled)],
    ];
  }
  if (domain === "biometricRuntime") {
    return [
      ["strict mode", yesNo(data.strictModeEnabled)],
      ["trusted match", yesNo(data.requireTrustedBiometricMatch)],
      ["readiness", data.readiness?.state || (data.readiness?.ok ? "ok" : "-")],
      ["providers", Array.isArray(data.trustedMatchProviders) ? data.trustedMatchProviders.join(", ") : "-"],
    ];
  }
  return Object.entries(data).slice(0, 4);
}

function buildPayload(form) {
  const parsed = JSON.parse(form.json || "{}");
  return {
    overrideId: form.overrideId.trim(),
    name: form.name.trim(),
    status: form.status,
    scope: form.scope,
    userIds: splitList(form.userIds),
    phones: splitList(form.phones),
    startsAtIso: form.startsAtIso || undefined,
    expiresAtIso: form.expiresAtIso || undefined,
    priority: Number(form.priority || 0),
    reason: form.reason.trim(),
    config: {
      [form.domain]: parsed,
    },
  };
}

export default function RuntimeFlagsPage() {
  const { user } = useAuth();
  const canMutate = hasAnyRole(user, ADMIN_ROLES);
  const blockedMessage = roleBlockedMessage(user, ADMIN_ROLES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [payload, setPayload] = useState(null);
  const [form, setForm] = useState(defaultForm);

  const config = payload?.config || null;
  const overrides = useMemo(
    () => (Array.isArray(payload?.overrides) ? payload.overrides : []),
    [payload],
  );
  const activeOverrides = useMemo(
    () => overrides.filter((item) => String(item?.status || "").toLowerCase() === "active"),
    [overrides],
  );
  const criticalActiveCount = useMemo(
    () => activeOverrides.filter((item) =>
      Object.keys(item?.config || {}).some((domain) => CRITICAL_DOMAINS.has(domain))
    ).length,
    [activeOverrides],
  );

  const loadRuntimeConfig = async ({ forceRefresh = false } = {}) => {
    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.getRuntimeConfigAdmin({
        includeInactive: true,
        forceRefresh,
      });
      setPayload(response || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar runtime config");
    } finally {
      setLoading(false);
    }
  };

  const onDomainChange = (domain) => {
    setForm((current) => ({
      ...current,
      domain,
      json: domainExamples[domain] || "{}",
    }));
  };

  const saveOverride = async (event) => {
    event.preventDefault();
    if (!canMutate) {
      setError(blockedMessage || "Sem permissao para alterar runtime config.");
      return;
    }
    if (!form.reason.trim()) {
      setError("Informe um motivo operacional para publicar override.");
      return;
    }
    if (CRITICAL_DOMAINS.has(form.domain) && !/canary|incidente|rollback|operacao|produção|producao/i.test(form.reason)) {
      setError("Flags criticas exigem motivo claro: canary, incidente, rollback ou operacao.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const nextPayload = buildPayload(form);
      await leafAPI.publishRuntimeConfigOverride(nextPayload);
      setSuccess("Override salvo. A propagacao respeita o cache curto do backend.");
      setForm(defaultForm());
      await loadRuntimeConfig({ forceRefresh: true });
    } catch (err) {
      setError(err?.message || "Falha ao salvar override. Confira o JSON e o escopo.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (overrideId, status) => {
    try {
      setError("");
      setSuccess("");
      await leafAPI.updateRuntimeConfigOverrideStatus(overrideId, status);
      setSuccess(`Override ${status === "active" ? "ativado" : "pausado"}.`);
      await loadRuntimeConfig({ forceRefresh: true });
    } catch (err) {
      setError(err?.message || "Falha ao atualizar override.");
    }
  };

  const rollbackOverride = async (overrideId) => {
    try {
      setError("");
      setSuccess("");
      await leafAPI.rollbackRuntimeConfigOverride(overrideId, "Rollback manual pelo painel Runtime & Flags");
      setSuccess("Override pausado por rollback.");
      await loadRuntimeConfig({ forceRefresh: true });
    } catch (err) {
      setError(err?.message || "Falha ao executar rollback.");
    }
  };

  useEffect(() => {
    loadRuntimeConfig();
  }, []);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Runtime e flags</h1>
            <p>Backend como fonte de verdade para pagamento, KYC, mapas, push, campanhas e safety.</p>
          </div>
          <div className="filters">
            <button type="button" onClick={() => loadRuntimeConfig({ forceRefresh: true })} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>
        <AppNav />

        <ErrorText message={error} />
        {success ? <article className="success-banner"><p>{success}</p></article> : null}
        {!canMutate ? <article className="warning-banner"><p>{blockedMessage}</p></article> : null}

        {loading && !config ? (
          <LoadingState message="Carregando runtime config..." />
        ) : (
          <>
            <section className="grid grid-kpi">
              <KpiCard title="Ambiente" value={config?.environment || "-"} />
              <KpiCard
                title="Pagamento"
                value={config?.paymentRuntime?.summary?.defaultEnvironment || config?.paymentRuntime?.provider || "-"}
                subtitle="controlado pelo backend"
                tone={config?.paymentRuntime?.appMayCallProviderDirectly ? "danger" : "positive"}
              />
              <KpiCard title="Overrides ativos" value={activeOverrides.length} tone={activeOverrides.length ? "warning" : "positive"} />
              <KpiCard title="Flags criticas" value={criticalActiveCount} tone={criticalActiveCount ? "danger" : "positive"} />
            </section>

            <section className="grid">
              {["paymentRuntime", "biometricRuntime", "mapsRoutingPolicy", "notificationPolicy", "driverOnlinePolicy", "campaignSurfaces"].map((domain) => (
                <Panel key={domain} title={domainLabels[domain] || domain} subtitle={CRITICAL_DOMAINS.has(domain) ? "dominio critico" : "runtime operacional"}>
                  <div className="metric-list">
                    {summarizeDomain(config, domain).map(([key, value]) => (
                      <div className="row" key={key}>
                        <div className="label">{key}</div>
                        <div className="value">{String(value ?? "-")}</div>
                      </div>
                    ))}
                  </div>
                </Panel>
              ))}
            </section>

            <section className="grid">
              <Panel
                title="Publicar override"
                subtitle="Use escopo pequeno, expiração curta e motivo claro. Perfis de pagamento continuam no painel de pagamento."
              >
                <form className="section-stack" onSubmit={saveOverride}>
                  <div className="form-grid">
                    <label className="form-field">
                      Nome
                      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                    </label>
                    <label className="form-field">
                      ID tecnico
                      <input value={form.overrideId} onChange={(event) => setForm({ ...form, overrideId: event.target.value })} />
                    </label>
                    <label className="form-field">
                      Dominio
                      <select value={form.domain} onChange={(event) => onDomainChange(event.target.value)}>
                        {SAFE_DOMAINS.map((domain) => (
                          <option key={domain} value={domain}>{domainLabels[domain] || domain}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      Status inicial
                      <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                        <option value="paused">pausado</option>
                        <option value="active">ativo</option>
                      </select>
                    </label>
                    <label className="form-field">
                      Escopo
                      <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })}>
                        <option value="canary">canary</option>
                        <option value="users">usuarios</option>
                        <option value="phones">telefones</option>
                        <option value="app_review">revisao loja</option>
                        <option value="global">global</option>
                      </select>
                    </label>
                    <label className="form-field">
                      Prioridade
                      <input type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} />
                    </label>
                    <label className="form-field">
                      Inicio
                      <input value={form.startsAtIso} placeholder="opcional" onChange={(event) => setForm({ ...form, startsAtIso: event.target.value })} />
                    </label>
                    <label className="form-field">
                      Expira em
                      <input value={form.expiresAtIso} onChange={(event) => setForm({ ...form, expiresAtIso: event.target.value })} />
                    </label>
                  </div>
                  <label className="form-field">
                    User IDs
                    <textarea rows={2} value={form.userIds} placeholder="um por linha, obrigatorio para canary/users se nao houver telefone" onChange={(event) => setForm({ ...form, userIds: event.target.value })} />
                  </label>
                  <label className="form-field">
                    Telefones
                    <textarea rows={2} value={form.phones} placeholder="um por linha, obrigatorio para canary/phones se nao houver user id" onChange={(event) => setForm({ ...form, phones: event.target.value })} />
                  </label>
                  <label className="form-field">
                    Motivo operacional
                    <textarea rows={2} value={form.reason} placeholder="ex: canary Android 1.0.2, rollback de push, operacao assistida" onChange={(event) => setForm({ ...form, reason: event.target.value })} />
                  </label>
                  <label className="form-field">
                    JSON do dominio selecionado
                    <textarea rows={8} value={form.json} onChange={(event) => setForm({ ...form, json: event.target.value })} />
                  </label>
                  <div className="filters">
                    <button type="submit" disabled={saving || !canMutate}>
                      {saving ? "Salvando..." : "Salvar override"}
                    </button>
                  </div>
                </form>
              </Panel>

              <Panel title="Config efetiva" subtitle="Resumo completo retornado pelo backend">
                <KeyValueGrid
                  data={config || {}}
                  includeKeys={["schemaVersion", "source", "environment", "generatedAt", "cacheTtlSeconds", "staleTtlSeconds"]}
                />
                <TechnicalDetails title="Payload efetivo" data={config} />
              </Panel>
            </section>

            <Panel title="Overrides" subtitle="Historico operacional dos overrides de runtime">
              <div className="table-shell">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Status</th>
                      <th>Escopo</th>
                      <th>Dominios</th>
                      <th>Expira</th>
                      <th>Motivo</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.length === 0 ? (
                      <tr>
                        <td colSpan={7}>Nenhum override criado.</td>
                      </tr>
                    ) : overrides.map((override) => {
                      const overrideId = override.overrideId || override.id;
                      const domains = Object.keys(override.config || {});
                      const active = String(override.status || "").toLowerCase() === "active";
                      return (
                        <tr key={overrideId}>
                          <td>
                            <strong>{override.name || overrideId}</strong>
                            <br />
                            <code>{overrideId}</code>
                          </td>
                          <td><span className={statusClass(override.status)}>{statusLabel(override.status)}</span></td>
                          <td>{override.scope || "-"}</td>
                          <td>{domains.length ? domains.map((domain) => domainLabels[domain] || domain).join(", ") : "-"}</td>
                          <td>{formatDate(override.expiresAtIso)}</td>
                          <td>{override.reason || "-"}</td>
                          <td>
                            <div className="filters">
                              <button type="button" disabled={!canMutate || active} onClick={() => updateStatus(overrideId, "active")}>
                                Ativar
                              </button>
                              <button type="button" disabled={!canMutate || !active} onClick={() => updateStatus(overrideId, "paused")}>
                                Pausar
                              </button>
                              <button type="button" disabled={!canMutate || !active} onClick={() => rollbackOverride(overrideId)}>
                                Rollback
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TechnicalDetails title="Overrides completos" data={overrides} />
            </Panel>
          </>
        )}
      </main>
    </ProtectedRoute>
  );
}
