"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { useAuth } from "@/src/contexts/AuthContext";
import { leafAPI } from "@/src/services/api";
import {
  hasAnyRole,
  isAdminMutationEnabled,
  isLaunchFeatureEnabled,
  mutationBlockedMessage,
  roleBlockedMessage,
  runtimeFeatureMessage,
} from "@/src/utils/dashboard-access";

const defaultForm = {
  name: "",
  status: "paused",
  template: "compact_banner",
  roles: "customer",
  surfaces: "passenger_home",
  placements: "above_search_card",
  priority: 20,
  title: "",
  eyebrow: "",
  body: "",
  ctaLabel: "",
  ctaAction: "dismiss",
  startAt: "",
  endAt: "",
};

const statusOptions = ["all", "active", "paused", "draft", "archived", "completed"];
const roleOptions = ["all", "customer", "driver"];
const surfaceOptions = [
  "passenger_home",
  "driver_home",
  "payment",
  "trip_active",
  "driver_earnings",
];
const templateOptions = [
  "compact_banner",
  "hero_banner",
  "bottom_sheet",
  "popup",
  "inline_card",
  "driver_goal_card",
];

function csvToArray(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusClass(status) {
  if (status === "active") return "status-ok";
  if (status === "paused" || status === "draft") return "status-warn";
  return "status-bad";
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

export default function CampaignCenterPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [surfaceFilter, setSurfaceFilter] = useState("");
  const [queryFilter, setQueryFilter] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [previewResult, setPreviewResult] = useState(null);
  const [busyCampaignId, setBusyCampaignId] = useState("");
  const allowedRoles = useMemo(() => ["admin", "super-admin", "manager", "development"], []);
  const roleMessage = roleBlockedMessage(user, allowedRoles);
  const featureMessage = runtimeFeatureMessage(runtimeFlags, "campaignCenterEnabled", "Campaign Center");
  const mutationMessage = mutationBlockedMessage(runtimeFlags);
  const canReadCampaignCenter = hasAnyRole(user, allowedRoles);
  const canMutateCampaignCenter =
    canReadCampaignCenter &&
    isLaunchFeatureEnabled(runtimeFlags, "campaignCenterEnabled") &&
    isAdminMutationEnabled(runtimeFlags);
  const actionBlockedMessage = roleMessage || featureMessage || mutationMessage;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const flags = await leafAPI.getRuntimeFlags().catch(() => null);
      setRuntimeFlags(flags);

      if (!hasAnyRole(user, allowedRoles)) {
        setRows([]);
        setStats(null);
        return;
      }

      if (flags && !isLaunchFeatureEnabled(flags, "campaignCenterEnabled")) {
        setRows([]);
        setStats(null);
        return;
      }

      const params = {
        status: statusFilter,
        role: roleFilter === "all" ? "" : roleFilter,
        surface: surfaceFilter,
        query: queryFilter,
      };
      const response = await leafAPI.listInAppCampaigns(params);
      setRows(response?.campaigns || []);
      setStats(response?.stats || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar campanhas in-app");
    } finally {
      setLoading(false);
    }
  }, [allowedRoles, queryFilter, roleFilter, statusFilter, surfaceFilter, user]);

  useEffect(() => {
    load();
  }, [load]);

  const canCreate = useMemo(
    () =>
      canMutateCampaignCenter &&
      form.name.trim().length > 2 &&
      form.title.trim().length > 2 &&
      form.body.trim().length > 2,
    [canMutateCampaignCenter, form.body, form.name, form.title],
  );

  const create = async () => {
    if (!canCreate) {
      setError(actionBlockedMessage || "Informe nome, titulo e texto da campanha.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await leafAPI.createInAppCampaign({
        name: form.name.trim(),
        status: form.status,
        template: form.template,
        priority: Number(form.priority) || 0,
        surfaces: csvToArray(form.surfaces),
        placements: csvToArray(form.placements),
        audience: {
          roles: csvToArray(form.roles),
        },
        content: {
          eyebrow: form.eyebrow.trim(),
          title: form.title.trim(),
          body: form.body.trim(),
          cta: {
            label: form.ctaLabel.trim(),
            action: form.ctaAction.trim(),
          },
        },
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      });
      setForm(defaultForm);
      await load();
      setNotice("Campanha criada. Revise o status antes de publicar no app.");
    } catch (err) {
      setError(err?.message || "Falha ao criar campanha");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (campaignId, status) => {
    if (!campaignId || !status) return;
    if (!canMutateCampaignCenter) {
      setError(actionBlockedMessage || "Ação bloqueada para este perfil.");
      return;
    }
    setBusyCampaignId(campaignId);
    setError("");
    setNotice("");
    try {
      await leafAPI.updateInAppCampaign(campaignId, { status });
      await load();
      setNotice(`Campanha ${status === "active" ? "ativada" : "atualizada"} com sucesso.`);
    } catch (err) {
      setError(err?.message || "Falha ao atualizar campanha");
    } finally {
      setBusyCampaignId("");
    }
  };

  const preview = async (campaign) => {
    if (!campaign?.id) return;
    setBusyCampaignId(campaign.id);
    setPreviewResult(null);
    setError("");
    try {
      const response = await leafAPI.previewInAppCampaign(campaign.id, {
        surface: campaign.surfaces?.[0] || "passenger_home",
        placement: campaign.placements?.[0] || "default",
        role: campaign.audience?.roles?.[0] || "customer",
      });
      setPreviewResult({
        campaignId: campaign.id,
        campaignName: campaign.name,
        ...response,
      });
    } catch (err) {
      setError(err?.message || "Falha ao simular elegibilidade");
    } finally {
      setBusyCampaignId("");
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Campanhas in-app</h1>
            <p>Controle banners, popups e cards renderizados dentro do app sem publicar nova build.</p>
          </div>
          <div className="filters">
            <input
              placeholder="Buscar por nome, id ou texto"
              value={queryFilter}
              onChange={(event) => setQueryFilter(event.target.value)}
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <select value={surfaceFilter} onChange={(event) => setSurfaceFilter(event.target.value)}>
              <option value="">todas surfaces</option>
              {surfaceOptions.map((surface) => (
                <option key={surface} value={surface}>
                  {surface}
                </option>
              ))}
            </select>
            <button onClick={load}>Atualizar</button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando campanhas in-app..." /> : null}
        {roleMessage || featureMessage || mutationMessage ? (
          <ErrorText message={actionBlockedMessage} />
        ) : null}
        {notice ? <p className="success-text">{notice}</p> : null}

        <section className="grid grid-kpi">
          <Panel title="Total">
            <strong>{stats?.total ?? rows.length}</strong>
            <p className="text-muted">campanhas</p>
          </Panel>
          <Panel title="Ativas">
            <strong>{stats?.active ?? rows.filter((row) => row.status === "active").length}</strong>
            <p className="text-muted">em exibicao</p>
          </Panel>
          <Panel title="Impressões">
            <strong>{stats?.impressions ?? 0}</strong>
            <p className="text-muted">eventos registrados</p>
          </Panel>
          <Panel title="Cliques">
            <strong>{stats?.clicks ?? 0}</strong>
            <p className="text-muted">interacoes</p>
          </Panel>
        </section>

        <section className="grid">
          <Panel
            title="Criar campanha"
            subtitle={
              canMutateCampaignCenter
                ? "Seed do Figma entra pausado; ative somente quando quiser publicar no app."
                : "Criação bloqueada por permissão ou feature flag do backend."
            }
          >
            <div className="form-grid">
              <label className="form-field">
                Nome interno
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Ex: Boas-vindas passageiro"
                />
              </label>
              <label className="form-field">
                Status
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  {statusOptions.filter((status) => status !== "all").map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Template
                <select value={form.template} onChange={(event) => setForm((prev) => ({ ...prev, template: event.target.value }))}>
                  {templateOptions.map((template) => (
                    <option key={template} value={template}>
                      {template}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Prioridade
                <input
                  type="number"
                  value={form.priority}
                  onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Roles
                <input
                  value={form.roles}
                  onChange={(event) => setForm((prev) => ({ ...prev, roles: event.target.value }))}
                  placeholder="customer, driver"
                />
              </label>
              <label className="form-field">
                Surfaces
                <input
                  value={form.surfaces}
                  onChange={(event) => setForm((prev) => ({ ...prev, surfaces: event.target.value }))}
                  placeholder="passenger_home"
                />
              </label>
              <label className="form-field">
                Placements
                <input
                  value={form.placements}
                  onChange={(event) => setForm((prev) => ({ ...prev, placements: event.target.value }))}
                  placeholder="above_search_card"
                />
              </label>
              <label className="form-field">
                Eyebrow
                <input
                  value={form.eyebrow}
                  onChange={(event) => setForm((prev) => ({ ...prev, eyebrow: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                Titulo
                <input
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Texto principal"
                />
              </label>
              <label className="form-field">
                Corpo
                <input
                  value={form.body}
                  onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                  placeholder="Texto curto do banner"
                />
              </label>
              <label className="form-field">
                CTA
                <input
                  value={form.ctaLabel}
                  onChange={(event) => setForm((prev) => ({ ...prev, ctaLabel: event.target.value }))}
                  placeholder="Ex: Ver detalhes"
                />
              </label>
              <label className="form-field">
                Acao CTA
                <input
                  value={form.ctaAction}
                  onChange={(event) => setForm((prev) => ({ ...prev, ctaAction: event.target.value }))}
                  placeholder="dismiss, open_invites..."
                />
              </label>
              <label className="form-field">
                Inicio
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, startAt: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Fim
                <input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, endAt: event.target.value }))}
                />
              </label>
              <button onClick={create} disabled={!canCreate || saving} title={!canCreate ? actionBlockedMessage : undefined}>
                {saving ? "Criando..." : "Criar campanha"}
              </button>
            </div>
          </Panel>

          <Panel title="Preview de elegibilidade" subtitle="Simula a primeira surface cadastrada na campanha selecionada.">
            {previewResult ? (
              <>
                <KeyValueGrid
                  data={{
                    campanha: previewResult.campaignName,
                    elegivel: previewResult.eligible,
                    retornadas: previewResult.campaigns?.length || 0,
                    avaliadoEm: previewResult.evaluatedAt,
                  }}
                />
                <TechnicalDetails title="Payload retornado" data={previewResult} />
              </>
            ) : (
              <p className="text-muted">Use o botao Simular em qualquer campanha para validar surface, role e prioridade.</p>
            )}
          </Panel>

          <Panel className="panel-span-full" title="Campanhas cadastradas">
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Status</th>
                    <th>Template</th>
                    <th>Publico</th>
                    <th>Surface</th>
                    <th>Janela</th>
                    <th>Metricas</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Nenhuma campanha encontrada.</td>
                    </tr>
                  ) : (
                    rows.map((campaign) => {
                      const isBusy = busyCampaignId === campaign.id;
                      return (
                        <tr key={campaign.id}>
                          <td>
                            <strong>{campaign.name}</strong>
                            <br />
                            <span className="text-muted">{campaign.content?.title || campaign.id}</span>
                          </td>
                          <td>
                            <span className={statusClass(campaign.status)}>{campaign.status}</span>
                          </td>
                          <td>{campaign.template || "-"}</td>
                          <td>{campaign.audience?.roles?.join(", ") || "all"}</td>
                          <td>{campaign.surfaces?.join(", ") || "-"}</td>
                          <td>
                            {formatDate(campaign.startAt)}
                            <br />
                            <span className="text-muted">{formatDate(campaign.endAt)}</span>
                          </td>
                          <td>
                            {campaign.metrics?.impressions || 0} imp
                            <br />
                            <span className="text-muted">{campaign.metrics?.clicks || 0} clicks</span>
                          </td>
                          <td>
                            <div className="actions-cell">
                              <button
                                disabled={!canMutateCampaignCenter || isBusy || campaign.status === "active"}
                                onClick={() => updateStatus(campaign.id, "active")}
                                title={!canMutateCampaignCenter ? actionBlockedMessage : undefined}
                              >
                                Ativar
                              </button>
                              <button
                                disabled={!canMutateCampaignCenter || isBusy || campaign.status === "paused"}
                                onClick={() => updateStatus(campaign.id, "paused")}
                                title={!canMutateCampaignCenter ? actionBlockedMessage : undefined}
                              >
                                Pausar
                              </button>
                              <button disabled={isBusy} onClick={() => preview(campaign)}>
                                Simular
                              </button>
                            </div>
                            <TechnicalDetails title="Payload" data={campaign} />
                          </td>
                        </tr>
                      );
                    })
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
