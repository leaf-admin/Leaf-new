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

function resolveNextAction(item) {
  const status = String(item?.status || "pending").toLowerCase();
  if (item?.requiredUpdate || item?.requestStatus === "requested") return "Aguardar reenvio do motorista";
  if (!item?.fileUrl) return "Revisar ficha e solicitar envio";
  if (status === "pending") return "Revisar ficha do motorista";
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
    const waitingResubmit = items.filter(
      (item) => item?.requiredUpdate === true || item?.requestStatus === "requested",
    ).length;
    return {
      total: Number(summary?.total || 0),
      pending: Number(byStatus.pending || 0),
      approved: Number(byStatus.approved || 0),
      rejected: Number(byStatus.rejected || 0),
      ready: items.filter(
        (item) =>
          String(item?.status || "pending").toLowerCase() === "pending" &&
          Boolean(item?.fileUrl) &&
          item?.requiredUpdate !== true &&
          item?.requestStatus !== "requested",
      ).length,
      requested: waitingResubmit,
      missingFiles: items.filter((item) => !item?.fileUrl).length,
    };
  }, [items, summary]);

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
          <KpiCard title="Pendentes" value={counters.pending} tone="warning" />
          <KpiCard
            title="Prontos para decisão"
            value={counters.ready}
            subtitle="na página atual"
            tone="positive"
          />
          <KpiCard
            title="Aguardando reenvio"
            value={counters.requested}
            subtitle="na página atual"
            tone={counters.requested > 0 ? "warning" : "default"}
          />
        </section>

        <details className="review-metrics-disclosure">
          <summary>Métricas complementares</summary>
          <section className="grid grid-kpi">
            <KpiCard title="Total na fila" value={counters.total} />
            <KpiCard title="Aprovados" value={counters.approved} tone="positive" />
            <KpiCard title="Rejeitados" value={counters.rejected} tone="danger" />
            <KpiCard title="Sem arquivo visível" value={counters.missingFiles} subtitle="na página atual" />
          </section>
        </details>

        <section className="grid">
          <details className="review-filter-disclosure">
            <summary>Filtros e ordenação</summary>
            <Panel title="Refinar fila" subtitle="Refine por tipo, status, ordenação e busca textual.">
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
          </details>

          <Panel
            className="panel-span-full"
            title="Documentos"
            subtitle="Fila de triagem; decisões e solicitações são feitas na ficha dedicada do motorista."
          >
            <div
              className="table-shell"
              role="region"
              tabIndex={0}
              aria-label="Documentos na fila de revisão de motoristas"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Motorista</th>
                    <th>Documento</th>
                    <th>Status</th>
                    <th>Próxima ação</th>
                    <th>Atualização</th>
                    <th>Contato</th>
                    <th>Ação</th>
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
                              {item?.driverId ? (
                                <Link href={`/drivers/${item.driverId}/documents`}>Revisar ficha</Link>
                              ) : (
                                <span className="table-muted">Ficha indisponível</span>
                              )}
                              {item?.fileUrl ? (
                                <a href={item.fileUrl} target="_blank" rel="noreferrer">
                                  Visualizar arquivo
                                </a>
                              ) : null}
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

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
