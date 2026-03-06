"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

const defaultForm = {
  name: "",
  type: "free_subscription",
  days: 7,
  maxRedemptions: "",
  criteria: "all_drivers",
};

export default function PromotionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [driverId, setDriverId] = useState("");
  const [selectedPromotion, setSelectedPromotion] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.listPromotions({ status: "active" });
      setRows(response?.promotions || []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar promoções");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    try {
      setError("");
      await leafAPI.createPromotion({
        name: form.name,
        description: "beneficio criado via dashboard moderno",
        type: form.type,
        benefit: {
          type: "free_subscription",
          duration: Number(form.days) || 7,
          unit: "days",
        },
        eligibility: {
          criteria: form.criteria,
        },
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      });
      setForm(defaultForm);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao criar promoção");
    }
  };

  const applyToDriver = async () => {
    if (!selectedPromotion || !driverId) {
      setError("Selecione promoção e informe driverId");
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
      setError(err?.message || "Falha ao aplicar promoção no motorista");
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Promocoes</h1>
          <div className="filters">
            <button onClick={load}>Atualizar</button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando promoções..." /> : null}

        <section className="grid">
          <Panel title="Criar Promocao">
            <div className="filters">
              <input
                placeholder="Nome da promoção"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <select
                value={form.criteria}
                onChange={(e) => setForm((prev) => ({ ...prev, criteria: e.target.value }))}
              >
                <option value="all_drivers">Todos os motoristas</option>
                <option value="first_n_drivers">Primeiros N motoristas</option>
              </select>
              <input
                type="number"
                min="1"
                max="365"
                value={form.days}
                onChange={(e) => setForm((prev) => ({ ...prev, days: e.target.value }))}
                placeholder="Dias grátis"
              />
              <input
                type="number"
                min="1"
                value={form.maxRedemptions}
                onChange={(e) => setForm((prev) => ({ ...prev, maxRedemptions: e.target.value }))}
                placeholder="Limite de resgates"
              />
              <button onClick={create}>Criar promoção</button>
            </div>
          </Panel>

          <Panel title="Aplicar Manualmente + Push">
            <div className="filters">
              <select value={selectedPromotion} onChange={(e) => setSelectedPromotion(e.target.value)}>
                <option value="">Selecione promoção</option>
                {rows.map((promo) => (
                  <option key={promo.id} value={promo.id}>{promo.name || promo.id}</option>
                ))}
              </select>
              <input
                placeholder="driverId"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              />
              <button onClick={applyToDriver}>Aplicar e notificar</button>
            </div>
          </Panel>

          <Panel title="Promoções Ativas">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Resgates</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((promo, idx) => (
                  <tr key={promo.id || `promo-${idx}`}>
                    <td>{promo.id || "-"}</td>
                    <td>{promo.name || "-"}</td>
                    <td>{promo.type || "-"}</td>
                    <td>{promo.status || "-"}</td>
                    <td>{promo.currentRedemptions ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
