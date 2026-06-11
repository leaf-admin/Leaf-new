"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import KpiCard from "@/src/components/ui/KpiCard";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

export default function SubscriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [freeDays, setFreeDays] = useState(7);
  const [waveDraft, setWaveDraft] = useState("wave_1");
  const [dailyFeeDraft, setDailyFeeDraft] = useState(1490);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getSubscriptionsDrivers({ page: 1, limit: 200 });
      setRows(response?.subscriptions || []);
      setSummary(response?.summary || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar assinaturas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setBillingStatus = async (driverId, billing_status) => {
    try {
      setBusyId(driverId);
      await leafAPI.updateDriverSubscription(driverId, { billing_status });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao atualizar assinatura");
    } finally {
      setBusyId("");
    }
  };

  const grantFree = async (driverId) => {
    try {
      setBusyId(driverId);
      const days = Math.max(1, Number(freeDays) || 7);
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await leafAPI.updateDriverSubscription(driverId, {
        feeExemptUntil: until,
        isFeeExempt: false,
      });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao isentar taxa diaria");
    } finally {
      setBusyId("");
    }
  };

  const applyWavePricing = async (driverId) => {
    try {
      setBusyId(driverId);
      await leafAPI.updateDriverSubscription(driverId, {
        waveId: waveDraft,
        dailyFeeCents: Number(dailyFeeDraft) || 0,
      });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aplicar onda/taxa");
    } finally {
      setBusyId("");
    }
  };

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((item) => {
      const subscriptionStatus = String(item?.subscription?.status || "").toLowerCase();
      const paymentStatus = String(item?.currentPeriod?.paymentStatus || "").toLowerCase();

      if (statusFilter !== "all" && subscriptionStatus !== statusFilter) return false;
      if (paymentFilter !== "all" && paymentStatus !== paymentFilter) return false;

      if (!term) return true;
      const haystack = [
        item?.driver?.id,
        item?.driver?.name,
        item?.driver?.email,
        item?.subscription?.planType,
        item?.subscription?.waveId,
        subscriptionStatus,
        paymentStatus,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(term);
    });
  }, [rows, searchTerm, statusFilter, paymentFilter]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Assinaturas</h1>
          <div className="filters">
            <input
              placeholder="Buscar motorista/plano/status"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Status (todos)</option>
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="suspended">suspended</option>
              <option value="cancelled">cancelled</option>
            </select>
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              <option value="all">Pagamento (todos)</option>
              <option value="paid">paid</option>
              <option value="pending">pending</option>
              <option value="overdue">overdue</option>
              <option value="failed">failed</option>
            </select>
            <input
              type="number"
              min="1"
              max="90"
              value={freeDays}
              onChange={(e) => setFreeDays(e.target.value)}
              style={{ width: 120 }}
            />
            <input
              placeholder="onda (wave_1)"
              value={waveDraft}
              onChange={(e) => setWaveDraft(e.target.value)}
              style={{ width: 140 }}
            />
            <input
              type="number"
              min="0"
              step="10"
              value={dailyFeeDraft}
              onChange={(e) => setDailyFeeDraft(e.target.value)}
              style={{ width: 130 }}
              title="Taxa diária em centavos"
            />
            <button onClick={load}>Atualizar</button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando assinaturas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Total" value={summary?.total || rows.length || 0} />
          <KpiCard title="Visíveis" value={filteredRows.length || 0} />
          <KpiCard title="Ativas" value={summary?.active || 0} tone="positive" />
          <KpiCard title="Pendentes" value={summary?.pending || 0} tone="warning" />
          <KpiCard title="Overdue" value={summary?.overdue || 0} tone="danger" />
        </section>

        <section className="grid">
          <Panel title="Gestao de Assinaturas" subtitle="Lista filtrável com ações rápidas de cobrança e benefício.">
            <div className="table-shell table-shell-tall">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Plano</th>
                    <th>Diária</th>
                    <th>Pendente</th>
                    <th>Status</th>
                    <th>Pagamento</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Nenhuma assinatura encontrada para os filtros atuais.</td>
                    </tr>
                  ) : (
                    filteredRows.map((item, idx) => {
                      const id = item?.driver?.id;
                      const isBusy = busyId === id;
                      return (
                        <tr key={id || `sub-${idx}`}>
                          <td>
                            <strong>{item?.driver?.name || id || "-"}</strong>
                            <span className="table-muted">{item?.driver?.email || "-"}</span>
                          </td>
                          <td>{item?.subscription?.planType || "plus"}</td>
                          <td>
                            {`R$ ${Number(item?.subscription?.dailyFee || 0).toFixed(2)}`}
                            <span className="table-muted">{item?.subscription?.waveId || "-"}</span>
                          </td>
                          <td>{`R$ ${Number(item?.subscription?.pendingFee || 0).toFixed(2)}`}</td>
                          <td>{item?.subscription?.status || "-"}</td>
                          <td>{item?.currentPeriod?.paymentStatus || "-"}</td>
                          <td>
                            <div className="actions-cell">
                              <button disabled={!id || isBusy} onClick={() => setBillingStatus(id, "active")}>Ativar</button>
                              <button disabled={!id || isBusy} onClick={() => setBillingStatus(id, "overdue")}>Overdue</button>
                              <button disabled={!id || isBusy} onClick={() => setBillingStatus(id, "suspended")}>Suspender</button>
                              <button disabled={!id || isBusy} onClick={() => applyWavePricing(id)}>
                                Aplicar onda
                              </button>
                              <button disabled={!id || isBusy} onClick={() => grantFree(id)}>
                                {`Isentar ${freeDays}d`}
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
