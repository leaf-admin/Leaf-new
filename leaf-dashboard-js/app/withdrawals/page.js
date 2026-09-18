"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { EmptyState, ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import useConfirmAction from "@/src/hooks/useConfirmAction";

const STATUS_LABELS = {
  pending: "Aguardando processamento",
  ledger_pending: "Aguardando ledger",
  processing: "Em processamento",
  processed: "Processado",
  processed_ledger_pending: "Pix pago; ledger pendente",
};

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (Number.isFinite(Number(value?._seconds))) {
    return new Date(Number(value._seconds) * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("pt-BR") : "-";
}

function formatMoneyCents(value, fallbackReais = null) {
  const cents = Number(value);
  const amount = Number.isFinite(cents)
    ? cents / 100
    : Number(fallbackReais);
  if (!Number.isFinite(amount)) return "-";
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "processed") return "status-ok";
  if (normalized === "processing") return "status-warn";
  if (normalized.includes("ledger")) return "status-bad";
  return "status-warn";
}

function maskPixKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "-";
  if (normalized.includes("@")) {
    const [name, domain] = normalized.split("@", 2);
    return `${name.slice(0, 2)}***@${domain}`;
  }
  if (normalized.length <= 6) return `${normalized.slice(0, 2)}***`;
  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
}

export default function WithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [disabledMessage, setDisabledMessage] = useState("");
  const { requestConfirmation, confirmationDialog, confirming } = useConfirmAction();

  const loadWithdrawals = async () => {
    try {
      setLoading(true);
      setError("");
      setDisabledMessage("");
      const response = await leafAPI.listPendingWithdrawals(100);
      setWithdrawals(Array.isArray(response?.withdrawals) ? response.withdrawals : []);
    } catch (err) {
      const code = String(err?.payload?.code || err?.payload?.errorCode || "").toUpperCase();
      if (code.includes("DISABLED") || code.includes("FEATURE")) {
        setDisabledMessage(err?.message || "Saques estão desativados no perfil atual.");
        setWithdrawals([]);
      } else {
        setError(err?.message || "Falha ao carregar saques pendentes");
      }
    } finally {
      setLoading(false);
    }
  };

  const processWithdrawal = async (withdrawal) => {
    try {
      setSuccess("");
      setError("");
      await leafAPI.processDriverWithdrawal(withdrawal.id);
      setSuccess(`Saque ${withdrawal.id} enviado para processamento Pix Out.`);
      await loadWithdrawals();
    } catch (err) {
      setError(err?.message || "Falha ao processar saque");
    }
  };

  const requestProcess = (withdrawal) => {
    requestConfirmation({
      title: "Processar saque via Pix Out?",
      description: "O backend vai validar o ledger e enviar o valor para a chave Pix registrada.",
      detail: `${formatMoneyCents(withdrawal.amountCents, withdrawal.amountInReais)} · ${maskPixKey(withdrawal.pixKey)} · motorista ${withdrawal.driverId || "-"}`,
      confirmLabel: "Processar saque",
      tone: "danger",
      task: () => processWithdrawal(withdrawal),
    });
  };

  useEffect(() => {
    loadWithdrawals();
  }, []);

  const totals = useMemo(() => ({
    pending: withdrawals.filter((item) => ["pending", "ledger_pending"].includes(String(item?.status || ""))).length,
    ledgerPending: withdrawals.filter((item) => String(item?.status || "") === "ledger_pending").length,
    amountCents: withdrawals.reduce((sum, item) => sum + (Number(item?.amountCents) || 0), 0),
  }), [withdrawals]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Saques</h1>
            <p>Revise solicitações, confirme o ledger e processe o Pix Out de forma auditável.</p>
          </div>
          <div className="filters">
            <button type="button" onClick={loadWithdrawals} disabled={loading || confirming}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>
        <AppNav />

        <section className="grid grid-kpi">
          <KpiCard title="Pendentes" value={totals.pending} subtitle="aguardando operador" tone={totals.pending > 0 ? "warning" : "positive"} />
          <KpiCard title="Valor solicitado" value={formatMoneyCents(totals.amountCents)} subtitle="amostra carregada" />
          <KpiCard title="Ledger pendente" value={totals.ledgerPending} subtitle="não enviar até reparar" tone={totals.ledgerPending > 0 ? "danger" : "positive"} />
          <KpiCard title="Regra de tarifa" value="R$ 1 / R$ 0" subtitle="abaixo / a partir de R$ 500" />
        </section>

        {disabledMessage ? (
          <Panel title="Saque desativado" subtitle="O endpoint permanece protegido pelo perfil de lançamento atual.">
            <p>{disabledMessage}</p>
            <p className="table-muted">Ative o recurso no ambiente backend depois de validar Woovi Pix Out, credenciais e o procedimento operacional.</p>
          </Panel>
        ) : null}

        {loading ? <LoadingState message="Carregando solicitações de saque..." /> : null}
        {!loading && !disabledMessage && withdrawals.length === 0 ? (
          <EmptyState message="Nenhum saque pendente para processamento." />
        ) : null}

        {!disabledMessage && withdrawals.length > 0 ? (
          <Panel title="Fila de processamento" subtitle="As chaves Pix são mascaradas. O processamento usa o operador autenticado no backend.">
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Solicitado</th>
                    <th>Motorista</th>
                    <th>Valor</th>
                    <th>Tarifas</th>
                    <th>Pix</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((withdrawal) => {
                    const status = String(withdrawal?.status || "pending").toLowerCase();
                    const processable = ["pending", "ledger_pending"].includes(status);
                    return (
                      <tr key={withdrawal.id}>
                        <td>{formatDate(withdrawal.createdAt)}</td>
                        <td>
                          <strong>{withdrawal.driverId || "-"}</strong>
                          <span className="table-muted">{withdrawal.requestId || withdrawal.id}</span>
                        </td>
                        <td>
                          <strong>{formatMoneyCents(withdrawal.amountCents, withdrawal.amountInReais)}</strong>
                          <span className="table-muted">débito {formatMoneyCents(withdrawal.totalDebitCents, withdrawal.totalDebitInReais)}</span>
                        </td>
                        <td>
                          <span className="table-muted">saque {formatMoneyCents(withdrawal.feeCents, withdrawal.feeInReais)}</span>
                          <span className="table-muted">assinatura {formatMoneyCents(withdrawal.subscriptionSettlementCents, withdrawal.subscriptionSettlementInReais)}</span>
                        </td>
                        <td>{maskPixKey(withdrawal.pixKey)}</td>
                        <td><span className={statusClass(status)}>{STATUS_LABELS[status] || status}</span></td>
                        <td>
                          {processable ? (
                            <button type="button" onClick={() => requestProcess(withdrawal)} disabled={confirming}>
                              Processar
                            </button>
                          ) : <span className="table-muted">Sem ação</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}

        {success ? <p className="success-text">{success}</p> : null}
        <ErrorText message={error} />
        {confirmationDialog}
      </main>
    </ProtectedRoute>
  );
}
