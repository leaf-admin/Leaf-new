"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import KpiCard from "@/src/components/ui/KpiCard";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const defaultCampaignForm = {
  name: "",
  type: "driver_referral",
  status: "active",
  maxInvitesPerDriver: 3,
  requiredCompletedTrips: 20,
  rewardMonths: 1,
  qualificationWindowDays: 30,
  discountPercent: 10,
  maxDiscountRides: 3,
  founderFreeMonths: 6,
  nonCumulative: true,
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeCampaignParams(params) {
  if (!params || typeof params !== "object") return "-";
  const lines = [];
  if (params.maxInvitesPerDriver !== undefined) lines.push(`Convites: ${params.maxInvitesPerDriver}`);
  if (params.requiredCompletedTrips !== undefined) lines.push(`Corridas: ${params.requiredCompletedTrips}`);
  if (params.rewardMonths !== undefined) lines.push(`Meses bonus: ${params.rewardMonths}`);
  if (params.discountPercent !== undefined) lines.push(`Desconto: ${params.discountPercent}%`);
  if (params.maxDiscountRides !== undefined) lines.push(`Corridas com desconto: ${params.maxDiscountRides}`);
  if (params.founderFreeMonths !== undefined) lines.push(`Founder: ${params.founderFreeMonths} meses`);
  return lines.length > 0 ? lines.join(" • ") : "-";
}

export default function ProgramsPage() {
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState(null);
  const [config, setConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("all");

  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

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
  }, []);

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

    try {
      setSavingConfig(true);
      setError("");
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

    try {
      setSavingCampaign(true);
      setError("");

      await leafAPI.createReferralCampaign({
        name: campaignForm.name.trim(),
        type: campaignForm.type,
        status: campaignForm.status,
        params: {
          maxInvitesPerDriver: toNumber(campaignForm.maxInvitesPerDriver, 3),
          requiredCompletedTrips: toNumber(campaignForm.requiredCompletedTrips, 20),
          rewardMonths: toNumber(campaignForm.rewardMonths, 1),
          qualificationWindowDays: toNumber(campaignForm.qualificationWindowDays, 30),
          discountPercent: toNumber(campaignForm.discountPercent, 10),
          maxDiscountRides: toNumber(campaignForm.maxDiscountRides, 3),
          founderFreeMonths: toNumber(campaignForm.founderFreeMonths, 6),
          nonCumulative: campaignForm.nonCumulative !== false,
        },
      });

      setCampaignForm(defaultCampaignForm);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao criar campanha");
    } finally {
      setSavingCampaign(false);
    }
  };

  const updateCampaignStatus = async (campaignId, status) => {
    try {
      setError("");
      await leafAPI.updateReferralCampaign(campaignId, { status });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao atualizar status da campanha");
    }
  };

  const summaryCards = useMemo(() => {
    return {
      activeCampaigns: summary?.campaigns?.active || 0,
      totalInvites: summary?.invites?.total || 0,
      acceptedInvites: summary?.invites?.accepted || 0,
      rewardedInvites: summary?.invites?.rewarded || 0,
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
            <button onClick={saveConfig} disabled={savingConfig || !config}>
              {savingConfig ? "Salvando..." : "Salvar configuração"}
            </button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando programas de convite..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Campanhas ativas" value={summaryCards.activeCampaigns} />
          <KpiCard title="Convites totais" value={summaryCards.totalInvites} />
          <KpiCard title="Convites aceitos" value={summaryCards.acceptedInvites} tone="positive" />
          <KpiCard title="Recompensas entregues" value={summaryCards.rewardedInvites} tone="positive" />
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

          <Panel title="Nova Campanha" subtitle="Criação rápida para campanhas sazonais e testes de incentivo.">
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
              <button onClick={createCampaign} disabled={savingCampaign}>
                {savingCampaign ? "Criando..." : "Criar campanha"}
              </button>
            </div>
          </Panel>

          <Panel title="Campanhas Cadastradas" subtitle="Controle de status e governança dos parâmetros ativos.">
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
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Nenhuma campanha cadastrada até o momento.</td>
                    </tr>
                  ) : (
                    filteredCampaigns.map((campaign) => (
                      <tr key={campaign.id}>
                        <td>
                          <strong>{campaign.name}</strong>
                          <span className="table-muted">{campaign.id}</span>
                        </td>
                        <td>{campaign.type}</td>
                        <td>
                          <span
                            className={
                              campaign.status === "active"
                                ? "status-ok"
                                : campaign.status === "paused"
                                  ? "status-warn"
                                  : "status-bad"
                            }
                          >
                            {campaign.status}
                          </span>
                        </td>
                        <td>
                          <span>{summarizeCampaignParams(campaign.params)}</span>
                        </td>
                        <td>
                          <div className="actions-cell">
                            <button onClick={() => updateCampaignStatus(campaign.id, "active")}>Ativar</button>
                            <button onClick={() => updateCampaignStatus(campaign.id, "paused")}>Pausar</button>
                            <button onClick={() => updateCampaignStatus(campaign.id, "completed")}>Encerrar</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Resumo da operacao" subtitle="Indicadores consolidados dos programas de convites.">
            <KeyValueGrid
              data={{
                campanhasAtivas: summaryCards.activeCampaigns,
                convitesTotais: summaryCards.totalInvites,
                convitesAceitos: summaryCards.acceptedInvites,
                recompensasEntregues: summaryCards.rewardedInvites,
                campanhasCadastradas: campaigns.length,
              }}
              labels={{
                campanhasAtivas: "Campanhas ativas",
                convitesTotais: "Convites totais",
                convitesAceitos: "Convites aceitos",
                recompensasEntregues: "Recompensas entregues",
                campanhasCadastradas: "Campanhas cadastradas",
              }}
            />
            <TechnicalDetails title="Ver payload técnico dos programas" data={summary || {}} />
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
