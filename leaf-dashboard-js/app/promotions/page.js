"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid } from "@/src/components/ui/DataViews";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";

const defaultForm = {
  name: "",
  type: "free_subscription",
  days: 7,
  maxRedemptions: "",
  criteria: "all_drivers",
  startDate: "",
  endDate: "",
};

const statusOptions = ["all", "active", "paused", "completed", "expired"];

function formatDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleString("pt-BR");
}

function promotionStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  const labels = {
    active: "Ativa",
    paused: "Pausada",
    completed: "Concluída",
    expired: "Expirada",
  };
  return labels[normalized] || normalized || "Não informado";
}

function promotionBenefitLabel(promotion) {
  const type = promotion?.benefit?.type || promotion?.type || "benefício configurado";
  const duration = promotion?.benefit?.duration ?? promotion?.days;
  const unit = promotion?.benefit?.unit || "days";
  return duration ? `${type} · ${duration} ${unit === "days" ? "dias" : unit}` : type;
}

function promotionValidityLabel(promotion) {
  return `${formatDateTime(promotion?.startDate, "Imediata")} → ${formatDateTime(promotion?.endDate, "Sem término")}`;
}

export default function PromotionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [driverId, setDriverId] = useState("");
  const [selectedPromotion, setSelectedPromotion] = useState("");
  const [busyPromotionId, setBusyPromotionId] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = statusFilter !== "all" ? { status: statusFilter } : {};
      const [listResponse, statsResponse] = await Promise.all([
        leafAPI.listPromotions(params),
        leafAPI.getPromotionStats(),
      ]);

      setRows(listResponse?.promotions || []);
      setStats(statsResponse?.stats || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar promocoes");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const canCreate = useMemo(() => form.name.trim().length > 2, [form.name]);
  const filteredRows = useMemo(() => {
    const term = searchFilter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((promo) =>
      `${promo?.id || ""} ${promo?.name || ""} ${promo?.type || ""} ${promo?.status || ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [rows, searchFilter]);

  const create = async () => {
    if (!canCreate) {
      setError("Informe um nome valido para a promocao");
      return;
    }

    try {
      setError("");
      const now = new Date();
      const startDateIso = form.startDate ? new Date(form.startDate).toISOString() : now.toISOString();
      const isFutureStart = new Date(startDateIso).getTime() > now.getTime();

      await leafAPI.createPromotion({
        name: form.name.trim(),
        description: "beneficio criado via dashboard moderno",
        type: form.type,
        status: isFutureStart ? "paused" : "active",
        benefit: {
          type: form.type,
          duration: Number(form.days) || 7,
          unit: "days",
        },
        eligibility: {
          criteria: form.criteria,
        },
        startDate: startDateIso,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      });
      setForm(defaultForm);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao criar promocao");
    }
  };

  const updatePromotionStatus = async (promotionId, status) => {
    if (!promotionId || !status) return;
    setBusyPromotionId(promotionId);
    try {
      setError("");
      await leafAPI.updatePromotion(promotionId, { status });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao atualizar status da promocao");
    } finally {
      setBusyPromotionId("");
    }
  };

  const applyToDriver = async () => {
    if (!selectedPromotion || !driverId) {
      setError("Selecione promocao e informe driverId");
      return;
    }

    try {
      setError("");
      await leafAPI.applyPromotion(selectedPromotion, driverId);
      await leafAPI.sendPushNotification({
        userIds: [driverId],
        userTypes: ["driver"],
        title: "Nova condicao especial Leaf",
        body: "Uma promocao de assinatura foi aplicada na sua conta.",
        data: { type: "promotion_applied", promotionId: selectedPromotion },
      });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aplicar promocao no motorista");
    }
  };

  const requestCreateConfirmation = () => {
    if (!canCreate) {
      setError("Informe um nome valido para a promocao");
      return;
    }

    const startsInFuture = form.startDate
      ? new Date(form.startDate).getTime() > Date.now()
      : false;
    setPendingConfirmation({
      title: "Criar esta promoção?",
      description: "Revise benefício, audiência e validade antes de criar.",
      confirmLabel: "Criar promoção",
      tone: "warning",
      details: [
        { label: "Promoção", value: form.name.trim() },
        { label: "Benefício", value: `${form.type} · ${Number(form.days) || 7} dias` },
        { label: "Validade", value: `${formatDateTime(form.startDate, "Imediata")} → ${formatDateTime(form.endDate, "Sem término")}` },
        { label: "Estado atual", value: "Não criada" },
        { label: "Novo estado", value: promotionStatusLabel(startsInFuture ? "paused" : "active") },
        { label: "Audiência", value: form.criteria },
        { label: "Limite", value: form.maxRedemptions || "Sem limite informado" },
      ],
      consequence: "Uma nova promoção será persistida com o benefício, a audiência e a validade exibidos.",
      execute: create,
    });
  };

  const requestApplyConfirmation = () => {
    if (!selectedPromotion || !driverId) {
      setError("Selecione promocao e informe driverId");
      return;
    }

    const promotion = rows.find((item) => item?.id === selectedPromotion) || { id: selectedPromotion };
    setPendingConfirmation({
      title: "Aplicar e notificar este motorista?",
      description: "Revise a aplicação individual e o push associado.",
      confirmLabel: "Aplicar e notificar",
      tone: "warning",
      details: [
        { label: "Motorista", value: driverId },
        { label: "Promoção", value: promotion?.name || promotion?.id || selectedPromotion },
        { label: "Benefício", value: promotionBenefitLabel(promotion) },
        { label: "Validade", value: promotionValidityLabel(promotion) },
        { label: "Estado atual", value: "Não aplicada por esta operação" },
        { label: "Novo estado", value: "Aplicada ao motorista" },
        { label: "Audiência", value: `Motorista específico · ${driverId}` },
      ],
      consequence:
        "O benefício será aplicado primeiro e, em seguida, o backend enviará o push existente; uma falha no push não desfaz automaticamente a aplicação.",
      execute: applyToDriver,
    });
  };

  const requestStatusConfirmation = (promotion, nextStatus) => {
    if (!promotion?.id || !nextStatus || promotion.status === nextStatus) return;

    setPendingConfirmation({
      title: `Alterar status de ${promotion.name || promotion.id}?`,
      description: "Revise a transição antes de atualizar a promoção.",
      confirmLabel:
        nextStatus === "completed"
          ? "Encerrar promoção"
          : nextStatus === "paused"
            ? "Pausar promoção"
            : "Ativar promoção",
      tone: nextStatus === "completed" ? "danger" : nextStatus === "paused" ? "warning" : "neutral",
      details: [
        { label: "Promoção", value: promotion.name || promotion.id },
        { label: "Benefício", value: promotionBenefitLabel(promotion) },
        { label: "Validade", value: promotionValidityLabel(promotion) },
        { label: "Estado atual", value: promotionStatusLabel(promotion.status) },
        { label: "Novo estado", value: promotionStatusLabel(nextStatus) },
        { label: "Audiência", value: promotion?.eligibility?.criteria || promotion?.criteria || "Não informada" },
      ],
      consequence: "Somente o status será atualizado; benefício, validade, audiência e demais regras permanecerão inalterados.",
      execute: () => updatePromotionStatus(promotion.id, nextStatus),
    });
  };

  const closeConfirmation = () => {
    if (!confirmationBusy && !busyPromotionId) setPendingConfirmation(null);
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation?.execute || confirmationBusy || busyPromotionId) return;

    const action = pendingConfirmation;
    try {
      setConfirmationBusy(true);
      await action.execute();
    } finally {
      setConfirmationBusy(false);
      setPendingConfirmation((current) => (current === action ? null : current));
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Promoções</h1>
            <p>Benefícios, aplicações manuais e controle de campanhas ativas.</p>
          </div>
          <div className="filters">
            <input
              aria-label="Buscar promoções"
              placeholder="Buscar por id, nome, tipo ou status"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <select
              aria-label="Filtrar promoções por status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button onClick={load}>Atualizar</button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando promocoes..." /> : null}

        <section className="grid">
          <Panel title="Resumo">
            <KeyValueGrid
              data={{
                total: stats?.total ?? rows.length,
                active: stats?.active ?? 0,
                paused: stats?.paused ?? 0,
                completed: stats?.completed ?? 0,
                expired: stats?.expired ?? 0,
                totalRedemptions: stats?.totalRedemptions ?? 0,
              }}
              labels={{
                total: "Total",
                active: "Ativas",
                paused: "Pausadas",
                completed: "Concluídas",
                expired: "Expiradas",
                totalRedemptions: "Resgates",
              }}
            />
          </Panel>

          <Panel title="Ações rápidas" subtitle="Criação e aplicação manual ficam recolhidas para não poluir a operação diária.">
            <details className="technical-details promotion-create-disclosure">
              <summary>Criar promoção</summary>
              <div className="technical-details-inner">
                <div className="form-grid">
                  <label className="form-field">
                    Nome
                    <input
                      placeholder="Nome da promoção"
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </label>
                  <label className="form-field">
                    Tipo
                    <select
                      value={form.type}
                      onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                    >
                      <option value="free_subscription">Assinatura grátis</option>
                      <option value="trial_extension">Extensão de trial</option>
                      <option value="discount">Desconto</option>
                    </select>
                  </label>
                  <label className="form-field">
                    Critério
                    <select
                      value={form.criteria}
                      onChange={(e) => setForm((prev) => ({ ...prev, criteria: e.target.value }))}
                    >
                      <option value="all_drivers">Todos os motoristas</option>
                      <option value="first_n_drivers">Primeiros N motoristas</option>
                      <option value="specific_drivers">Lista específica</option>
                    </select>
                  </label>
                  <label className="form-field">
                    Duração
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={form.days}
                      onChange={(e) => setForm((prev) => ({ ...prev, days: e.target.value }))}
                      placeholder="Dias"
                    />
                  </label>
                  <label className="form-field">
                    Limite
                    <input
                      type="number"
                      min="1"
                      value={form.maxRedemptions}
                      onChange={(e) => setForm((prev) => ({ ...prev, maxRedemptions: e.target.value }))}
                      placeholder="Resgates"
                    />
                  </label>
                  <label className="form-field">
                    Início
                    <input
                      type="datetime-local"
                      value={form.startDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    />
                  </label>
                  <label className="form-field">
                    Fim
                    <input
                      type="datetime-local"
                      value={form.endDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    />
                  </label>
                  <button type="button" onClick={requestCreateConfirmation} disabled={!canCreate || confirmationBusy}>
                    Criar promoção
                  </button>
                </div>
              </div>
            </details>

            <details className="technical-details promotion-application-disclosure">
              <summary>Aplicar manualmente e enviar push</summary>
              <div className="technical-details-inner">
                <div className="form-grid">
                  <label className="form-field">
                    Promoção
                    <select value={selectedPromotion} onChange={(e) => setSelectedPromotion(e.target.value)}>
                      <option value="">Selecione promoção</option>
                      {filteredRows.map((promo) => (
                        <option key={promo.id} value={promo.id}>
                          {promo.name || promo.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    Motorista
                    <input
                      placeholder="driverId"
                      value={driverId}
                      onChange={(e) => setDriverId(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={requestApplyConfirmation}
                    disabled={!selectedPromotion || !driverId || confirmationBusy}
                  >
                    Aplicar e notificar
                  </button>
                </div>
              </div>
            </details>
          </Panel>

          <Panel className="panel-span-full" title="Operação de promoções">
            <div
              className="table-shell"
              role="region"
              tabIndex={0}
              aria-label="Operação de promoções"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Inicio</th>
                    <th>Fim</th>
                    <th>Resgates</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Nenhuma promoção encontrada para os filtros atuais.</td>
                    </tr>
                  ) : (
                    filteredRows.map((promo, idx) => {
                      const isBusy = busyPromotionId === promo.id;
                      return (
                        <tr key={promo.id || `promo-${idx}`}>
                          <td>{promo.id || "-"}</td>
                          <td>{promo.name || "-"}</td>
                          <td>{promo.type || "-"}</td>
                          <td>{promo.status || "-"}</td>
                          <td>{formatDateTime(promo.startDate)}</td>
                          <td>{formatDateTime(promo.endDate)}</td>
                          <td>
                            {promo.currentRedemptions ?? 0}
                            {promo.maxRedemptions ? ` / ${promo.maxRedemptions}` : ""}
                          </td>
                          <td>
                            <div className="actions-cell">
                              <select
                                aria-label={`Alterar status de ${promo.name || promo.id}`}
                                value=""
                                disabled={isBusy || confirmationBusy}
                                onChange={(event) => {
                                  const nextStatus = event.target.value;
                                  if (nextStatus) requestStatusConfirmation(promo, nextStatus);
                                }}
                              >
                                <option value="">Alterar status…</option>
                                <option value="active" disabled={promo.status === "active"}>Iniciar/Retomar</option>
                                <option value="paused" disabled={promo.status === "paused"}>Pausar</option>
                                <option value="completed" disabled={promo.status === "completed"}>Encerrar</option>
                              </select>
                            </div>
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
        <ConfirmActionDialog
          open={Boolean(pendingConfirmation)}
          title={pendingConfirmation?.title}
          description={pendingConfirmation?.description}
          confirmLabel={pendingConfirmation?.confirmLabel}
          tone={pendingConfirmation?.tone}
          busy={confirmationBusy || Boolean(busyPromotionId)}
          onConfirm={confirmPendingAction}
          onCancel={closeConfirmation}
        >
          <div className="confirm-dialog-context">
            {(pendingConfirmation?.details || []).map((detail) => (
              <p key={detail.label} className="confirm-dialog-context-row">
                <strong>{detail.label}:</strong> {detail.value}
              </p>
            ))}
            {pendingConfirmation?.consequence ? (
              <p className="confirm-dialog-consequence">
                <strong>Consequência:</strong> {pendingConfirmation.consequence}
              </p>
            ) : null}
          </div>
        </ConfirmActionDialog>
      </main>
    </ProtectedRoute>
  );
}
