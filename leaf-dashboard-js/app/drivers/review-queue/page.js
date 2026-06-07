"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import KpiCard from "@/src/components/ui/KpiCard";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { leafAPI } from "@/src/services/api";

const DOCUMENT_TYPE_OPTIONS = [
  { value: "all", label: "Todos os documentos" },
  { value: "antecedentes_criminais", label: "Certidão de antecedentes" },
  { value: "cnh", label: "CNH" },
  { value: "crlv", label: "CRLV" },
];

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendentes" },
  { value: "approved", label: "Aprovados" },
  { value: "rejected", label: "Rejeitados" },
  { value: "all", label: "Todos os status" },
];

const sortByOptions = [
  { value: "uploadedAt", label: "Data de envio" },
  { value: "updatedAt", label: "Última atualização" },
  { value: "reviewedAt", label: "Data de revisão" },
];

const statusTone = {
  pending: "status-warn",
  approved: "status-ok",
  rejected: "status-bad",
};

const REJECTION_REASON_OPTIONS = {
  cnh: [
    "CNH sem EAR - Exerce atividade remunerada",
    "CNH vencida a mais de 30 dias",
    "CNH inválida - enviar CNH-e digital em PDF",
  ],
  crlv: [
    "CRLV inválido - enviar CRLV digital em PDF",
    "CRLV - ano do veículo não permitido (apenas são aceitos veículos com no máximo 10 anos de fabricação)",
    "CRLV - marca/modelo do veículo não permitido",
    "CRLV - licenciamento pendente (verificar no campo Exercício se corresponde ao ano atual)",
  ],
  antecedentes_criminais: [
    "Certidão inválida - enviar certidão oficial em PDF",
    "Certidão fora do prazo de validade",
    "Certidão não corresponde ao CPF do motorista",
  ],
};

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

function resolveDocumentLabel(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "antecedentes_criminais") return "Certidão";
  if (normalized === "cnh") return "CNH";
  if (normalized === "crlv") return "CRLV";
  return normalized || "-";
}

function formatDocumentRequestMessage(result) {
  if (result?.push?.success) return "Ajuste solicitado e push enviado ao motorista.";
  if (result?.push?.skipped) return "Ajuste solicitado sem envio de push.";
  return "Ajuste solicitado. O backend não confirmou a entrega do push.";
}

function resolveNextAction(item) {
  const status = String(item?.status || "pending").toLowerCase();
  if (item?.requiredUpdate || item?.requestStatus === "requested") return "Aguardar reenvio do motorista";
  if (!item?.fileUrl) return "Pedir envio pelo app";
  if (status === "pending") return "Abrir documento e decidir";
  if (status === "rejected") return "Aguardar correção";
  if (status === "approved") return "Sem ação";
  return "Revisar cadastro";
}

export default function DriversReviewQueuePage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, byStatus: { pending: 0, approved: 0, rejected: 0 } });
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [decisionModal, setDecisionModal] = useState(null);
  const [decisionPreset, setDecisionPreset] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [filters, setFilters] = useState({
    documentType: "all",
    status: "pending",
    search: "",
    sortBy: "uploadedAt",
    sortOrder: "desc",
  });

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await leafAPI.getDriverDocumentReviewQueue({
        ...filters,
        page: pagination.page,
        limit: pagination.limit,
      });
      const payload = response?.data || response || {};
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setSummary(payload?.summary || { total: 0, byStatus: { pending: 0, approved: 0, rejected: 0 } });
      setPagination((prev) => ({
        ...prev,
        page: Number(payload?.pagination?.page || prev.page || 1),
        limit: Number(payload?.pagination?.limit || prev.limit || 25),
        total: Number(payload?.pagination?.total || 0),
        pages: Number(payload?.pagination?.pages || 0),
      }));
    } catch (err) {
      setError(err?.message || "Falha ao carregar fila de revisão");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      await load();
    };
    run();
    const timer = setInterval(() => {
      if (!mounted) return;
      load({ silent: true });
    }, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pagination.page, pagination.limit]);

  const counters = useMemo(() => {
    const byStatus = summary?.byStatus || {};
    return {
      total: Number(summary?.total || 0),
      pending: Number(byStatus.pending || 0),
      approved: Number(byStatus.approved || 0),
      rejected: Number(byStatus.rejected || 0),
      requested: items.filter((item) => item?.requiredUpdate === true || item?.requestStatus === "requested").length,
    };
  }, [items, summary]);
  const reviewChecklist = useMemo(() => {
    const missingFiles = items.filter((item) => !item?.fileUrl).length;
    const waitingResubmit = items.filter((item) => item?.requiredUpdate === true || item?.requestStatus === "requested").length;
    const readyToReview = items.filter((item) => String(item?.status || "pending").toLowerCase() === "pending" && item?.fileUrl).length;
    return [
      {
        label: "Prontos para decisão",
        value: readyToReview,
        detail: "visualizar documento, aprovar ou rejeitar",
      },
      {
        label: "Sem arquivo visível",
        value: missingFiles,
        detail: "pedir envio pelo app antes da análise",
      },
      {
        label: "Aguardando reenvio",
        value: waitingResubmit,
        detail: "push já solicitado, esperar nova versão",
      },
    ];
  }, [items]);

  const reviewDocument = async (item, action, reason = "") => {
    const driverId = String(item?.driverId || "").trim();
    const documentType = String(item?.documentType || "").trim().toLowerCase();
    if (!driverId || !documentType) return;

    const rejectionReason = action === "reject" ? String(reason || "").trim() : "";
    if (action === "reject" && !rejectionReason) return;

    try {
      setBusyKey(`${driverId}:${documentType}`);
      setError("");
      setActionMessage("");
      await leafAPI.reviewDriverDocument(driverId, documentType, action, rejectionReason || "");
      setActionMessage(
        `${resolveDocumentLabel(documentType)} ${action === "approve" ? "aprovado" : "rejeitado"} com sucesso.`,
      );
      await load({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao revisar documento");
    } finally {
      setBusyKey("");
    }
  };

  const requestDocumentUpdate = async (item, reason) => {
    const driverId = String(item?.driverId || "").trim();
    const documentType = String(item?.documentType || "").trim().toLowerCase();
    if (!driverId || !documentType) return;

    const requestReason = String(reason || "").trim();
    if (!requestReason) return;

    try {
      setBusyKey(`${driverId}:${documentType}:request`);
      setError("");
      setActionMessage("");
      const result = await leafAPI.requestDriverDocument(driverId, documentType, {
        reason: requestReason,
        sendPush: true,
      });
      setActionMessage(formatDocumentRequestMessage(result));
      await load({ silent: true });
    } catch (err) {
      setError(err?.message || "Falha ao solicitar ajuste do documento");
    } finally {
      setBusyKey("");
    }
  };

  const openDecisionModal = (item, mode) => {
    const documentType = String(item?.documentType || "").trim().toLowerCase();
    const defaultReason =
      mode === "request"
        ? item?.rejectionReason || item?.requestReason || "Precisamos que você envie uma versão atualizada deste documento no app."
        : "";
    setDecisionModal({ item, mode, documentType });
    setDecisionPreset("");
    setDecisionReason(defaultReason);
    setError("");
    setActionMessage("");
  };

  const closeDecisionModal = () => {
    if (busyKey) return;
    setDecisionModal(null);
    setDecisionPreset("");
    setDecisionReason("");
  };

  const handleDecisionPresetChange = (event) => {
    const value = event.target.value;
    setDecisionPreset(value);
    if (value) {
      setDecisionReason(value);
    }
  };

  const submitDecisionModal = async () => {
    if (!decisionModal?.item) return;
    const reason = String(decisionReason || "").trim();
    if (!reason) {
      setError("Informe o motivo antes de concluir a ação.");
      return;
    }

    if (decisionModal.mode === "reject") {
      await reviewDocument(decisionModal.item, "reject", reason);
    } else if (decisionModal.mode === "request") {
      await requestDocumentUpdate(decisionModal.item, reason);
    }

    setDecisionModal(null);
    setDecisionPreset("");
    setDecisionReason("");
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Fila de Revisão de Documentos</h1>
          <div className="filters">
            <Link href="/drivers">Voltar para Motoristas</Link>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando fila de revisão..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Total na fila" value={counters.total} />
          <KpiCard title="Pendentes" value={counters.pending} tone="warning" />
          <KpiCard title="Aprovados" value={counters.approved} tone="positive" />
          <KpiCard title="Rejeitados" value={counters.rejected} tone="danger" />
          <KpiCard title="Ajuste solicitado" value={counters.requested} tone={counters.requested > 0 ? "warning" : "default"} />
        </section>

        <section className="grid">
          <Panel title="Filtros" subtitle="Refine por tipo, status, ordenação e busca textual.">
            <div className="filters">
              <label>
                Documento
                <select
                  value={filters.documentType}
                  onChange={(e) => {
                    setPagination((prev) => ({ ...prev, page: 1 }));
                    setFilters((prev) => ({ ...prev, documentType: e.target.value }));
                  }}
                >
                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Status
                <select
                  value={filters.status}
                  onChange={(e) => {
                    setPagination((prev) => ({ ...prev, page: 1 }));
                    setFilters((prev) => ({ ...prev, status: e.target.value }));
                  }}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Ordenar por
                <select
                  value={filters.sortBy}
                  onChange={(e) => {
                    setPagination((prev) => ({ ...prev, page: 1 }));
                    setFilters((prev) => ({ ...prev, sortBy: e.target.value }));
                  }}
                >
                  {sortByOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Direção
                <select
                  value={filters.sortOrder}
                  onChange={(e) => {
                    setPagination((prev) => ({ ...prev, page: 1 }));
                    setFilters((prev) => ({ ...prev, sortOrder: e.target.value }));
                  }}
                >
                  <option value="desc">Mais recentes primeiro</option>
                  <option value="asc">Mais antigos primeiro</option>
                </select>
              </label>

              <label>
                Buscar
                <input
                  placeholder="nome, email, cpf, id..."
                  value={filters.search}
                  onChange={(e) => {
                    setPagination((prev) => ({ ...prev, page: 1 }));
                    setFilters((prev) => ({ ...prev, search: e.target.value }));
                  }}
                />
              </label>
            </div>
          </Panel>

          <Panel title="Checklist da fila" subtitle="Próxima ação por bloco, sem abrir cada ficha manualmente.">
            <div className="metric-list">
              {reviewChecklist.map((item) => (
                <div className="row" key={item.label}>
                  <div className="label">
                    <span>{item.label}</span>
                    <small>{item.detail}</small>
                  </div>
                  <div className="value">{item.value}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            className="panel-span-full"
            title="Documentos"
            subtitle="Central de decisão para aprovação e rejeição de documentos enviados."
          >
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Documento</th>
                    <th>Status</th>
                    <th>Próxima ação</th>
                    <th>Atualização</th>
                    <th>Contato</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Nenhum item encontrado para os filtros selecionados.</td>
                    </tr>
                  ) : (
                    items.map((item, index) => {
                      const rowKey = `${item?.driverId || "driver"}:${item?.documentType || "doc"}:${index}`;
                      const statusKey = String(item?.status || "pending").toLowerCase();
                      const badgeClass = statusTone[statusKey] || "status-warn";
                      const actionKey = `${item?.driverId || ""}:${item?.documentType || ""}`;
                      const requestKey = `${item?.driverId || ""}:${item?.documentType || ""}:request`;
                      const isBusy = busyKey === actionKey || busyKey === requestKey;
                      return (
                        <tr key={rowKey}>
                          <td>
                            <strong>{item?.driver?.name || "-"}</strong>
                            <span className="table-muted">{item?.driverId || "-"}</span>
                          </td>
                          <td>
                            <strong>{resolveDocumentLabel(item?.documentType)}</strong>
                            <span className="table-muted">{item?.fileName || "-"}</span>
                          </td>
                          <td>
                            <span className={badgeClass}>{statusKey}</span>
                            {item?.requiredUpdate || item?.requestStatus === "requested" ? (
                              <span className="status-warn">ajuste solicitado</span>
                            ) : null}
                            {item?.rejectionReason ? (
                              <span className="table-muted error">{item.rejectionReason}</span>
                            ) : null}
                            {item?.requestReason ? (
                              <span className="table-muted">{item.requestReason}</span>
                            ) : null}
                          </td>
                          <td>
                            <strong>{resolveNextAction(item)}</strong>
                            <span className="table-muted">
                              {item?.requestStatus ? `Solicitação: ${item.requestStatus}` : "sem solicitação aberta"}
                            </span>
                          </td>
                          <td>
                            <div>{formatDateTime(item?.uploadedAt)}</div>
                            <span className="table-muted">Rev.: {formatDateTime(item?.reviewedAt)}</span>
                          </td>
                          <td>
                            <div>{item?.driver?.email || "-"}</div>
                            <span className="table-muted">{item?.driver?.phone || "-"}</span>
                          </td>
                          <td>
                            <div className="actions-cell">
                              <Link href={`/drivers/${item?.driverId}/documents`}>Abrir ficha</Link>
                              <button
                                type="button"
                                disabled={!item?.fileUrl}
                                onClick={() => {
                                  if (!item?.fileUrl) return;
                                  window.open(item.fileUrl, "_blank", "noopener,noreferrer");
                                }}
                              >
                                Visualizar
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => reviewDocument(item, "approve")}
                              >
                                Aprovar
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => openDecisionModal(item, "reject")}
                              >
                                Rejeitar
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => openDecisionModal(item, "request")}
                              >
                                Solicitar ajuste
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
              <button
                type="button"
                onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={pagination.page <= 1}
              >
                Anterior
              </button>
              <span>
                Página {pagination.page} de {Math.max(1, pagination.pages || 1)} • {pagination.total} itens
              </span>
              <button
                type="button"
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    page: Math.min(Math.max(1, prev.pages || 1), prev.page + 1),
                  }))
                }
                disabled={pagination.page >= Math.max(1, pagination.pages || 1)}
              >
                Próxima
              </button>
            </div>
          </Panel>
        </section>

        {decisionModal ? (
          <div className="admin-modal-backdrop" role="presentation">
            <section
              aria-modal="true"
              className="admin-modal"
              role="dialog"
              aria-labelledby="driver-review-decision-title"
            >
              <header className="admin-modal-head">
                <div>
                  <p className="eyebrow">Decisão auditável</p>
                  <h2 id="driver-review-decision-title">
                    {decisionModal.mode === "reject" ? "Rejeitar documento" : "Solicitar ajuste"}
                  </h2>
                  <p>
                    {resolveDocumentLabel(decisionModal.documentType)} de{" "}
                    {decisionModal.item?.driver?.name || decisionModal.item?.driverId || "motorista"}
                  </p>
                </div>
                <button type="button" className="button-secondary" onClick={closeDecisionModal} disabled={!!busyKey}>
                  Fechar
                </button>
              </header>

              <div className="admin-modal-body">
                {decisionModal.mode === "reject" ? (
                  <label className="form-field">
                    Motivo padrão
                    <select value={decisionPreset} onChange={handleDecisionPresetChange}>
                      <option value="">Selecionar motivo</option>
                      {(REJECTION_REASON_OPTIONS[decisionModal.documentType] || []).map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="form-field">
                  {decisionModal.mode === "reject" ? "Motivo registrado" : "Mensagem para o motorista"}
                  <textarea
                    value={decisionReason}
                    onChange={(event) => setDecisionReason(event.target.value)}
                    placeholder={
                      decisionModal.mode === "reject"
                        ? "Explique o motivo da rejeição."
                        : "Explique de forma simples o que precisa ser reenviado."
                    }
                  />
                </label>

                <p className="muted">
                  Esta ação será enviada ao backend com operador, documento, decisão e motivo para auditoria.
                </p>
              </div>

              <footer className="admin-modal-actions">
                <button type="button" className="button-secondary" onClick={closeDecisionModal} disabled={!!busyKey}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={decisionModal.mode === "reject" ? "button-danger" : undefined}
                  onClick={submitDecisionModal}
                  disabled={!!busyKey || !decisionReason.trim()}
                >
                  {decisionModal.mode === "reject" ? "Rejeitar documento" : "Solicitar ajuste"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        <ErrorText message={error} />
        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
      </main>
    </ProtectedRoute>
  );
}
