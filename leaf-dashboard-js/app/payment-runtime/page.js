"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { EmptyState, ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid } from "@/src/components/ui/DataViews";
import { leafAPI } from "@/src/services/api";

const nowPlusHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
const shortId = () => `sandbox-${Date.now().toString(36)}`;

const defaultForm = () => ({
  profileId: shortId(),
  name: "Canary sandbox",
  environment: "sandbox",
  status: "paused",
  scope: "users",
  userIds: "",
  phones: "",
  expiresAtIso: nowPlusHours(4),
  priority: 100,
  reason: "Teste canary com Woovi sandbox",
});

function splitLines(value) {
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

function environmentTone(environment) {
  return String(environment || "").toLowerCase() === "sandbox" ? "warning" : "positive";
}

function buildProfilePayload(form) {
  return {
    profileId: form.profileId.trim(),
    name: form.name.trim(),
    provider: "woovi",
    environment: form.environment,
    status: form.status,
    scope: form.scope,
    userIds: splitLines(form.userIds),
    passengerIds: splitLines(form.userIds),
    phones: splitLines(form.phones),
    startsAtIso: new Date().toISOString(),
    expiresAtIso: form.environment === "sandbox" ? form.expiresAtIso : "",
    priority: Number(form.priority || 0),
    reason: form.reason.trim(),
  };
}

export default function PaymentRuntimePage() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [resolveInput, setResolveInput] = useState({ userId: "", phone: "" });
  const [resolveResult, setResolveResult] = useState(null);
  const [resolving, setResolving] = useState(false);

  const activeSandboxCount = useMemo(
    () => profiles.filter((profile) =>
      String(profile.status).toLowerCase() === "active" &&
      String(profile.environment).toLowerCase() === "sandbox"
    ).length,
    [profiles],
  );

  const loadProfiles = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.listPaymentRuntimeProfiles({ includeInactive: true });
      setProfiles(Array.isArray(response?.profiles) ? response.profiles : []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar perfis de pagamento");
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      await leafAPI.savePaymentRuntimeProfile(buildProfilePayload(form));
      setSuccess("Perfil salvo. A troca passa a valer após o cache curto do backend.");
      setForm(defaultForm());
      await loadProfiles();
    } catch (err) {
      setError(err?.message || "Falha ao salvar perfil de pagamento");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (profileId, status) => {
    try {
      setError("");
      setSuccess("");
      await leafAPI.updatePaymentRuntimeProfileStatus(profileId, status);
      setSuccess(`Perfil ${status === "active" ? "ativado" : "pausado"}.`);
      await loadProfiles();
    } catch (err) {
      setError(err?.message || "Falha ao atualizar status do perfil");
    }
  };

  const resolveProfile = async (event) => {
    event.preventDefault();
    try {
      setResolving(true);
      setError("");
      setResolveResult(null);
      const response = await leafAPI.resolvePaymentRuntimeProfile({
        userId: resolveInput.userId.trim(),
        passengerId: resolveInput.userId.trim(),
        phone: resolveInput.phone.trim(),
      });
      setResolveResult(response?.profile || null);
    } catch (err) {
      setError(err?.message || "Falha ao resolver perfil para o usuário");
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Perfil de pagamento</h1>
            <p>Controle Woovi sandbox ou produção pelo backend, sem gerar nova build do app.</p>
          </div>
          <div className="filters">
            <button type="button" onClick={loadProfiles} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>
        <AppNav />

        <section className="grid grid-kpi">
          <KpiCard title="Sandbox ativo" value={activeSandboxCount} tone={activeSandboxCount > 0 ? "warning" : "positive"} />
          <KpiCard title="Perfis" value={profiles.length} />
          <KpiCard title="Default" value="produção" tone="positive" subtitle="quando nenhum perfil bate" />
          <KpiCard title="Cache" value="~30s" subtitle="sem rebuild e sem restart" />
        </section>

        <section className="grid">
          <Panel
            title="Novo perfil sandbox"
            subtitle="Use sempre escopo por usuário ou telefone, com expiração curta."
          >
            <form className="section-stack" onSubmit={saveProfile}>
              <div className="form-grid">
                <label className="form-field">
                  Nome
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <label className="form-field">
                  ID técnico
                  <input value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })} />
                </label>
                <label className="form-field">
                  Ambiente
                  <select value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })}>
                    <option value="sandbox">sandbox</option>
                    <option value="production">produção</option>
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
                    <option value="users">usuários</option>
                    <option value="phones">telefones</option>
                    <option value="canary">canary</option>
                    <option value="app_review">revisão loja</option>
                  </select>
                </label>
                <label className="form-field">
                  Prioridade
                  <input type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} />
                </label>
              </div>
              <label className="form-field">
                User IDs ou passenger IDs
                <textarea
                  rows={3}
                  value={form.userIds}
                  placeholder="um por linha"
                  onChange={(event) => setForm({ ...form, userIds: event.target.value })}
                />
              </label>
              <label className="form-field">
                Telefones
                <textarea
                  rows={2}
                  value={form.phones}
                  placeholder="+5521992000000"
                  onChange={(event) => setForm({ ...form, phones: event.target.value })}
                />
              </label>
              <div className="form-grid">
                <label className="form-field">
                  Expira em
                  <input
                    value={form.expiresAtIso}
                    onChange={(event) => setForm({ ...form, expiresAtIso: event.target.value })}
                  />
                </label>
                <label className="form-field">
                  Motivo
                  <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
                </label>
              </div>
              <div className="row-actions">
                <button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar perfil"}</button>
                <button type="button" className="button-secondary" onClick={() => setForm(defaultForm())}>Limpar</button>
              </div>
            </form>
          </Panel>

          <Panel
            title="Diagnóstico"
            subtitle="Veja qual ambiente será usado antes de iniciar um pagamento."
          >
            <form className="section-stack" onSubmit={resolveProfile}>
              <div className="form-grid">
                <label className="form-field">
                  User ID
                  <input
                    value={resolveInput.userId}
                    onChange={(event) => setResolveInput({ ...resolveInput, userId: event.target.value })}
                    placeholder="uid do passageiro"
                  />
                </label>
                <label className="form-field">
                  Telefone
                  <input
                    value={resolveInput.phone}
                    onChange={(event) => setResolveInput({ ...resolveInput, phone: event.target.value })}
                    placeholder="+5521..."
                  />
                </label>
              </div>
              <button type="submit" className="button-secondary" disabled={resolving}>
                {resolving ? "Verificando..." : "Resolver perfil"}
              </button>
              {resolveResult ? (
                <KeyValueGrid
                  data={{
                    environment: resolveResult.environment,
                    profile: resolveResult.profileId,
                    source: resolveResult.source,
                    reason: resolveResult.reason,
                    token: resolveResult.hasWooviToken ? "configurado" : "ausente",
                    baseUrl: resolveResult.baseUrlMode,
                  }}
                  labels={{
                    environment: "Ambiente",
                    profile: "Perfil",
                    source: "Origem",
                    reason: "Motivo",
                    token: "Token Woovi",
                    baseUrl: "Host",
                  }}
                />
              ) : null}
            </form>
          </Panel>
        </section>

        <Panel
          title="Perfis existentes"
          subtitle="Sandbox ativo deve ser temporário e restrito. Produção continua como default."
          className="panel-span-full"
        >
          {loading ? <LoadingState message="Carregando perfis..." /> : null}
          {!loading && profiles.length === 0 ? <EmptyState message="Nenhum perfil salvo. O backend usa produção por padrão." /> : null}
          {!loading && profiles.length > 0 ? (
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Perfil</th>
                    <th>Ambiente</th>
                    <th>Escopo</th>
                    <th>Alvos</th>
                    <th>Expira</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => {
                    const status = String(profile.status || "active").toLowerCase();
                    const profileId = profile.profileId || profile.id;
                    const userCount = Number(profile.userIds?.length || profile.passengerIds?.length || 0);
                    const phoneCount = Number(profile.phones?.length || 0);
                    return (
                      <tr key={profileId}>
                        <td>
                          <strong>{profile.name || profileId}</strong>
                          <span className="table-muted">{profileId}</span>
                        </td>
                        <td>
                          <span className={environmentTone(profile.environment) === "warning" ? "status-warn" : "status-ok"}>
                            {profile.environment}
                          </span>
                        </td>
                        <td>{profile.scope || "-"}</td>
                        <td>{userCount} usuário(s) · {phoneCount} telefone(s)</td>
                        <td>{formatDate(profile.expiresAtIso || profile.expiresAt)}</td>
                        <td><span className={statusClass(status)}>{status}</span></td>
                        <td>
                          <div className="row-actions">
                            {status === "active" ? (
                              <button type="button" className="button-secondary" onClick={() => updateStatus(profileId, "paused")}>
                                Pausar
                              </button>
                            ) : (
                              <button type="button" onClick={() => updateStatus(profileId, "active")}>
                                Ativar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        {success ? <p className="success-text">{success}</p> : null}
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
