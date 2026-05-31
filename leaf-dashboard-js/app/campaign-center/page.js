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
  template: "home_banner_card",
  roles: "customer",
  surfaces: "passenger_home",
  placements: "below_search_card",
  priority: 20,
  title: "",
  eyebrow: "",
  body: "",
  imageUrl: "",
  imageAlt: "",
  displayMode: "text_overlay",
  backgroundColor: "#FBFCF8",
  textColor: "#171412",
  ctaLabel: "",
  ctaAction: "dismiss",
  ctaUrl: "",
  ctaRoute: "",
  autoRotateSeconds: 6,
  rotationWeight: 1,
  maxImpressionsPerUser: 6,
  maxImpressionsPerDay: 2,
  dismissCooldownHours: 72,
  advertiser: "",
  campaignValueBRL: "",
  costModel: "internal",
  contractedImpressions: "",
  contractedClicks: "",
  soldCpmBRL: "",
  soldCpcBRL: "",
  invoiceId: "",
  commercialNotes: "",
  startAt: "",
  endAt: "",
};

const statusOptions = ["all", "active", "paused", "draft", "archived", "completed"];
const roleOptions = ["all", "customer", "driver"];
const surfaceOptions = [
  "passenger_home",
  "driver_home",
  "ride_map",
  "payment",
  "trip_active",
  "driver_earnings",
];
const templateOptions = [
  "home_banner_card",
  "compact_banner",
  "hero_banner",
  "bottom_sheet",
  "popup",
  "inline_card",
  "driver_goal_card",
  "map_vehicle_marker",
];
const costModelOptions = ["internal", "fixed_fee", "cpm", "cpc", "cpa", "barter"];

const fallbackCampaignSlots = [
  {
    id: "passenger_home_banner_stack",
    label: "Passageiro home - card abaixo de partida/destino",
    surface: "passenger_home",
    placement: "below_search_card",
    role: "customer",
    template: "home_banner_card",
    maxItems: 3,
    autoRotateSeconds: 6,
    dimensions: {
      widthDp: "screen_width_minus_48",
      horizontalInsetDp: 24,
      heightDp: 188,
      borderRadiusDp: 28,
      gapFromSearchCardDp: 12,
      innerPaddingHorizontalDp: 24,
      innerPaddingTopDp: 22,
      innerPaddingBottomDp: 18,
      referenceFramePx: { width: 345, height: 188 },
      exportPx: {
        "@1x": { width: 345, height: 188 },
        "@2x": { width: 690, height: 376 },
        "@3x": { width: 1035, height: 564 },
      },
      safeContentPx: {
        "@1x": { width: 297, height: 148 },
        "@2x": { width: 594, height: 296 },
        "@3x": { width: 891, height: 444 },
      },
    },
  },
  {
    id: "driver_home_banner_stack",
    label: "Motorista home - card abaixo do painel inicial",
    surface: "driver_home",
    placement: "below_home_card",
    role: "driver",
    template: "home_banner_card",
    maxItems: 3,
    autoRotateSeconds: 6,
    dimensions: {
      widthDp: "screen_width_minus_48",
      horizontalInsetDp: 24,
      heightDp: 188,
      borderRadiusDp: 32,
      gapFromDriverCardDp: 12,
      innerPaddingHorizontalDp: 24,
      innerPaddingTopDp: 22,
      innerPaddingBottomDp: 18,
      referenceFramePx: { width: 345, height: 188 },
      exportPx: {
        "@1x": { width: 345, height: 188 },
        "@2x": { width: 690, height: 376 },
        "@3x": { width: 1035, height: 564 },
      },
      safeContentPx: {
        "@1x": { width: 297, height: 148 },
        "@2x": { width: 594, height: 296 },
        "@3x": { width: 891, height: 444 },
      },
    },
  },
  {
    id: "ride_map_vehicle_marker",
    label: "Mapa da corrida - marcador de veículo",
    surface: "ride_map",
    placement: "vehicle_marker",
    role: "all",
    template: "map_vehicle_marker",
    maxItems: 1,
    autoRotateSeconds: 0,
    dimensions: {
      widthPx: 512,
      heightPx: 512,
      transparentBackground: true,
      safeContentPx: { width: 392, height: 456 },
      notes: [
        "Use PNG ou WebP transparente.",
        "Preserve rodas, vidros e sombra para leitura no mapa.",
        "Sem campanha ativa, o app usa o marcador local por cor do veículo.",
      ],
    },
  },
];
const fallbackHomeBannerSlot = fallbackCampaignSlots[0];

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

function parseBRLCents(value) {
  const normalized = String(value || "")
    .replace(/[R$\s.]/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function formatCurrencyCents(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((Number(value || 0) || 0) / 100);
}

function formatPercent(value) {
  return `${((Number(value || 0) || 0) * 100).toFixed(2)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0) || 0);
}

function dateIsPast(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() < Date.now();
}

function campaignUsesSurface(campaign, surface) {
  return Array.isArray(campaign?.surfaces) && campaign.surfaces.includes(surface);
}

function buildCampaignAlerts(rows, commercialReport) {
  const alerts = [];
  const activeRows = rows.filter((row) => row.status === "active");
  const commercialRows = commercialReport?.rows || [];

  for (const surface of ["passenger_home", "driver_home"]) {
    if (!activeRows.some((row) => campaignUsesSurface(row, surface))) {
      alerts.push({
        id: `missing-${surface}`,
        tone: "status-warn",
        title: `${surface} sem campanha ativa`,
        detail: "Confira se o app deve exibir banner nessa superfície hoje.",
      });
    }
  }

  activeRows.forEach((campaign) => {
    if (!campaign.content?.imageUrl) {
      alerts.push({
        id: `image-${campaign.id}`,
        tone: "status-warn",
        title: `${campaign.name} sem arte`,
        detail: "Sem imagem, o app pode cair no estado textual/fallback.",
      });
    }
    if (dateIsPast(campaign.endAt)) {
      alerts.push({
        id: `expired-${campaign.id}`,
        tone: "status-bad",
        title: `${campaign.name} venceu`,
        detail: "Campanha ativa com fim no passado. Pause ou ajuste a janela.",
      });
    }
  });

  commercialRows.forEach((row) => {
    if (Number(row.contractedImpressions || 0) > 0 && Number(row.deliveryProgress || 0) >= 1) {
      alerts.push({
        id: `delivery-${row.id}`,
        tone: "status-ok",
        title: `${row.name} bateu a meta de visualizações`,
        detail: "Pode encerrar, renovar ou trocar prioridade.",
      });
    }
  });

  if (!alerts.length) {
    alerts.push({
      id: "campaigns-ok",
      tone: "status-ok",
      title: "Campanhas sem alerta crítico",
      detail: "Inventário e métricas estão dentro do esperado para o filtro atual.",
    });
  }

  return alerts.slice(0, 8);
}

export default function CampaignCenterPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [commercialReport, setCommercialReport] = useState(null);
  const [slots, setSlots] = useState(fallbackCampaignSlots);
  const [runtimeFlags, setRuntimeFlags] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [surfaceFilter, setSurfaceFilter] = useState("");
  const [queryFilter, setQueryFilter] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [assetFile, setAssetFile] = useState(null);
  const [assetPreviewUrl, setAssetPreviewUrl] = useState("");
  const [assetUploading, setAssetUploading] = useState(false);
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
      const reportResponse = await leafAPI.getInAppCampaignCommercialReport(params).catch(() => null);
      setCommercialReport(reportResponse?.report || null);
      const slotResponse = await leafAPI.listInAppCampaignSlots().catch(() => null);
      setSlots(slotResponse?.slots?.length ? slotResponse.slots : fallbackCampaignSlots);
    } catch (err) {
      setError(err?.message || "Falha ao carregar campanhas in-app");
      setCommercialReport(null);
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
            url: form.ctaUrl.trim(),
            route: form.ctaRoute.trim(),
          },
          imageUrl: form.imageUrl.trim(),
          imageAlt: form.imageAlt.trim(),
          displayMode: form.displayMode,
          hideTextOverlay: form.displayMode === "image_only",
          backgroundColor: form.backgroundColor.trim(),
          textColor: form.textColor.trim(),
        },
        rules: {
          autoRotateSeconds: Number(form.autoRotateSeconds) || 6,
          rotationWeight: Number(form.rotationWeight) || 1,
          maxImpressionsPerUser: Number(form.maxImpressionsPerUser) || 6,
          maxImpressionsPerDay: Number(form.maxImpressionsPerDay) || 2,
          dismissCooldownHours: Number(form.dismissCooldownHours) || 72,
          metadata: {
            slot: selectedSlot.id,
            creativeSpec: selectedSlot.dimensions,
          },
        },
        commercial: {
          advertiser: form.advertiser.trim(),
          campaignValueCents: parseBRLCents(form.campaignValueBRL),
          costModel: form.costModel,
          contractedImpressions: Number(form.contractedImpressions) || 0,
          contractedClicks: Number(form.contractedClicks) || 0,
          soldCpmCents: parseBRLCents(form.soldCpmBRL),
          soldCpcCents: parseBRLCents(form.soldCpcBRL),
          invoiceId: form.invoiceId.trim(),
          notes: form.commercialNotes.trim(),
        },
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      });
      setForm(defaultForm);
      setAssetFile(null);
      setAssetPreviewUrl("");
      await load();
      setNotice("Campanha criada. Revise o status antes de publicar no app.");
    } catch (err) {
      setError(err?.message || "Falha ao criar campanha");
    } finally {
      setSaving(false);
    }
  };

  const selectAssetFile = (file) => {
    setAssetFile(file || null);
    setError("");
    if (assetPreviewUrl && assetPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(assetPreviewUrl);
    }
    setAssetPreviewUrl(file ? URL.createObjectURL(file) : "");
  };

  const uploadAsset = async () => {
    if (!assetFile) {
      setError("Escolha uma imagem JPG, PNG ou WebP para enviar.");
      return;
    }
    if (!canMutateCampaignCenter) {
      setError(actionBlockedMessage || "Ação bloqueada para este perfil.");
      return;
    }

    setAssetUploading(true);
    setError("");
    setNotice("");
    try {
      const response = await leafAPI.uploadInAppCampaignAsset(assetFile);
      const imageUrl = response?.asset?.imageUrl || "";
      if (!imageUrl) {
        throw new Error("Upload concluído sem URL de imagem.");
      }
      setForm((prev) => ({
        ...prev,
        imageUrl,
        imageAlt: prev.imageAlt || assetFile.name,
      }));
      setAssetFile(null);
      setAssetPreviewUrl(imageUrl);
      setNotice("Imagem enviada. A URL foi preenchida na campanha.");
    } catch (err) {
      setError(err?.message || "Falha ao enviar imagem");
    } finally {
      setAssetUploading(false);
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

  const selectedSlot =
    slots.find((slot) =>
      slot.surface === csvToArray(form.surfaces)[0] &&
      slot.placement === csvToArray(form.placements)[0] &&
      slot.role === csvToArray(form.roles)[0]
    ) ||
    slots.find((slot) => slot.id === "passenger_home_banner_stack") ||
    fallbackHomeBannerSlot;
  const homeBannerSlot = slots.find((slot) => slot.id === "passenger_home_banner_stack") || fallbackHomeBannerSlot;
  const homeBannerDimensions = homeBannerSlot.dimensions || fallbackHomeBannerSlot.dimensions;
  const campaignAlerts = useMemo(() => buildCampaignAlerts(rows, commercialReport), [commercialReport, rows]);
  const surfaceOverview = useMemo(() => {
    return surfaceOptions.map((surface) => {
      const surfaceRows = rows.filter((row) => campaignUsesSurface(row, surface));
      const activeRows = surfaceRows.filter((row) => row.status === "active");
      const impressions = surfaceRows.reduce((total, row) => total + Number(row.metrics?.impressions || 0), 0);
      const clicks = surfaceRows.reduce((total, row) => total + Number(row.metrics?.clicks || 0), 0);
      return {
        surface,
        total: surfaceRows.length,
        active: activeRows.length,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
      };
    });
  }, [rows]);
  const applyCampaignSlot = (slotId) => {
    const slot = slots.find((candidate) => candidate.id === slotId) || fallbackCampaignSlots.find((candidate) => candidate.id === slotId);
    if (!slot) return;
    setForm((prev) => ({
      ...prev,
      template: slot.template || prev.template,
      roles: slot.role || prev.roles,
      surfaces: slot.surface || prev.surfaces,
      placements: slot.placement || prev.placements,
      autoRotateSeconds: slot.autoRotateSeconds || prev.autoRotateSeconds,
    }));
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

        <section className="grid grid-kpi">
          <Panel title="Valor contratado">
            <strong>{formatCurrencyCents(commercialReport?.totals?.campaignValueCents)}</strong>
            <p className="text-muted">receita potencial do inventário</p>
          </Panel>
          <Panel title="CTR">
            <strong>{formatPercent(commercialReport?.totals?.ctr)}</strong>
            <p className="text-muted">cliques / visualizações</p>
          </Panel>
          <Panel title="CPM efetivo">
            <strong>{formatCurrencyCents(commercialReport?.totals?.effectiveCpmCents)}</strong>
            <p className="text-muted">valor a cada mil visualizações</p>
          </Panel>
          <Panel title="CPC efetivo">
            <strong>{formatCurrencyCents(commercialReport?.totals?.effectiveCpcCents)}</strong>
            <p className="text-muted">valor por clique</p>
          </Panel>
        </section>

        <section className="grid">
          <Panel
            title="Alertas operacionais"
            subtitle="Validação rápida antes de publicar ou vender inventário."
          >
            <div className="metric-list">
              {campaignAlerts.map((alert) => (
                <div className="row" key={alert.id}>
                  <div className="label">
                    <span className={alert.tone}>{alert.title}</span>
                    <small>{alert.detail}</small>
                  </div>
                  <div className="value">campanhas</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Visão diária por superfície" subtitle="Onde existe inventário ativo e o que está performando.">
            <div className="metric-list">
              {surfaceOverview.map((surface) => (
                <div className="row" key={surface.surface}>
                  <div className="label">
                    <span>{surface.surface}</span>
                    <small>
                      {surface.active}/{surface.total} ativa(s) · CTR {formatPercent(surface.ctr)}
                    </small>
                  </div>
                  <div className="value">
                    {formatNumber(surface.impressions)} imp · {formatNumber(surface.clicks)} cliques
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Slots de campanha"
            subtitle="Passageiro e motorista são inventários separados. Cadastre até 3 campanhas por slot para virar carrossel."
          >
            <KeyValueGrid
              data={{
                passageiro: `${homeBannerSlot.surface} / ${homeBannerSlot.placement}`,
                motorista: `${(slots.find((slot) => slot.id === "driver_home_banner_stack") || fallbackCampaignSlots[1]).surface} / ${(slots.find((slot) => slot.id === "driver_home_banner_stack") || fallbackCampaignSlots[1]).placement}`,
                template: homeBannerSlot.template,
                itens: homeBannerSlot.maxItems,
                giro: `${homeBannerSlot.autoRotateSeconds || 6}s`,
                largura: "tela - 48dp",
                altura: `${homeBannerDimensions.heightDp}dp`,
                figma: `${homeBannerDimensions.referenceFramePx?.width} x ${homeBannerDimensions.referenceFramePx?.height}`,
                export3x: `${homeBannerDimensions.exportPx?.["@3x"]?.width} x ${homeBannerDimensions.exportPx?.["@3x"]?.height}`,
              }}
            />
            <p className="text-muted">
              Recomendação: peça 3 artes independentes no mesmo frame. O app mede impressões, cliques e troca a ordem por campanha.
            </p>
            <TechnicalDetails title="Especificação completa dos slots" data={slots} />
          </Panel>

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
                Onde aparece
                <select
                  value={selectedSlot.id}
                  onChange={(event) => applyCampaignSlot(event.target.value)}
                >
                  {slots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label || slot.id}
                    </option>
                  ))}
                </select>
                <span className="text-muted">
                  Define automaticamente role, surface e placement para passageiro ou motorista.
                </span>
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
                  placeholder="below_search_card"
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
                URL da arte
                <input
                  value={form.imageUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, imageUrl: event.target.value }))}
                  placeholder="https://.../banner-rio-01.webp"
                />
              </label>
              <label className="form-field">
                Upload da arte
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => selectAssetFile(event.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={uploadAsset}
                  disabled={!canMutateCampaignCenter || !assetFile || assetUploading}
                  title={!canMutateCampaignCenter ? actionBlockedMessage : undefined}
                >
                  {assetUploading ? "Enviando..." : "Enviar imagem"}
                </button>
                <span className="text-muted">JPG, PNG ou WebP até 4MB.</span>
              </label>
              <label className="form-field">
                Texto alternativo da arte
                <input
                  value={form.imageAlt}
                  onChange={(event) => setForm((prev) => ({ ...prev, imageAlt: event.target.value }))}
                  placeholder="Descrição curta da imagem"
                />
              </label>
              <label className="form-field">
                Modo da arte
                <select
                  value={form.displayMode}
                  onChange={(event) => setForm((prev) => ({ ...prev, displayMode: event.target.value }))}
                >
                  <option value="text_overlay">Texto do dashboard sobre a arte</option>
                  <option value="image_only">Arte completa, sem texto do app</option>
                </select>
                <span className="text-muted">
                  Use arte completa quando o texto e o CTA já estiverem dentro da imagem.
                </span>
              </label>
              <label className="form-field">
                Fundo fallback
                <input
                  value={form.backgroundColor}
                  onChange={(event) => setForm((prev) => ({ ...prev, backgroundColor: event.target.value }))}
                  placeholder="#FBFCF8"
                />
              </label>
              <label className="form-field">
                Cor do texto
                <input
                  value={form.textColor}
                  onChange={(event) => setForm((prev) => ({ ...prev, textColor: event.target.value }))}
                  placeholder="#171412"
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
                URL CTA
                <input
                  value={form.ctaUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, ctaUrl: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                Rota CTA
                <input
                  value={form.ctaRoute}
                  onChange={(event) => setForm((prev) => ({ ...prev, ctaRoute: event.target.value }))}
                  placeholder="Ex: invites, safety"
                />
              </label>
              <label className="form-field">
                Giro do carrossel em segundos
                <input
                  type="number"
                  min="3"
                  max="20"
                  value={form.autoRotateSeconds}
                  onChange={(event) => setForm((prev) => ({ ...prev, autoRotateSeconds: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Peso de rotação
                <input
                  type="number"
                  min="1"
                  value={form.rotationWeight}
                  onChange={(event) => setForm((prev) => ({ ...prev, rotationWeight: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Máx. impressões por usuário
                <input
                  type="number"
                  min="0"
                  value={form.maxImpressionsPerUser}
                  onChange={(event) => setForm((prev) => ({ ...prev, maxImpressionsPerUser: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Máx. impressões por dia
                <input
                  type="number"
                  min="0"
                  value={form.maxImpressionsPerDay}
                  onChange={(event) => setForm((prev) => ({ ...prev, maxImpressionsPerDay: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Cooldown após dispensar
                <input
                  type="number"
                  min="0"
                  value={form.dismissCooldownHours}
                  onChange={(event) => setForm((prev) => ({ ...prev, dismissCooldownHours: event.target.value }))}
                />
              </label>
              <label className="form-field">
                Anunciante / marca
                <input
                  value={form.advertiser}
                  onChange={(event) => setForm((prev) => ({ ...prev, advertiser: event.target.value }))}
                  placeholder="Leaf ou nome do parceiro"
                />
              </label>
              <label className="form-field">
                Modelo comercial
                <select value={form.costModel} onChange={(event) => setForm((prev) => ({ ...prev, costModel: event.target.value }))}>
                  {costModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Valor da campanha
                <input
                  value={form.campaignValueBRL}
                  onChange={(event) => setForm((prev) => ({ ...prev, campaignValueBRL: event.target.value }))}
                  placeholder="Ex: 1500,00"
                />
              </label>
              <label className="form-field">
                Meta de visualizações
                <input
                  type="number"
                  min="0"
                  value={form.contractedImpressions}
                  onChange={(event) => setForm((prev) => ({ ...prev, contractedImpressions: event.target.value }))}
                  placeholder="Ex: 50000"
                />
              </label>
              <label className="form-field">
                Meta de cliques
                <input
                  type="number"
                  min="0"
                  value={form.contractedClicks}
                  onChange={(event) => setForm((prev) => ({ ...prev, contractedClicks: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                CPM vendido
                <input
                  value={form.soldCpmBRL}
                  onChange={(event) => setForm((prev) => ({ ...prev, soldCpmBRL: event.target.value }))}
                  placeholder="Ex: 30,00"
                />
              </label>
              <label className="form-field">
                CPC vendido
                <input
                  value={form.soldCpcBRL}
                  onChange={(event) => setForm((prev) => ({ ...prev, soldCpcBRL: event.target.value }))}
                  placeholder="Ex: 1,20"
                />
              </label>
              <label className="form-field">
                Pedido / invoice
                <input
                  value={form.invoiceId}
                  onChange={(event) => setForm((prev) => ({ ...prev, invoiceId: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                Observações comerciais
                <input
                  value={form.commercialNotes}
                  onChange={(event) => setForm((prev) => ({ ...prev, commercialNotes: event.target.value }))}
                  placeholder="Ex: pacote Rio lançamento"
                />
              </label>
              {(assetPreviewUrl || form.imageUrl) ? (
                <div className="form-field">
                  Preview da arte
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetPreviewUrl || form.imageUrl}
                    alt={form.imageAlt || "Preview da campanha"}
                    style={{
                      width: "100%",
                      maxWidth: 345,
                      aspectRatio: "345 / 188",
                      objectFit: "cover",
                      borderRadius: 18,
                      border: "1px solid rgba(20, 30, 18, 0.14)",
                    }}
                  />
                </div>
              ) : null}
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

          <Panel
            className="panel-span-full"
            title="Relatório comercial"
            subtitle="Base para venda futura desse inventário: visualizações, cliques, CTR, CPM, CPC, valor e prazo."
          >
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Prazo</th>
                    <th>Valor</th>
                    <th>Visualizações</th>
                    <th>Cliques</th>
                    <th>CTR</th>
                    <th>CPM efetivo</th>
                    <th>CPC efetivo</th>
                    <th>Entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {(commercialReport?.rows || []).length === 0 ? (
                    <tr>
                      <td colSpan={9}>Nenhuma campanha para o relatório atual.</td>
                    </tr>
                  ) : (
                    commercialReport.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.name}</strong>
                          <br />
                          <span className="text-muted">{row.advertiser || "Leaf"} · {row.costModel}</span>
                        </td>
                        <td>
                          {formatDate(row.startAt)}
                          <br />
                          <span className="text-muted">
                            {formatDate(row.endAt)} · {row.remainingDays ?? "-"} dias restantes
                          </span>
                        </td>
                        <td>{formatCurrencyCents(row.campaignValueCents)}</td>
                        <td>
                          {formatNumber(row.impressions)}
                          <br />
                          <span className="text-muted">meta {formatNumber(row.contractedImpressions)}</span>
                        </td>
                        <td>
                          {formatNumber(row.clicks)}
                          <br />
                          <span className="text-muted">meta {formatNumber(row.contractedClicks)}</span>
                        </td>
                        <td>{formatPercent(row.ctr)}</td>
                        <td>
                          {formatCurrencyCents(row.effectiveCpmCents)}
                          <br />
                          <span className="text-muted">vendido {formatCurrencyCents(row.soldCpmCents)}</span>
                        </td>
                        <td>
                          {formatCurrencyCents(row.effectiveCpcCents)}
                          <br />
                          <span className="text-muted">vendido {formatCurrencyCents(row.soldCpcCents)}</span>
                        </td>
                        <td>
                          {row.deliveryProgress === null ? "-" : formatPercent(row.deliveryProgress)}
                          <br />
                          <span className="text-muted">
                            pacing {row.pacing === null ? "-" : formatPercent(row.pacing)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TechnicalDetails title="Payload do relatório comercial" data={commercialReport} />
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
