"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { EmptyState, ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid } from "@/src/components/ui/DataViews";
import { leafAPI } from "@/src/services/api";
import { isAdminMutationEnabled, mutationBlockedMessage } from "@/src/utils/dashboard-access";
import useConfirmAction from "@/src/hooks/useConfirmAction";

const nowPlusHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
const shortId = () => `sandbox-${Date.now().toString(36)}`;

const defaultH3Policy = () => ({
  enabled: true,
  opacity: 1,
  resolutionOffset: -1,
  palette: {
    yellow: "#FACC15",
    red: "#EF4444",
    purple: "#7E22CE",
    yellowStroke: "#CA8A04",
    redStroke: "#B91C1C",
    purpleStroke: "#581C87",
  },
  label: {
    enabled: true,
    minPercent: 3,
    maxVisible: 5,
    template: "+{percent}%",
    backgroundColor: "#171412",
    backgroundOpacity: 0.9,
    textColor: "#FFFFFF",
    borderColor: "#FFFFFF",
    borderOpacity: 0.82,
    fontSize: 12,
  },
});

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
  const [h3Policy, setH3Policy] = useState(defaultH3Policy);
  const [h3Saving, setH3Saving] = useState(false);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const { requestConfirmation, confirmationDialog, confirmationOpen } = useConfirmAction();

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
      const [profilesResult, h3Result, flagsResult] = await Promise.allSettled([
        leafAPI.listPaymentRuntimeProfiles({ includeInactive: true }),
        leafAPI.getH3VisualPolicy(),
        leafAPI.getRuntimeFlags(),
      ]);
      if (profilesResult.status === "fulfilled") {
        setProfiles(Array.isArray(profilesResult.value?.profiles) ? profilesResult.value.profiles : []);
      } else {
        throw profilesResult.reason;
      }
      if (h3Result.status === "fulfilled") {
        const h3Response = h3Result.value;
        setH3Policy({
          ...defaultH3Policy(),
          ...(h3Response?.policy || {}),
          palette: {
            ...defaultH3Policy().palette,
            ...(h3Response?.policy?.palette || {}),
          },
          label: {
            ...defaultH3Policy().label,
            ...(h3Response?.policy?.label || {}),
          },
        });
      }
      if (flagsResult.status === "fulfilled") {
        setRuntimeFlags(flagsResult.value || null);
      }
    } catch (err) {
      setError(err?.message || "Falha ao carregar perfis de pagamento");
    } finally {
      setLoading(false);
    }
  };

  const saveH3Policy = async (event) => {
    event.preventDefault();
    if (readOnly) {
      setError(readOnlyMessage);
      return;
    }
    try {
      setH3Saving(true);
      setError("");
      setSuccess("");
      const response = await leafAPI.updateH3VisualPolicy(h3Policy);
      setH3Policy(response?.policy || h3Policy);
      setSuccess("Estilo do mapa de demanda salvo. O app recebe a mudança em até 30 segundos.");
    } catch (err) {
      setError(err?.message || "Falha ao salvar estilo do mapa de demanda");
    } finally {
      setH3Saving(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (readOnly) {
      setError(readOnlyMessage);
      return;
    }
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

  const requestSaveH3Policy = (event) => {
    event.preventDefault();
    requestConfirmation({
      title: "Publicar estilo do mapa?",
      description: "A política visual será atualizada para os consumidores do mapa após o cache curto.",
      confirmLabel: "Publicar estilo",
      tone: "warning",
      task: () => saveH3Policy({ preventDefault: () => {} }),
    });
  };

  const requestSaveProfile = (event) => {
    event.preventDefault();
    requestConfirmation({
      title: "Salvar perfil de pagamento?",
      description: "O perfil pode alterar o ambiente Woovi usado para usuários dentro do escopo.",
      detail: `Ambiente: ${form.environment}; escopo: ${form.scope}; expiração: ${form.expiresAtIso || "não definida"}.`,
      confirmLabel: "Salvar perfil",
      tone: "danger",
      task: () => saveProfile({ preventDefault: () => {} }),
    });
  };

  const requestUpdateStatus = (profileId, status) => requestConfirmation({
    title: status === "active" ? "Ativar perfil de pagamento?" : "Pausar perfil de pagamento?",
    description: status === "active"
      ? "Usuários compatíveis poderão voltar a usar este perfil imediatamente após o cache."
      : "O perfil deixará de ser elegível para novas resoluções.",
    detail: `Perfil: ${profileId}`,
    confirmLabel: status === "active" ? "Ativar perfil" : "Pausar perfil",
    tone: status === "active" ? "warning" : "danger",
    task: () => updateStatus(profileId, status),
  });

  const updateStatus = async (profileId, status) => {
    if (readOnly) {
      setError(readOnlyMessage);
      return;
    }
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

  const readOnly = runtimeFlags === null || !isAdminMutationEnabled(runtimeFlags);
  const readOnlyMessage = mutationBlockedMessage(runtimeFlags);

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

        <Panel
            title="Mapa de pressão de demanda"
            subtitle={readOnlyMessage || "Ajuste a aparência no mapa do motorista sem nova build. A cotação continua sendo a fonte de verdade para o adicional."}
          className="panel-span-full"
        >
            <form className="section-stack" onSubmit={requestSaveH3Policy}>
            <div className="form-grid">
              <label className="form-field">
                Exibição
                <select
                  value={h3Policy.enabled ? "enabled" : "disabled"}
                  onChange={(event) => setH3Policy({ ...h3Policy, enabled: event.target.value === "enabled" })}
                  disabled={readOnly}
                >
                  <option value="enabled">ativa</option>
                  <option value="disabled">oculta</option>
                </select>
              </label>
              <label className="form-field">
                Tamanho das regiões
                <select
                  value={h3Policy.resolutionOffset}
                  onChange={(event) => setH3Policy({ ...h3Policy, resolutionOffset: Number(event.target.value) })}
                  disabled={readOnly}
                >
                  <option value={-1}>grandes</option>
                  <option value={0}>padrão</option>
                  <option value={1}>pequenas e detalhadas</option>
                </select>
              </label>
              <label className="form-field">
                Opacidade: {Math.round(Number(h3Policy.opacity || 0) * 100)}%
                <input
                  type="range"
                  min="0.15"
                  max="1"
                  step="0.05"
                  value={h3Policy.opacity}
                  onChange={(event) => setH3Policy({ ...h3Policy, opacity: Number(event.target.value) })}
                  disabled={readOnly}
                />
              </label>
            </div>

            <div className="form-grid">
              {[
                ["yellow", "Faixa amarela"],
                ["red", "Faixa vermelha"],
                ["purple", "Faixa roxa"],
              ].map(([key, label]) => (
                <label className="form-field" key={key}>
                  {label}
                  <input
                    type="color"
                    value={h3Policy.palette[key]}
                    onChange={(event) => setH3Policy({
                      ...h3Policy,
                      palette: { ...h3Policy.palette, [key]: event.target.value.toUpperCase() },
                    })}
                    disabled={readOnly}
                  />
                </label>
              ))}
            </div>

            <div className="form-grid">
              <label className="form-field">
                Tags de variação
                <select
                  value={h3Policy.label.enabled ? "enabled" : "disabled"}
                  onChange={(event) => setH3Policy({
                    ...h3Policy,
                    label: { ...h3Policy.label, enabled: event.target.value === "enabled" },
                  })}
                  disabled={readOnly}
                >
                  <option value="enabled">ativas</option>
                  <option value="disabled">ocultas</option>
                </select>
              </label>
              <label className="form-field">
                Mostrar a partir de
                <input
                  type="number"
                  min="1"
                  max="35"
                  value={h3Policy.label.minPercent}
                  onChange={(event) => setH3Policy({
                    ...h3Policy,
                    label: { ...h3Policy.label, minPercent: Number(event.target.value) },
                  })}
                  disabled={readOnly}
                />
              </label>
              <label className="form-field">
                Máximo de tags
                <input
                  type="number"
                  min="0"
                  max="8"
                  value={h3Policy.label.maxVisible}
                  onChange={(event) => setH3Policy({
                    ...h3Policy,
                    label: { ...h3Policy.label, maxVisible: Number(event.target.value) },
                  })}
                  disabled={readOnly}
                />
              </label>
              <label className="form-field">
                Formato
                <input
                  value={h3Policy.label.template}
                  placeholder="+{percent}%"
                  onChange={(event) => setH3Policy({
                    ...h3Policy,
                    label: { ...h3Policy.label, template: event.target.value },
                  })}
                  disabled={readOnly}
                />
              </label>
              <label className="form-field">
                Fundo da tag
                <input
                  type="color"
                  value={h3Policy.label.backgroundColor}
                  onChange={(event) => setH3Policy({
                    ...h3Policy,
                    label: { ...h3Policy.label, backgroundColor: event.target.value.toUpperCase() },
                  })}
                  disabled={readOnly}
                />
              </label>
              <label className="form-field">
                Texto da tag
                <input
                  type="color"
                  value={h3Policy.label.textColor}
                  onChange={(event) => setH3Policy({
                    ...h3Policy,
                    label: { ...h3Policy.label, textColor: event.target.value.toUpperCase() },
                  })}
                  disabled={readOnly}
                />
              </label>
            </div>

            <div className="row-actions">
              <button type="submit" disabled={readOnly || confirmationOpen || h3Saving}>
                {h3Saving ? "Salvando..." : "Publicar estilo"}
              </button>
              <button type="button" className="button-secondary" onClick={() => setH3Policy(defaultH3Policy())} disabled={readOnly}>
                Restaurar padrão no formulário
              </button>
            </div>
          </form>
        </Panel>

        <section className="grid">
          <Panel
            title="Novo perfil sandbox"
            subtitle={readOnlyMessage || "Use sempre escopo por usuário ou telefone, com expiração curta."}
          >
            <form className="section-stack" onSubmit={requestSaveProfile}>
              <div className="form-grid">
                <label className="form-field">
                  Nome
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={readOnly} />
                </label>
                <label className="form-field">
                  ID técnico
                  <input value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })} disabled={readOnly} />
                </label>
                <label className="form-field">
                  Ambiente
                  <select value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })} disabled={readOnly}>
                    <option value="sandbox">sandbox</option>
                    <option value="production">produção</option>
                  </select>
                </label>
                <label className="form-field">
                  Status inicial
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} disabled={readOnly}>
                    <option value="paused">pausado</option>
                    <option value="active">ativo</option>
                  </select>
                </label>
                <label className="form-field">
                  Escopo
                  <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} disabled={readOnly}>
                    <option value="users">usuários</option>
                    <option value="phones">telefones</option>
                    <option value="canary">canary</option>
                    <option value="app_review">revisão loja</option>
                  </select>
                </label>
                <label className="form-field">
                  Prioridade
                  <input type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} disabled={readOnly} />
                </label>
              </div>
              <label className="form-field">
                User IDs ou passenger IDs
                <textarea
                  rows={3}
                  value={form.userIds}
                  placeholder="um por linha"
                  onChange={(event) => setForm({ ...form, userIds: event.target.value })}
                  disabled={readOnly}
                />
              </label>
              <label className="form-field">
                Telefones
                <textarea
                  rows={2}
                  value={form.phones}
                  placeholder="+5521992000000"
                  onChange={(event) => setForm({ ...form, phones: event.target.value })}
                  disabled={readOnly}
                />
              </label>
              <div className="form-grid">
                <label className="form-field">
                  Expira em
                  <input
                    value={form.expiresAtIso}
                    onChange={(event) => setForm({ ...form, expiresAtIso: event.target.value })}
                    disabled={readOnly}
                  />
                </label>
                <label className="form-field">
                  Motivo
                  <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} disabled={readOnly} />
                </label>
              </div>
              <div className="row-actions">
                <button type="submit" disabled={readOnly || confirmationOpen || saving}>{saving ? "Salvando..." : "Salvar perfil"}</button>
                <button type="button" className="button-secondary" onClick={() => setForm(defaultForm())} disabled={readOnly}>Limpar</button>
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
                                <button type="button" className="button-secondary" onClick={() => requestUpdateStatus(profileId, "paused")} disabled={readOnly || confirmationOpen}>
                                Pausar
                              </button>
                            ) : (
                              <button type="button" onClick={() => requestUpdateStatus(profileId, "active")} disabled={readOnly || confirmationOpen}>
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
        {confirmationDialog}
      </main>
    </ProtectedRoute>
  );
}
