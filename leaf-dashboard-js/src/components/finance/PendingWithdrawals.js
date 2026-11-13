"use client";

// Saques dos motoristas esperando conferência. A regra de produto é aprovar depois
// de conferir: o Pix só sai quando um admin clica em Processar. O backend refaz
// todas as travas (status, ledger postado, um processamento por vez).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Panel from "@/src/components/ui/Panel";
import { EmptyState, ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";
import { refreshOpsPending } from "@/src/services/ops-pending-store";

function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function since(value) {
  if (!value) return "-";
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `há ${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dias`;
}

function shortId(value) {
  const id = String(value || "");
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default function PendingWithdrawals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [results, setResults] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getPendingWithdrawals(50);
      setItems(Array.isArray(response?.withdrawals) ? response.withdrawals : []);
    } catch (loadError) {
      setError(loadError?.message || "Não foi possível carregar os saques.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function process(item) {
    const confirmed = window.confirm(
      `Enviar ${brl(item.amountCents)} por Pix para a chave ${item.pixKeyMasked || "do motorista"}?\n\n` +
        `Motorista ${shortId(item.driverId)} · saldo debitado ${brl(item.totalDebitCents)}.\nIsso não pode ser desfeito.`
    );
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      const response = await leafAPI.processWithdrawal(item.id);
      const ledgerPending = response?.status === "processed_ledger_pending";
      setResults((current) => ({
        ...current,
        [item.id]: {
          tone: ledgerPending ? "warn" : "ok",
          text: ledgerPending ? "Pix enviado; ledger vai reconciliar" : "Pix enviado",
        },
      }));
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (processError) {
      setResults((current) => ({
        ...current,
        [item.id]: { tone: "bad", text: processError?.message || "Falha ao processar" },
      }));
      load();
    } finally {
      setBusyId("");
      refreshOpsPending();
    }
  }

  const sentRows = Object.entries(results).filter(([id]) => !items.some((row) => row.id === id));

  return (
    <Panel
      title="Saques para processar"
      subtitle="O Pix só sai depois do clique. Confira motorista, valor e chave antes."
      className="panel-span-full"
      actions={
        <button type="button" className="button-secondary" onClick={load} disabled={loading || Boolean(busyId)}>
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      }
    >
      <div id="saques">
      {error ? <ErrorText message={error} /> : null}
      {loading && items.length === 0 ? <LoadingState message="Carregando saques..." /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState message="Nenhum saque esperando." /> : null}
      {items.length > 0 ? (
        <div className="table-shell">
          <table className="table table-compact recon-withdrawal-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Motorista</th>
                <th>Chave Pix</th>
                <th className="num">Valor do Pix</th>
                <th className="num">Debitado do saldo</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const result = results[item.id];
                const ledgerNotPosted = item.status === "ledger_pending" || (item.ledgerStatus && item.ledgerStatus !== "posted");
                return (
                  <tr key={item.id}>
                    <td title={item.createdAt || ""}>{since(item.createdAt)}</td>
                    <td>
                      <Link href={`/drivers/${encodeURIComponent(item.driverId)}`}>{shortId(item.driverId)}</Link>
                    </td>
                    <td>{item.pixKeyMasked || "-"}</td>
                    <td className="num">
                      <strong>{brl(item.amountCents)}</strong>
                    </td>
                    <td className="num" title={`Taxa ${brl(item.feeCents)}${item.subscriptionSettlementCents ? ` · assinatura ${brl(item.subscriptionSettlementCents)}` : ""}`}>
                      {brl(item.totalDebitCents)}
                    </td>
                    <td>
                      {ledgerNotPosted ? <span className="status-warn">Ledger pendente</span> : null}
                      {item.attempts > 0 ? (
                        <span className="status-bad" title={item.lastError || ""}>
                          {item.attempts} {item.attempts === 1 ? "tentativa falhou" : "tentativas falharam"}
                        </span>
                      ) : null}
                      {!ledgerNotPosted && !item.attempts ? <span className="status-ok">Pronto</span> : null}
                      {result ? <small className={`status-${result.tone}`}> {result.text}</small> : null}
                    </td>
                    <td>
                      <button type="button" onClick={() => process(item)} disabled={Boolean(busyId)}>
                        {busyId === item.id ? "Enviando..." : "Processar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {sentRows.length > 0 ? (
        <ul className="recon-withdrawal-results">
          {sentRows.map(([id, result]) => (
            <li key={id}>
              <span className={`status-${result.tone}`}>
                Saque {shortId(id)}: {result.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
    </Panel>
  );
}
