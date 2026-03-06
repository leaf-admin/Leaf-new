"use client";

import { useEffect, useState } from "react";
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
      await leafAPI.extendDriverFreePeriod(driverId, {
        type: "promotion",
        days: Number(freeDays) || 7,
        reason: "beneficio manual via dashboard",
      });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao estender periodo gratis");
    } finally {
      setBusyId("");
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Assinaturas</h1>
          <div className="filters">
            <input
              type="number"
              min="1"
              max="90"
              value={freeDays}
              onChange={(e) => setFreeDays(e.target.value)}
              style={{ width: 120 }}
            />
            <button onClick={load}>Atualizar</button>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando assinaturas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Total" value={summary?.total || rows.length || 0} />
          <KpiCard title="Ativas" value={summary?.active || 0} tone="positive" />
          <KpiCard title="Pendentes" value={summary?.pending || 0} tone="warning" />
          <KpiCard title="Overdue" value={summary?.overdue || 0} tone="danger" />
        </section>

        <section className="grid">
          <Panel title="Gestao de Assinaturas">
            <table className="table">
              <thead>
                <tr>
                  <th>Motorista</th>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Pagamento</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, idx) => {
                  const id = item?.driver?.id;
                  const isBusy = busyId === id;
                  return (
                    <tr key={id || `sub-${idx}`}>
                      <td>{item?.driver?.name || id || "-"}</td>
                      <td>{item?.subscription?.planType || "plus"}</td>
                      <td>{item?.subscription?.status || "-"}</td>
                      <td>{item?.currentPeriod?.paymentStatus || "-"}</td>
                      <td>
                        <div className="filters">
                          <button disabled={!id || isBusy} onClick={() => setBillingStatus(id, "active")}>Ativar</button>
                          <button disabled={!id || isBusy} onClick={() => setBillingStatus(id, "overdue")}>Overdue</button>
                          <button disabled={!id || isBusy} onClick={() => setBillingStatus(id, "suspended")}>Suspender</button>
                          <button disabled={!id || isBusy} onClick={() => grantFree(id)}>
                            {`Gratis ${freeDays}d`}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
