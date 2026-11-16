"use client";

// Corridas com repasse em conferência. O crédito do motorista sai sozinho quando o passageiro
// confirma a corrida ou em 24 h sem resposta. Aqui ficam as que o passageiro negou e as que
// alguém quer liberar antes. Liberar só muda o status: o billing-worker credita em até 1 min.
// Estorno ao passageiro não acontece por aqui; segue o fluxo de reembolso de hoje.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Panel from "@/src/components/ui/Panel";
import { EmptyState, ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

const REASON_LABELS = {
  LOCATION_DIVERGENCE: "GPS do passageiro longe do carro",
  LOCATION_SIGNAL: "GPS simulado ou salto de posição",
  OPEN_INCIDENT: "Incidente aberto",
  ENDED_FAR_FROM_DESTINATION: "Encerrada longe do destino",
};

const STATUS_LABELS = {
  awaiting_passenger: { tone: "warn", text: "Aguardando passageiro" },
  in_review: { tone: "bad", text: "Em revisão" },
  release_requested: { tone: "ok", text: "Liberando" },
  released: { tone: "ok", text: "Liberado" },
};

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

function until(value) {
  if (!value) return "-";
  const ms = Date.parse(value) - Date.now();
  if (!Number.isFinite(ms)) return "-";
  if (ms <= 0) return "agora";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `em ${minutes} min`;
  return `em ${Math.ceil(minutes / 60)} h`;
}

function shortId(value) {
  const id = String(value || "");
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function passengerAnswerLabel(hold) {
  if (hold.passengerAnswer === "took_ride") return "Confirmou a corrida";
  if (hold.passengerAnswer === "did_not_take_ride") return "Disse que não fez";
  return "Sem resposta";
}

export default function PayoutHolds() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [showReleased, setShowReleased] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getPayoutHolds();
      setItems(Array.isArray(response?.holds) ? response.holds : []);
    } catch (loadError) {
      setError(loadError?.message || "Não foi possível carregar os repasses em conferência.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(hold, release) {
    const note = window.prompt(
      release
        ? `Liberar o valor da corrida ${shortId(hold.bookingId)} para o motorista? Nota (opcional):`
        : `Manter a corrida ${shortId(hold.bookingId)} em revisão. Nota interna:`,
      hold.reviewNote || ""
    );
    if (note === null) return;
    setBusyId(hold.bookingId);
    try {
      await leafAPI.decidePayoutHold(hold.bookingId, { release, note });
    } catch (decisionError) {
      setError(decisionError?.message || "Falha ao registrar a decisão.");
    } finally {
      setBusyId("");
      load();
    }
  }

  const visible = items.filter((hold) => showReleased || hold.status !== "released");

  return (
    <Panel
      title="Repasses em conferência"
      subtitle="Sai sozinho com a confirmação do passageiro ou em 24 h sem resposta. Nunca cite ao motorista quem reportou."
      className="panel-span-full"
      actions={
        <div className="panel-actions-inline">
          <label>
            <input type="checkbox" checked={showReleased} onChange={(event) => setShowReleased(event.target.checked)} /> Mostrar liberados
          </label>
          <button type="button" className="button-secondary" onClick={load} disabled={loading || Boolean(busyId)}>
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      }
    >
      {error ? <ErrorText message={error} /> : null}
      {loading && items.length === 0 ? <LoadingState message="Carregando repasses..." /> : null}
      {!loading && !error && visible.length === 0 ? <EmptyState message="Nenhum repasse em conferência." /> : null}
      {visible.length > 0 ? (
        <div className="table-shell">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Corrida</th>
                <th>Motorista</th>
                <th>Motivo</th>
                <th>Passageiro</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((hold) => {
                const status = STATUS_LABELS[hold.status] || { tone: "warn", text: hold.status };
                const open = hold.status === "awaiting_passenger" || hold.status === "in_review";
                return (
                  <tr key={hold.bookingId}>
                    <td title={`${hold.pickupAddress || ""} → ${hold.destinationAddress || ""}`}>
                      {shortId(hold.bookingId)} · {since(hold.createdAt)}
                    </td>
                    <td>
                      {hold.driverId ? <Link href={`/drivers/${encodeURIComponent(hold.driverId)}`}>{shortId(hold.driverId)}</Link> : "-"}
                    </td>
                    <td>{(hold.reasons || []).map((reason) => REASON_LABELS[reason] || reason).join(" · ") || "-"}</td>
                    <td>{passengerAnswerLabel(hold)}</td>
                    <td>
                      <span className={`status-${status.tone}`}>{status.text}</span>
                      {hold.status === "awaiting_passenger" ? <small> · libera {until(hold.autoReleaseAt)}</small> : null}
                      {hold.reviewNote ? <small title={hold.reviewNote}> · nota</small> : null}
                      {hold.releaseAttempts > 0 ? (
                        <small className="status-bad" title={hold.lastReleaseError || ""}> · {hold.releaseAttempts} falha(s) ao creditar</small>
                      ) : null}
                    </td>
                    <td>
                      {open ? (
                        <>
                          <button type="button" onClick={() => decide(hold, true)} disabled={Boolean(busyId)}>
                            {busyId === hold.bookingId ? "Salvando..." : "Liberar"}
                          </button>{" "}
                          {hold.status === "awaiting_passenger" ? (
                            <button type="button" className="button-secondary" onClick={() => decide(hold, false)} disabled={Boolean(busyId)}>
                              Segurar
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}
