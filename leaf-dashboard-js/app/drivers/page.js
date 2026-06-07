"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const statusTone = {
  approved: "status-ok",
  active: "status-ok",
  pending: "status-warn",
  analyzing: "status-warn",
  rejected: "status-bad",
};
const DRIVERS_REFRESH_MS = 120000;

export default function DriversPage() {
  const [applications, setApplications] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [decisionModal, setDecisionModal] = useState(null);
  const [decisionReason, setDecisionReason] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getDrivers(page, 20, status, search);
      setApplications(response?.applications || []);
      setSummary(response?.summary || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar motoristas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      if (typeof document !== "undefined" && document.hidden) return;
      await load();
    };
    run();
    const timer = setInterval(run, DRIVERS_REFRESH_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, search]);

  const counters = useMemo(() => {
    const base = { all: applications.length, pending: 0, approved: 0, rejected: 0 };
    applications.forEach((item) => {
      const key = String(item?.status || "pending").toLowerCase();
      if (key in base) base[key] += 1;
    });
    return base;
  }, [applications]);

  const approve = async (driverId, notes = "Aprovado pelo dashboard Leaf") => {
    try {
      setBusyId(driverId);
      await leafAPI.approveDriverApplication(driverId, notes);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aprovar motorista");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (driverId, reason) => {
    const safeReason = String(reason || "").trim();
    if (!safeReason) return;
    try {
      setBusyId(driverId);
      await leafAPI.rejectDriverApplication(driverId, [safeReason]);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao rejeitar motorista");
    } finally {
      setBusyId(null);
    }
  };

  const openDecisionModal = (item, action) => {
    const driverId = item?.id || item?.driver?.id;
    if (!driverId) return;
    setDecisionModal({ item, action, driverId });
    setDecisionReason(action === "approve" ? "Aprovado pelo dashboard Leaf" : "");
    setError("");
  };

  const closeDecisionModal = () => {
    if (busyId) return;
    setDecisionModal(null);
    setDecisionReason("");
  };

  const submitDecisionModal = async () => {
    if (!decisionModal?.driverId) return;
    const reason = String(decisionReason || "").trim();
    if (!reason) {
      setError("Informe o motivo antes de concluir a ação.");
      return;
    }
    if (decisionModal.action === "approve") {
      await approve(decisionModal.driverId, reason);
    } else {
      await reject(decisionModal.driverId, reason);
    }
    setDecisionModal(null);
    setDecisionReason("");
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Motoristas</h1>
          <div className="filters">
            <input
              placeholder="buscar motorista..."
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
            <select
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="all">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovados</option>
              <option value="rejected">Rejeitados</option>
            </select>
            <Link href="/drivers/review-queue">Fila de Documentos</Link>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando motoristas..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Lista atual" value={counters.all} />
          <KpiCard title="Pendentes" value={counters.pending} tone="warning" />
          <KpiCard title="Aprovados" value={counters.approved} tone="positive" />
          <KpiCard title="Rejeitados" value={counters.rejected} tone="danger" />
        </section>

        <section className="grid">
          <Panel
            title="Resumo operacional"
            subtitle="Visão rápida de aprovação, pendências e status de análise."
          >
            <KeyValueGrid
              data={summary || {}}
              labels={{
                totalApplications: "Aplicações no período",
                pending: "Pendentes",
                approved: "Aprovadas",
                rejected: "Rejeitadas",
                inReview: "Em revisão",
              }}
            />
            <TechnicalDetails title="Ver detalhes técnicos da listagem" data={summary || {}} />
          </Panel>

          <Panel
            className="panel-span-full"
            title="Aplicações"
            subtitle="Ações de revisão com acesso direto à ficha documental."
          >
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Contato</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Nenhum motorista encontrado para os filtros atuais.</td>
                    </tr>
                  ) : (
                    applications.map((item, idx) => {
                      const itemId = item?.id;
                      const isBusy = busyId === itemId;
                      const itemStatus = String(item?.status || "pending").toLowerCase();
                      const badgeClass = statusTone[itemStatus] || "status-warn";

                      return (
                        <tr key={itemId || item?.driver?.id || `d-${idx}`}>
                          <td>
                            <strong>{item?.driver?.name || "-"}</strong>
                            <span className="table-muted">{item?.driver?.id || itemId || "-"}</span>
                          </td>
                          <td>
                            <div>{item?.driver?.email || "-"}</div>
                            <span className="table-muted">{item?.driver?.phone || "-"}</span>
                          </td>
                          <td>
                            <span className={badgeClass}>{itemStatus}</span>
                          </td>
                          <td>{item?.score ?? "-"}</td>
                          <td>
                            <div className="actions-cell">
                              {itemId ? <Link href={`/drivers/${itemId}/documents`}>Documentos</Link> : null}
                              <button disabled={!itemId || isBusy} onClick={() => openDecisionModal(item, "approve")}>
                                Aprovar
                              </button>
                              <button disabled={!itemId || isBusy} onClick={() => openDecisionModal(item, "reject")}>
                                Rejeitar
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
            <div className="pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
              <span>Pagina {page}</span>
              <button onClick={() => setPage((p) => p + 1)}>Proxima</button>
            </div>
          </Panel>
        </section>

        {decisionModal ? (
          <div className="admin-modal-backdrop" role="presentation">
            <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="driver-decision-title">
              <header className="admin-modal-head">
                <div>
                  <p className="eyebrow">Decisão auditável</p>
                  <h2 id="driver-decision-title">
                    {decisionModal.action === "approve" ? "Aprovar motorista" : "Rejeitar motorista"}
                  </h2>
                  <p>{decisionModal.item?.driver?.name || decisionModal.driverId}</p>
                </div>
                <button type="button" className="button-secondary" onClick={closeDecisionModal} disabled={!!busyId}>
                  Fechar
                </button>
              </header>
              <div className="admin-modal-body">
                <label className="form-field">
                  {decisionModal.action === "approve" ? "Nota de aprovação" : "Motivo da rejeição"}
                  <textarea
                    value={decisionReason}
                    onChange={(event) => setDecisionReason(event.target.value)}
                    placeholder={
                      decisionModal.action === "approve"
                        ? "Registre o motivo ou contexto da aprovação."
                        : "Explique o motivo da rejeição para auditoria."
                    }
                  />
                </label>
                <p className="muted">Esta ação será enviada ao backend com operador, motorista e motivo registrado.</p>
              </div>
              <footer className="admin-modal-actions">
                <button type="button" className="button-secondary" onClick={closeDecisionModal} disabled={!!busyId}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={decisionModal.action === "reject" ? "button-danger" : undefined}
                  onClick={submitDecisionModal}
                  disabled={!!busyId || !decisionReason.trim()}
                >
                  {decisionModal.action === "approve" ? "Aprovar" : "Rejeitar"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
