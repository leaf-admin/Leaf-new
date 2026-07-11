"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import KpiCard from "@/src/components/ui/KpiCard";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

function formatCurrencyFromCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return "-";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

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
  const [pendingAction, setPendingAction] = useState(null);

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

  const grantFree = async (driverId, requestedDays = freeDays, requestedUntil = "") => {
    try {
      setBusyId(driverId);
      const days = Math.max(1, Number(requestedDays) || 7);
      const until = requestedUntil || new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
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

  const applyWavePricing = async (
    driverId,
    requestedWaveId = waveDraft,
    requestedDailyFeeCents = dailyFeeDraft,
  ) => {
    try {
      setBusyId(driverId);
      await leafAPI.updateDriverSubscription(driverId, {
        waveId: requestedWaveId,
        dailyFeeCents: Number(requestedDailyFeeCents) || 0,
      });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aplicar onda/taxa");
    } finally {
      setBusyId("");
    }
  };

  const driverContext = (item) => ({
    driverId: item?.driver?.id,
    driverName: item?.driver?.name || item?.driver?.id || "Motorista sem nome",
    driverEmail: item?.driver?.email || "-",
  });

  const requestBillingStatus = (item, nextStatus) => {
    const context = driverContext(item);
    const labels = {
      active: "Ativar cobrança",
      overdue: "Marcar como vencida",
      suspended: "Suspender cobrança",
    };
    setPendingAction({
      ...context,
      kind: "billing-status",
      title: `${labels[nextStatus] || "Alterar cobrança"}?`,
      confirmLabel: labels[nextStatus] || "Confirmar alteração",
      tone: nextStatus === "suspended" ? "danger" : "warning",
      before: [
        { label: "Status de cobrança", value: item?.subscription?.billingStatus || "-" },
        { label: "Pendente", value: `R$ ${Number(item?.subscription?.pendingFee || 0).toFixed(2)}` },
      ],
      after: [
        { label: "Status de cobrança", value: nextStatus },
        { label: "Pendente", value: `R$ ${Number(item?.subscription?.pendingFee || 0).toFixed(2)}` },
      ],
      nextStatus,
      consequence: "O backend atualizará somente o status de cobrança. Valores, saldo e política financeira não serão recalculados por esta ação.",
    });
  };

  const requestWavePricing = (item) => {
    const context = driverContext(item);
    const requestedDailyFeeCents = Number(dailyFeeDraft) || 0;
    const currentDailyFeeCents = Number(
      item?.subscription?.nominalDailyFeeCents ?? item?.subscription?.dailyFeeCents ?? 0,
    );
    setPendingAction({
      ...context,
      kind: "wave-pricing",
      title: "Aplicar onda e taxa configurada?",
      confirmLabel: "Aplicar onda",
      tone: "warning",
      before: [
        { label: "Onda", value: item?.subscription?.waveId || "-" },
        { label: "Taxa diária", value: formatCurrencyFromCents(currentDailyFeeCents) },
      ],
      after: [
        { label: "Onda", value: waveDraft || "-" },
        { label: "Taxa diária", value: formatCurrencyFromCents(requestedDailyFeeCents) },
      ],
      requestedWaveId: waveDraft,
      requestedDailyFeeCents,
      consequence: "Os valores exibidos serão enviados diretamente ao backend. Nenhuma fórmula, faixa ou regra financeira será alterada no dashboard.",
    });
  };

  const requestFeeExemption = (item) => {
    const context = driverContext(item);
    const days = Math.max(1, Number(freeDays) || 7);
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    setPendingAction({
      ...context,
      kind: "fee-exemption",
      title: "Aplicar isenção temporária?",
      confirmLabel: `Isentar por ${days}d`,
      tone: "warning",
      before: [
        { label: "Isenção vigente até", value: formatDateTime(item?.subscription?.freeUntil) },
        { label: "Taxa diária atual", value: `R$ ${Number(item?.subscription?.dailyFee || 0).toFixed(2)}` },
      ],
      after: [
        { label: "Isenção até", value: formatDateTime(until) },
        { label: "Período", value: `${days} dia(s)` },
      ],
      days,
      until,
      consequence: "O período de isenção terminará na data indicada. O payload e a política de cobrança existentes serão preservados.",
    });
  };

  const confirmPendingAction = async () => {
    const action = pendingAction;
    if (!action?.driverId) return;

    if (action.kind === "billing-status") {
      await setBillingStatus(action.driverId, action.nextStatus);
    } else if (action.kind === "wave-pricing") {
      await applyWavePricing(
        action.driverId,
        action.requestedWaveId,
        action.requestedDailyFeeCents,
      );
    } else if (action.kind === "fee-exemption") {
      await grantFree(action.driverId, action.days, action.until);
    }

    setPendingAction(null);
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
              aria-label="Buscar assinaturas"
              placeholder="Buscar motorista/plano/status"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              aria-label="Filtrar assinaturas por status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Status (todos)</option>
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="suspended">suspended</option>
              <option value="cancelled">cancelled</option>
            </select>
            <select
              aria-label="Filtrar assinaturas por status do pagamento"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
            >
              <option value="all">Pagamento (todos)</option>
              <option value="paid">paid</option>
              <option value="pending">pending</option>
              <option value="overdue">overdue</option>
              <option value="failed">failed</option>
            </select>
            <button onClick={load}>Atualizar</button>
            <details className="subscription-settings-disclosure">
              <summary>Configurações de ações</summary>
              <div className="filters">
                <label>
                  Dias de isenção
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={freeDays}
                    onChange={(e) => setFreeDays(e.target.value)}
                    style={{ width: 120 }}
                  />
                </label>
                <label>
                  Onda
                  <input
                    placeholder="onda (wave_1)"
                    value={waveDraft}
                    onChange={(e) => setWaveDraft(e.target.value)}
                    style={{ width: 140 }}
                  />
                </label>
                <label>
                  Taxa diária em centavos
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={dailyFeeDraft}
                    onChange={(e) => setDailyFeeDraft(e.target.value)}
                    style={{ width: 130 }}
                    title="Taxa diária em centavos"
                  />
                </label>
              </div>
            </details>
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
            <div
              className="table-shell table-shell-tall"
              role="region"
              tabIndex={0}
              aria-label="Tabela de gestão de assinaturas"
            >
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
                            <details className="subscription-row-action-disclosure">
                              <summary>Gerenciar</summary>
                              <div className="actions-cell">
                                <button type="button" disabled={!id || isBusy} onClick={() => requestBillingStatus(item, "active")}>
                                  Ativar
                                </button>
                                <button type="button" disabled={!id || isBusy} onClick={() => requestBillingStatus(item, "overdue")}>
                                  Overdue
                                </button>
                                <button type="button" disabled={!id || isBusy} onClick={() => requestBillingStatus(item, "suspended")}>
                                  Suspender
                                </button>
                                <button type="button" disabled={!id || isBusy} onClick={() => requestWavePricing(item)}>
                                  Aplicar onda
                                </button>
                                <button type="button" disabled={!id || isBusy} onClick={() => requestFeeExemption(item)}>
                                  {`Isentar ${freeDays}d`}
                                </button>
                              </div>
                            </details>
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

        <ConfirmActionDialog
          open={Boolean(pendingAction)}
          title={pendingAction?.title}
          description="Revise o motorista, o estado atual e o resultado antes de confirmar."
          confirmLabel={pendingAction?.confirmLabel}
          tone={pendingAction?.tone}
          busy={Boolean(pendingAction?.driverId && busyId === pendingAction.driverId)}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        >
          {pendingAction ? (
            <div className="confirm-action-review">
              <p>
                <strong>Motorista:</strong> {pendingAction.driverName}
                <br />
                <span>{pendingAction.driverEmail} · {pendingAction.driverId}</span>
              </p>
              <div className="confirm-action-comparison">
                <section>
                  <h3>Antes</h3>
                  <dl>
                    {pendingAction.before.map((field) => (
                      <div key={`before-${field.label}`}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section>
                  <h3>Depois</h3>
                  <dl>
                    {pendingAction.after.map((field) => (
                      <div key={`after-${field.label}`}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              <p>{pendingAction.consequence}</p>
            </div>
          ) : null}
        </ConfirmActionDialog>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
