"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
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

const statusPresentation = {
  pending: { label: "Pendente", detail: "Aguardando decisão", tone: "status-warn" },
  approved: { label: "Aprovado", detail: "Documento válido", tone: "status-ok" },
  rejected: { label: "Rejeitado", detail: "Aguardando correção", tone: "status-bad" },
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

function resolveStatusPresentation(value) {
  const normalized = String(value || "pending").trim().toLowerCase();
  return statusPresentation[normalized] || {
    label: normalized || "Pendente",
    detail: "Revisar cadastro",
    tone: statusTone[normalized] || "status-warn",
  };
}

function resolveNextAction(item) {
  const status = String(item?.status || "pending").toLowerCase();
  if (item?.requiredUpdate || item?.requestStatus === "requested") return "Aguardar reenvio do motorista";
  if (item?.contentAvailable !== true) return "Pedir reenvio pelo app";
  if (status === "pending") return "Abrir documento e decidir";
  if (status === "rejected") return "Aguardar correção";
  if (status === "approved") return "Sem ação";
  return "Revisar cadastro";
}

function DriversReviewQueuePageContent() {
  const searchParams = useSearchParams();
  const kycPersistenceScope = String(searchParams.get("kycScope") || "")
    .trim()
    .toLowerCase() === "sandbox"
    ? "sandbox"
    : "operational";
  const kycRequestContext = useMemo(
    () => ({ scope: kycPersistenceScope }),
    [kycPersistenceScope],
  );
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, byStatus: { pending: 0, approved: 0, rejected: 0 } });
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingKey, setOpeningKey] = useState("");
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
      }, kycRequestContext);
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
      if (!mounted || document.visibilityState !== "visible") return;
      load({ silent: true });
    }, 60000);
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
      ready: items.filter(
        (item) =>
          String(item?.status || "pending").toLowerCase() === "pending" &&
          item?.contentAvailable === true &&
          item?.requiredUpdate !== true &&
          item?.requestStatus !== "requested",
      ).length,
      requested: items.filter((item) => item?.requiredUpdate === true || item?.requestStatus === "requested").length,
    };
  }, [items, summary]);
  const openDocument = async (item) => {
    const driverId = String(item?.driverId || "").trim();
    const documentType = String(item?.documentType || "").trim().toLowerCase();
    if (!driverId || !documentType || item?.contentAvailable !== true) return;
    const actionKey = `${driverId}:${documentType}:open`;

    try {
      setOpeningKey(actionKey);
      setError("");
      const file = await leafAPI.getDriverDocumentFile(driverId, documentType, kycRequestContext);
      const objectUrl = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      setError(err?.message || "Não foi possível abrir o documento agora.");
    } finally {
      setOpeningKey("");
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header review-queue-header">
          <div className="review-queue-title">
            <span className="review-queue-eyebrow">Cadastro / KYC</span>
            <h1>Documentos para revisar</h1>
            <p>Encontre a pendência, abra a ficha do motorista e tome a decisão com todo o contexto.</p>
          </div>
          <div className="review-queue-header-actions">
            <span className={kycPersistenceScope === "sandbox" ? "status-warn" : "status-ok"}>
              {kycPersistenceScope === "sandbox" ? "Sandbox KYC" : "Operacional"}
            </span>
            <Link
              href={kycPersistenceScope === "sandbox"
                ? "/drivers/review-queue"
                : "/drivers/review-queue?kycScope=sandbox"}
            >
              {kycPersistenceScope === "sandbox" ? "Fila operacional" : "Abrir fila sandbox"}
            </Link>
            <span className="review-queue-refresh-note">Atualização automática a cada 60s</span>
            <button type="button" className="button-secondary" onClick={() => load()} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar agora"}
            </button>
            <Link href="/drivers">Voltar para motoristas</Link>
          </div>
        </header>

        <AppNav />
        {loading ? <LoadingState message="Carregando fila de revisão..." /> : null}

        <section className="grid grid-kpi review-queue-kpis" aria-label="Resumo da fila">
          <KpiCard title="Aguardando decisão" value={counters.pending} subtitle={`${counters.total} documentos na fila`} tone="warning" />
          <KpiCard title="Prontos para revisar" value={counters.ready} subtitle="arquivo disponível" tone="positive" />
          <KpiCard title="Aguardando reenvio" value={counters.requested} subtitle="ajuste solicitado" tone={counters.requested > 0 ? "warning" : "default"} />
          <KpiCard title="Rejeitados" value={counters.rejected} subtitle="aguardando correção" tone="danger" />
        </section>

        <section className="card review-queue-filter-panel">
          <div className="review-section-heading">
            <div>
              <span className="review-queue-eyebrow">Encontrar</span>
              <h2>Encontre uma pendência</h2>
              <p>Comece por pendentes. As decisões ficam na ficha individual para evitar ações sem contexto.</p>
            </div>
            <span className="review-queue-result-count">
              {items.length} de {pagination.total || counters.total} documentos
            </span>
          </div>
          <div className="review-queue-filter-grid">
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
                Buscar
                <input
                  placeholder="nome, e-mail, CPF ou ID"
                  value={filters.search}
                  onChange={(e) => {
                    setPagination((prev) => ({ ...prev, page: 1 }));
                    setFilters((prev) => ({ ...prev, search: e.target.value }));
                  }}
                />
              </label>
          </div>
          <details className="review-queue-advanced-filters">
            <summary>Ordenação avançada</summary>
            <div className="review-queue-advanced-grid">
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
            </div>
          </details>
        </section>

        <section className="card review-queue-documents">
          <div className="review-section-heading">
            <div>
              <span className="review-queue-eyebrow">Decisão</span>
              <h2>Documentos recebidos</h2>
              <p>Uma ação principal por linha. Aprovação, rejeição e solicitação de ajuste acontecem na ficha do motorista.</p>
            </div>
            <span className="review-queue-result-count">Página {pagination.page} de {Math.max(1, pagination.pages || 1)}</span>
          </div>
          <div className="table-shell">
            <table className="table table-compact review-queue-table">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Documento</th>
                    <th>Situação</th>
                    <th>Próxima ação</th>
                    <th>Atualização</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="review-queue-empty">
                          <strong>Nenhum documento nesta visão</strong>
                          <span>Altere o status ou limpe a busca para consultar toda a fila.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    items.map((item, index) => {
                      const rowKey = `${item?.driverId || "driver"}:${item?.documentType || "doc"}:${index}`;
                      const statusKey = String(item?.status || "pending").toLowerCase();
                      const statusInfo = resolveStatusPresentation(statusKey);
                      const openKey = `${item?.driverId || ""}:${item?.documentType || ""}:open`;
                      return (
                        <tr key={rowKey}>
                          <td>
                            <strong>{item?.driver?.name || "-"}</strong>
                            <span className="table-muted">{item?.driverId || "-"}</span>
                            <span className="table-muted">{item?.driver?.email || item?.driver?.phone || "Sem contato"}</span>
                          </td>
                          <td>
                            <strong>{resolveDocumentLabel(item?.documentType)}</strong>
                            <span className="table-muted">{item?.fileName || "-"}</span>
                          </td>
                          <td>
                            <span className={statusInfo.tone}>{statusInfo.label}</span>
                            <span className="table-muted">{statusInfo.detail}</span>
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
                            <div className="actions-cell review-queue-actions">
                              <Link className="review-action-primary" href={`/drivers/${item?.driverId}/documents${kycPersistenceScope === "sandbox" ? "?kycScope=sandbox" : ""}`}>Abrir revisão</Link>
                              <button
                                type="button"
                                disabled={item?.contentAvailable !== true || openingKey === openKey}
                                onClick={() => openDocument(item)}
                              >
                                {openingKey === openKey ? "Abrindo..." : "Visualizar"}
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

          <div className="pager review-queue-pager">
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
        </section>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}

export default function DriversReviewQueuePage() {
  return (
    <Suspense fallback={<LoadingState message="Carregando fila de documentos..." />}>
      <DriversReviewQueuePageContent />
    </Suspense>
  );
}
