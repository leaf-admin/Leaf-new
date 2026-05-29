"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import KpiCard from "@/src/components/ui/KpiCard";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { TechnicalDetails } from "@/src/components/ui/DataViews";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  hasAnyRole,
  isAdminMutationEnabled,
  isLaunchFeatureEnabled,
  mutationBlockedMessage,
  roleBlockedMessage,
  runtimeFeatureMessage,
} from "@/src/utils/dashboard-access";

const defaultCampaignForm = {
  name: "",
  type: "driver_referral",
  status: "active",
  maxInvitesPerDriver: 3,
  maxInvitesTotal: 0,
  inviteExpiresInDays: 30,
  requiredCompletedTrips: 20,
  rewardMonths: 1,
  qualificationWindowDays: 30,
  discountPercent: 10,
  maxDiscountRides: 3,
  founderFreeMonths: 6,
  nonCumulative: true,
  startAt: "",
  endAt: "",
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeCampaignParams(params) {
  if (!params || typeof params !== "object") return "-";
  const lines = [];
  if (params.maxInvitesPerDriver !== undefined) lines.push(`Convites: ${params.maxInvitesPerDriver}`);
  if (params.maxInvitesTotal !== undefined && Number(params.maxInvitesTotal) > 0) lines.push(`Total campanha: ${params.maxInvitesTotal}`);
  if (params.inviteExpiresInDays !== undefined) lines.push(`Expira: ${params.inviteExpiresInDays} dias`);
  if (params.requiredCompletedTrips !== undefined) lines.push(`Corridas: ${params.requiredCompletedTrips}`);
  if (params.rewardMonths !== undefined) lines.push(`Meses bonus: ${params.rewardMonths}`);
  if (params.discountPercent !== undefined) lines.push(`Desconto: ${params.discountPercent}%`);
  if (params.maxDiscountRides !== undefined) lines.push(`Corridas com desconto: ${params.maxDiscountRides}`);
  if (params.founderFreeMonths !== undefined) lines.push(`Founder: ${params.founderFreeMonths} meses`);
  return lines.length > 0 ? lines.join(" • ") : "-";
}

function scopeEnabledForCampaign(config, type) {
  if (!config) return true;
  if (type === "passenger_referral") return config?.passenger?.enabled !== false;
  if (type === "founder_wave") return config?.founder?.enabled !== false;
  return config?.driver?.enabled !== false;
}

export default function ProgramsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [summary, setSummary] = useState(null);
  const [config, setConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all");

  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm);
  const allowedRoles = useMemo(() => ["admin", "super-admin", "manager", "development"], []);
  const roleMessage = roleBlockedMessage(user, allowedRoles);
  const featureMessage = runtimeFeatureMessage(runtimeFlags, "referralProgramsEnabled", "Programas de convite");
  const mutationMessage = mutationBlockedMessage(runtimeFlags);
  const canReadPrograms = hasAnyRole(user, allowedRoles);
  const canMutatePrograms =
    canReadPrograms &&
    isLaunchFeatureEnabled(runtimeFlags, "referralProgramsEnabled") &&
    isAdminMutationEnabled(runtimeFlags);
  const selectedScopeEnabled = scopeEnabledForCampaign(config, campaignForm.type);
  const actionBlockedMessage =
    roleMessage ||
    featureMessage ||
    mutationMessage ||
    (!selectedScopeEnabled && campaignForm.status === "active"
      ? "Este tipo de programa está desabilitado na configuração global. Crie como pausado ou habilite a configuração antes."
      : "");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setNotice("");

      const flags = await leafAPI.getRuntimeFlags().catch(() => null);
      setRuntimeFlags(flags);

      if (!hasAnyRole(user, allowedRoles)) {
        setSummary(null);
        setConfig(null);
        setCampaigns([]);
        return;
      }

      if (flags && !isLaunchFeatureEnabled(flags, "referralProgramsEnabled")) {
        setSummary(null);
        setConfig(null);
        setCampaigns([]);
        return;
      }

      const [summaryData, configData, campaignsData] = await Promise.all([
        leafAPI.getReferralProgramsSummary(),
        leafAPI.getReferralProgramsConfig(),
        leafAPI.listReferralCampaigns(),
      ]);

      setSummary(summaryData?.summary || null);
      setConfig(configData?.config || null);
      setCampaigns(campaignsData?.campaigns || []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar programas de convites");
    } finally {
      setLoading(false);
    }
  }, [allowedRoles, user]);

  useEffect(() => {
    load();
  }, [load]);

  const updateConfigField = (scope, key, value) => {
    setConfig((prev) => ({
      ...(prev || {}),
      [scope]: {
        ...(prev?.[scope] || {}),
        [key]: value,
      },
    }));
  };

  const saveConfig = async () => {
    if (!config) return;
    if (!canMutatePrograms) {
      setError(roleMessage || featureMessage || mutationMessage || "Configuração bloqueada para este perfil.");
      return;
    }

    try {
      setSavingConfig(true);
      setError("");
      setNotice("");
      await leafAPI.updateReferralProgramsConfig({
        driver: {
          enabled: config?.driver?.enabled !== false,
          maxInvitesPerDriver: toNumber(config?.driver?.maxInvitesPerDriver, 3),
          requiredCompletedTrips: toNumber(config?.driver?.requiredCompletedTrips, 20),
          qualificationWindowDays: toNumber(config?.driver?.qualificationWindowDays, 30),
          rewardMonths: toNumber(config?.driver?.rewardMonths, 1),
          avoidDuplicateInvitees: config?.driver?.avoidDuplicateInvitees !== false,
        },
        passenger: {
          enabled: config?.passenger?.enabled !== false,
          discountPercent: toNumber(config?.passenger?.discountPercent, 10),
          maxDiscountRides: toNumber(config?.passenger?.maxDiscountRides, 3),
          nonCumulative: config?.passenger?.nonCumulative !== false,
        },
        founder: {
          enabled: config?.founder?.enabled !== false,
          freeMonths: toNumber(config?.founder?.freeMonths, 6),
          waveTag: config?.founder?.waveTag || "founder-wave-1",
        },
      });
      await load();
      setNotice("Configuração de programas salva com sucesso.");
    } catch (err) {
      setError(err?.message || "Falha ao salvar configuração");
    } finally {
      setSavingConfig(false);
    }
  };

  const createCampaign = async () => {
    if (!campaignForm.name.trim()) {
      setError("Informe um nome para a campanha");
      return;
    }
    if (!canMutatePrograms || (campaignForm.status === "active" && !selectedScopeEnabled)) {
      setError(actionBlockedMessage || "Campanha bloqueada por permissão ou configuração global.");
      return;
    }

    try {
      setSavingCampaign(true);
      setError("");
      setNotice("");

      await leafAPI.createReferralCampaign({
        name: campaignForm.name.trim(),
        type: campaignForm.type,
        status: campaignForm.status,
        params: {
          maxInvitesPerDriver: toNumber(campaignForm.maxInvitesPerDriver, 3),
          maxInvitesTotal: toNumber(campaignForm.maxInvitesTotal, 0),
          inviteExpiresInDays: toNumber(campaignForm.inviteExpiresInDays, 30),
          requiredCompletedTrips: toNumber(campaignForm.requiredCompletedTrips, 20),
          rewardMonths: toNumber(campaignForm.rewardMonths, 1),
          qualificationWindowDays: toNumber(campaignForm.qualificationWindowDays, 30),
          discountPercent: toNumber(campaignForm.discountPercent, 10),
          maxDiscountRides: toNumber(campaignForm.maxDiscountRides, 3),
          founderFreeMonths: toNumber(campaignForm.founderFreeMonths, 6),
          nonCumulative: campaignForm.nonCumulative !== false,
        },
        startAt: campaignForm.startAt ? new Date(campaignForm.startAt).toISOString() : undefined,
        endAt: campaignForm.endAt ? new Date(campaignForm.endAt).toISOString() : undefined,
      });

      setCampaignForm(defaultCampaignForm);
      await load();
      setNotice("Campanha criada com sucesso.");
    } catch (err) {
      setError(err?.message || "Falha ao criar campanha");
    } finally {
      setSavingCampaign(false);
    }
  };

  const updateCampaignStatus = async (campaignId, status) => {
    const campaign = campaigns.find((item) => item.id === campaignId);
    const campaignScopeEnabled = scopeEnabledForCampaign(config, campaign?.type);
    if (!canMutatePrograms || (status === "active" && !campaignScopeEnabled)) {
      setError(
        roleMessage ||
          featureMessage ||
          mutationMessage ||
          "Este tipo de programa está desabilitado na configuração global. Não é possível ativar a campanha.",
      );
      return;
    }

    try {
      setError("");
      setNotice("");
      await leafAPI.updateReferralCampaign(campaignId, { status });
      await load();
      setNotice(`Campanha ${status === "active" ? "ativada" : "atualizada"} com sucesso.`);
    } catch (err) {
      setError(err?.message || "Falha ao atualizar status da campanha");
    }
  };

  const summaryCards = useMemo(() => {
    const acceptanceRate = Number(summary?.invites?.acceptanceRate || 0);
    const rewardRate = Number(summary?.invites?.rewardRate || 0);
    return {
      activeCampaigns: summary?.campaigns?.active || 0,
      totalInvites: summary?.invites?.total || 0,
      acceptedInvites: summary?.invites?.accepted || 0,
      rewardedInvites: summary?.invites?.rewarded || 0,
      driverTracking: summary?.invites?.driverTracking || 0,
      passengerBenefitsActive: summary?.invites?.passengerBenefitsActive || 0,
      passengerBenefitsConsumed: summary?.invites?.passengerBenefitsConsumed || 0,
      acceptanceRateLabel: `${Math.round(acceptanceRate * 100)}%`,
      rewardRateLabel: `${Math.round(rewardRate * 100)}%`,
    };
  }, [summary]);
  const filteredCampaigns = useMemo(() => {
    const term = campaignSearch.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      const status = String(campaign?.status || "").toLowerCase();
      if (campaignStatusFilter !== "all" && status !== campaignStatusFilter) return false;
      if (!term) return true;
      return `${campaign?.id || ""} ${campaign?.name || ""} ${campaign?.type || ""} ${status}`
        .toLowerCase()
        .includes(term);
    });
  }, [campaigns, campaignSearch, campaignStatusFilter]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Programas de Convite</h1>
          <div className="filters">
            <button onClick={load}>Atualizar</button>
            <button onClick={saveConfig} disabled={savingConfig || !config || !canMutatePrograms} title={!canMutatePrograms ? (roleMessage || featureMessage || mutationMessage) : undefined}>
              {savingConfig ? "Salvando..." : "Salvar configuração"}
            </button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando programas de convite..." /> : null}
        {roleMessage || featureMessage || mutationMessage ? (
          <ErrorText message={roleMessage || featureMessage || mutationMessage} />
        ) : null}
        {notice ? <p className="success-text">{notice}</p> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Campanhas ativas" value={summaryCards.activeCampaigns} />
          <KpiCard title="Convites totais" value={summaryCards.totalInvites} />
          <KpiCard title="Convites aceitos" value={summaryCards.acceptedInvites} tone="positive" />
          <KpiCard title="Recompensas entregues" value={summaryCards.rewardedInvites} tone="positive" />
        </section>

        <section className="grid grid-kpi">
          <KpiCard title="Em qualificação" value={summaryCards.driverTracking} />
          <KpiCard title="Benefícios ativos" value={summaryCards.passengerBenefitsActive} tone="positive" />
          <KpiCard title="Benefícios usados" value={summaryCards.passengerBenefitsConsumed} />
          <KpiCard title="Aceite / recompensa" value={`${summaryCards.acceptanceRateLabel} / ${summaryCards.rewardRateLabel}`} />
        </section>

        <section className="grid">
          <Panel
            title="Configuração Global"
            subtitle="Parâmetros padrão para programas de motorista, passageiro e founder wave."
          >
            {!config ? (
              <p>Sem configuração carregada.</p>
            ) : (
              <div className="section-stack">
                <div className="form-grid">
                  <label className="form-field form-field-checkbox">
                    <span>Driver habilitado</span>
                    <input
                      type="checkbox"
                      checked={config?.driver?.enabled !== false}
                      onChange={(e) => updateConfigField("driver", "enabled", e.target.checked)}
                    />
                  </label>
                  <label className="form-field">
                    Máx convites/driver
                    <input
                      type="number"
                      min="0"
                      value={config?.driver?.maxInvitesPerDriver ?? 3}
                      onChange={(e) => updateConfigField("driver", "maxInvitesPerDriver", e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Corridas para qualificar
                    <input
                      type="number"
                      min="0"
                      value={config?.driver?.requiredCompletedTrips ?? 20}
                      onChange={(e) => updateConfigField("driver", "requiredCompletedTrips", e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Janela (dias)
                    <input
                      type="number"
                      min="1"
                      value={config?.driver?.qualificationWindowDays ?? 30}
                      onChange={(e) => updateConfigField("driver", "qualificationWindowDays", e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Recompensa (meses)
                    <input
                      type="number"
                      min="0"
                      value={config?.driver?.rewardMonths ?? 1}
                      onChange={(e) => updateConfigField("driver", "rewardMonths", e.target.value)}
                    />
                  </label>
                </div>

                <div className="form-separator" />

                <div className="form-grid">
                  <label className="form-field form-field-checkbox">
                    <span>Passenger habilitado</span>
                    <input
                      type="checkbox"
                      checked={config?.passenger?.enabled !== false}
                      onChange={(e) => updateConfigField("passenger", "enabled", e.target.checked)}
                    />
                  </label>
                  <label className="form-field">
                    Desconto %
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={config?.passenger?.discountPercent ?? 10}
                      onChange={(e) => updateConfigField("passenger", "discountPercent", e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Corridas com desconto
                    <input
                      type="number"
                      min="0"
                      value={config?.passenger?.maxDiscountRides ?? 3}
                      onChange={(e) => updateConfigField("passenger", "maxDiscountRides", e.target.value)}
                    />
                  </label>
                  <label className="form-field form-field-checkbox">
                    <span>Não cumulativo</span>
                    <input
                      type="checkbox"
                      checked={config?.passenger?.nonCumulative !== false}
                      onChange={(e) => updateConfigField("passenger", "nonCumulative", e.target.checked)}
                    />
                  </label>
                </div>

                <div className="form-separator" />

                <div className="form-grid">
                  <label className="form-field form-field-checkbox">
                    <span>Founder habilitado</span>
                    <input
                      type="checkbox"
                      checked={config?.founder?.enabled !== false}
                      onChange={(e) => updateConfigField("founder", "enabled", e.target.checked)}
                    />
                  </label>
                  <label className="form-field">
                    Founder meses grátis
                    <input
                      type="number"
                      min="0"
                      value={config?.founder?.freeMonths ?? 6}
                      onChange={(e) => updateConfigField("founder", "freeMonths", e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Tag da onda
                    <input
                      value={config?.founder?.waveTag || "founder-wave-1"}
                      onChange={(e) => updateConfigField("founder", "waveTag", e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Nova Campanha"
            subtitle={
              canMutatePrograms
                ? "Criação rápida para campanhas sazonais e testes de incentivo."
                : "Criação bloqueada por permissão ou feature flag do backend."
            }
          >
            <div className="form-grid">
              <label className="form-field">
                Nome
                <input
                  placeholder="Ex.: Founder Rio - Abril"
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Tipo
                <select
                  value={campaignForm.type}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, type: e.target.value }))}
                >
                  <option value="driver_referral">Driver referral</option>
                  <option value="passenger_referral">Passenger referral</option>
                  <option value="founder_wave">Founder wave</option>
                </select>
              </label>
              <label className="form-field">
                Status inicial
                <select
                  value={campaignForm.status}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="completed">completed</option>
                </select>
              </label>
              <label className="form-field">
                Máx convites
                <input
                  type="number"
                  min="0"
                  value={campaignForm.maxInvitesPerDriver}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, maxInvitesPerDriver: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Limite total da campanha
                <input
                  type="number"
                  min="0"
                  value={campaignForm.maxInvitesTotal}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, maxInvitesTotal: e.target.value }))}
                />
                <span className="text-muted">Use 0 para deixar sem limite total.</span>
              </label>
              <label className="form-field">
                Expiração do convite (dias)
                <input
                  type="number"
                  min="1"
                  value={campaignForm.inviteExpiresInDays}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, inviteExpiresInDays: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Corridas qualificação
                <input
                  type="number"
                  min="0"
                  value={campaignForm.requiredCompletedTrips}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, requiredCompletedTrips: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Meses recompensa
                <input
                  type="number"
                  min="0"
                  value={campaignForm.rewardMonths}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, rewardMonths: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Desconto %
                <input
                  type="number"
                  min="0"
                  value={campaignForm.discountPercent}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, discountPercent: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Início
                <input
                  type="datetime-local"
                  value={campaignForm.startAt}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, startAt: e.target.value }))}
                />
              </label>
              <label className="form-field">
                Fim
                <input
                  type="datetime-local"
                  value={campaignForm.endAt}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, endAt: e.target.value }))}
                />
              </label>
              {!selectedScopeEnabled && campaignForm.status === "active" ? (
                <p className="muted">Este tipo está desabilitado na configuração global; use status pausado.</p>
              ) : null}
              <button onClick={createCampaign} disabled={savingCampaign || !canMutatePrograms || (campaignForm.status === "active" && !selectedScopeEnabled)}>
                {savingCampaign ? "Criando..." : "Criar campanha"}
              </button>
            </div>
          </Panel>

          <Panel
            className="panel-span-full"
            title="Campanhas Cadastradas"
            subtitle="Controle de status e governança dos parâmetros ativos."
          >
            <div className="filters">
              <input
                placeholder="Filtrar por nome, id ou tipo"
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
              />
              <select value={campaignStatusFilter} onChange={(e) => setCampaignStatusFilter(e.target.value)}>
                <option value="all">Todos os status</option>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="completed">completed</option>
              </select>
            </div>
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Parâmetros</th>
                    <th>Janela</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhuma campanha cadastrada até o momento.</td>
                    </tr>
                  ) : (
                    filteredCampaigns.map((campaign) => {
                      const campaignScopeEnabled = scopeEnabledForCampaign(config, campaign.type);
                      const campaignBlocked = campaign.status === "active" && !campaignScopeEnabled;
                      return (
                      <tr key={campaign.id}>
                        <td>
                          <strong>{campaign.name}</strong>
                          <span className="table-muted">{campaign.id}</span>
                        </td>
                        <td>{campaign.type}</td>
                        <td>
                          <span
                            className={
                              campaignBlocked
                                ? "status-bad"
                                : campaign.status === "active"
                                ? "status-ok"
                                : campaign.status === "paused"
                                  ? "status-warn"
                                  : "status-bad"
                            }
                          >
                            {campaignBlocked ? "bloqueada" : campaign.status}
                          </span>
                          {campaignBlocked ? <span className="table-muted">config global desabilitada</span> : null}
                        </td>
                        <td>
                          <span>{summarizeCampaignParams(campaign.params)}</span>
                        </td>
                        <td>
                          <span>{formatDate(campaign.startAt)}</span>
                          <span className="table-muted">{formatDate(campaign.endAt)}</span>
                        </td>
                        <td>
                          <div className="actions-cell">
                            <button
                              onClick={() => updateCampaignStatus(campaign.id, "active")}
                              disabled={!canMutatePrograms || !campaignScopeEnabled || campaign.status === "active"}
                            >
                              Ativar
                            </button>
                            <button onClick={() => updateCampaignStatus(campaign.id, "paused")} disabled={!canMutatePrograms || campaign.status === "paused"}>Pausar</button>
                            <button onClick={() => updateCampaignStatus(campaign.id, "completed")} disabled={!canMutatePrograms || campaign.status === "completed"}>Encerrar</button>
                          </div>
                        </td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <TechnicalDetails title="Ver payload técnico dos programas" data={{ summary, campaigns }} />
          </Panel>

          <Panel
            className="panel-span-full"
            title="Ciclo de vida dos convites"
            subtitle="Últimos convites criados, aceitos e qualificados pelo novo fluxo Leaf."
          >
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Recompensa</th>
                    <th>Convidador</th>
                    <th>Aceito por</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.invites?.recent || []).length === 0 ? (
                    <tr>
                      <td colSpan={6}>Ainda não há convites recentes no novo fluxo.</td>
                    </tr>
                  ) : (
                    (summary?.invites?.recent || []).map((invite) => (
                      <tr key={invite.id || invite.code}>
                        <td>
                          <strong>{invite.code || "-"}</strong>
                          <span className="table-muted">{invite.id || "-"}</span>
                        </td>
                        <td>{invite.type || "-"}</td>
                        <td>{invite.status || "-"}</td>
                        <td>{invite.rewardStatus || "-"}</td>
                        <td>{invite.inviterId || "-"}</td>
                        <td>{invite.acceptedBy || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
