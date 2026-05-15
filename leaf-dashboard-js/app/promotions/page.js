"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid } from "@/src/components/ui/DataViews";

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
              placeholder="Buscar por id, nome, tipo ou status"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
            <details className="technical-details">
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
                  <button onClick={create} disabled={!canCreate}>
                    Criar promoção
                  </button>
                </div>
              </div>
            </details>

            <details className="technical-details">
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
                  <button onClick={applyToDriver}>Aplicar e notificar</button>
                </div>
              </div>
            </details>
          </Panel>

          <Panel className="panel-span-full" title="Operação de promoções">
            <div className="table-shell">
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
                    <th>Acoes</th>
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
                          <td>{promo.startDate ? new Date(promo.startDate).toLocaleString() : "-"}</td>
                          <td>{promo.endDate ? new Date(promo.endDate).toLocaleString() : "-"}</td>
                          <td>
                            {promo.currentRedemptions ?? 0}
                            {promo.maxRedemptions ? ` / ${promo.maxRedemptions}` : ""}
                          </td>
                          <td>
                            <div className="actions-cell">
                              <button
                                disabled={isBusy || promo.status === "active"}
                                onClick={() => updatePromotionStatus(promo.id, "active")}
                              >
                                Iniciar/Retomar
                              </button>
                              <button
                                disabled={isBusy || promo.status === "paused"}
                                onClick={() => updatePromotionStatus(promo.id, "paused")}
                              >
                                Pausar
                              </button>
                              <button
                                disabled={isBusy || promo.status === "completed"}
                                onClick={() => updatePromotionStatus(promo.id, "completed")}
                              >
                                Encerrar
                              </button>
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
      </main>
    </ProtectedRoute>
  );
}
