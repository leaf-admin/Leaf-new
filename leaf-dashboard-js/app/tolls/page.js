"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

const directionOptions = [
  ["bidirectional", "bidirecional"],
  ["north", "norte"],
  ["south", "sul"],
  ["east", "leste"],
  ["west", "oeste"],
];

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function emptyCatalog() {
  return {
    enabled: true,
    version: 1,
    currency: "BRL",
    toleranceKm: 2,
    source: "loading",
    plazas: [],
  };
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function toNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureFees(plaza) {
  return {
    car: {
      weekday: Number(plaza?.fees?.car?.weekday || 0),
      weekend: Number(plaza?.fees?.car?.weekend || plaza?.fees?.car?.weekday || 0),
    },
    truck: {
      weekday: Number(plaza?.fees?.truck?.weekday || 0),
      weekend: Number(plaza?.fees?.truck?.weekend || plaza?.fees?.truck?.weekday || 0),
    },
  };
}

export default function TollsPage() {
  const [catalog, setCatalog] = useState(emptyCatalog);
  const [draft, setDraft] = useState(emptyCatalog);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeCount = useMemo(
    () => draft.plazas.filter((plaza) => plaza.active !== false).length,
    [draft.plazas],
  );
  const linhaAmarela = useMemo(
    () => draft.plazas.find((plaza) => plaza.id === "p09_linha_amarela"),
    [draft.plazas],
  );

  const loadCatalog = async ({ refresh = false } = {}) => {
    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.getTollCatalog({ refresh });
      const next = response?.catalog || emptyCatalog();
      setCatalog(next);
      setDraft(clone(next));
    } catch (err) {
      setError(err?.message || "Falha ao carregar catálogo de pedágios");
    } finally {
      setLoading(false);
    }
  };

  const updatePlaza = (index, patch) => {
    setDraft((current) => ({
      ...current,
      plazas: current.plazas.map((plaza, plazaIndex) => (
        plazaIndex === index ? { ...plaza, ...patch } : plaza
      )),
    }));
  };

  const updateFee = (index, vehicle, period, value) => {
    setDraft((current) => ({
      ...current,
      plazas: current.plazas.map((plaza, plazaIndex) => {
        if (plazaIndex !== index) return plaza;
        const fees = ensureFees(plaza);
        return {
          ...plaza,
          fees: {
            ...fees,
            [vehicle]: {
              ...fees[vehicle],
              [period]: toNumber(value),
            },
          },
        };
      }),
    }));
  };

  const saveCatalog = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const response = await leafAPI.updateTollCatalog(draft);
      const next = response?.catalog || draft;
      setCatalog(next);
      setDraft(clone(next));
      setSuccess("Catálogo publicado. Novas cotações passam a usar os valores atualizados após o cache curto do backend.");
    } catch (err) {
      setError(err?.message || "Falha ao salvar catálogo de pedágios");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadCatalog({ refresh: true });
  }, []);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Pedágios</h1>
            <p>Atualize tarifas e variantes usadas pelo cálculo backend de cotação, pagamento e recibo.</p>
          </div>
          <div className="filters">
            <button type="button" onClick={() => loadCatalog({ refresh: true })} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>
        <AppNav />

        <section className="grid grid-kpi">
          <KpiCard title="Praças ativas" value={`${activeCount}/${draft.plazas.length}`} tone={activeCount > 0 ? "positive" : "danger"} />
          <KpiCard title="Linha Amarela" value={formatMoney(linhaAmarela?.fees?.car?.weekday || 0)} subtitle="carro em dia útil" />
          <KpiCard title="Versão" value={draft.version || "-"} subtitle={draft.source || "catalog"} />
          <KpiCard title="Tolerância" value={`${draft.toleranceKm || 0}km`} subtitle="detecção por geometria" />
        </section>

        {loading ? <LoadingState message="Carregando catálogo de pedágios..." /> : null}

        <form onSubmit={saveCatalog} className="section-stack">
          <Panel
            title="Política de detecção"
            subtitle={`Última atualização: ${formatDate(catalog.updatedAt)} · operador: ${catalog.updatedByEmail || catalog.updatedBy || "-"}`}
            className="panel-span-full"
          >
            <div className="form-grid">
              <label className="form-field">
                Status
                <select
                  value={draft.enabled === false ? "disabled" : "enabled"}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.value === "enabled" })}
                >
                  <option value="enabled">ativo</option>
                  <option value="disabled">desativado</option>
                </select>
              </label>
              <label className="form-field">
                Tolerância em km
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={draft.toleranceKm}
                  onChange={(event) => setDraft({ ...draft, toleranceKm: toNumber(event.target.value, 2) })}
                />
              </label>
              <label className="form-field">
                Moeda
                <input value={draft.currency || "BRL"} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} />
              </label>
            </div>
          </Panel>

          <Panel
            title="Praças e variantes"
            subtitle="Tarifas em reais. Dia útil e fim de semana são avaliados no momento da cotação."
            className="panel-span-full"
          >
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Praça</th>
                    <th>Operação</th>
                    <th>Coordenadas</th>
                    <th>Carro</th>
                    <th>Caminhão</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.plazas.map((plaza, index) => {
                    const fees = ensureFees(plaza);
                    return (
                      <tr key={plaza.id}>
                        <td>
                          <strong>{plaza.name}</strong>
                          <span className="table-muted">{plaza.id}</span>
                          <input
                            value={plaza.road || ""}
                            aria-label={`Rodovia ${plaza.name}`}
                            onChange={(event) => updatePlaza(index, { road: event.target.value })}
                          />
                        </td>
                        <td>
                          <div className="form-grid form-grid-tight">
                            <label className="form-field">
                              Status
                              <select
                                value={plaza.active === false ? "inactive" : "active"}
                                onChange={(event) => updatePlaza(index, { active: event.target.value === "active" })}
                              >
                                <option value="active">ativa</option>
                                <option value="inactive">inativa</option>
                              </select>
                            </label>
                            <label className="form-field">
                              Sentido
                              <select
                                value={plaza.direction || "bidirectional"}
                                onChange={(event) => updatePlaza(index, { direction: event.target.value })}
                              >
                                {directionOptions.map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </td>
                        <td>
                          <div className="form-grid form-grid-tight">
                            <label className="form-field">
                              Latitude
                              <input
                                type="number"
                                step="0.000001"
                                value={plaza.lat}
                                onChange={(event) => updatePlaza(index, { lat: toNumber(event.target.value, plaza.lat) })}
                              />
                            </label>
                            <label className="form-field">
                              Longitude
                              <input
                                type="number"
                                step="0.000001"
                                value={plaza.lng}
                                onChange={(event) => updatePlaza(index, { lng: toNumber(event.target.value, plaza.lng) })}
                              />
                            </label>
                          </div>
                        </td>
                        <td>
                          <div className="form-grid form-grid-tight">
                            <label className="form-field">
                              Dia útil
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={fees.car.weekday}
                                onChange={(event) => updateFee(index, "car", "weekday", event.target.value)}
                              />
                            </label>
                            <label className="form-field">
                              Fim de semana
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={fees.car.weekend}
                                onChange={(event) => updateFee(index, "car", "weekend", event.target.value)}
                              />
                            </label>
                          </div>
                        </td>
                        <td>
                          <div className="form-grid form-grid-tight">
                            <label className="form-field">
                              Dia útil
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={fees.truck.weekday}
                                onChange={(event) => updateFee(index, "truck", "weekday", event.target.value)}
                              />
                            </label>
                            <label className="form-field">
                              Fim de semana
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={fees.truck.weekend}
                                onChange={(event) => updateFee(index, "truck", "weekend", event.target.value)}
                              />
                            </label>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="row-actions">
              <button type="submit" disabled={saving || loading}>
                {saving ? "Publicando..." : "Publicar catálogo"}
              </button>
              <button type="button" className="button-secondary" onClick={() => setDraft(clone(catalog))} disabled={saving}>
                Desfazer alterações
              </button>
            </div>
          </Panel>
        </form>

        {success ? <p className="success-text">{success}</p> : null}
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
