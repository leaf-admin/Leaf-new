"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import Panel from "@/src/components/ui/Panel";
import KpiCard from "@/src/components/ui/KpiCard";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import { leafAPI } from "@/src/services/api";

const severityOptions = ["", "INFO", "WARNING", "ERROR", "CRITICAL"];
const resourceOptions = ["", "ride", "payment", "security", "auth", "dashboard"];
const rbacMatrix = [
  {
    perfil: "support",
    leitura: "suporte, usuários e fila operacional",
    mutacao: "responder, assumir, escalar e resolver suporte",
    restricao: "sem financeiro, campanhas e auditoria",
  },
  {
    perfil: "manager",
    leitura: "operação, suporte, campanhas, motoristas, financeiro e auditoria",
    mutacao: "gestão operacional com confirmação humana",
    restricao: "sem bypass de guardas de produção",
  },
  {
    perfil: "admin / super-admin",
    leitura: "todas as áreas do backoffice",
    mutacao: "ações críticas, campanhas, financeiro e cadastro",
    restricao: "ações sensíveis seguem auditadas",
  },
  {
    perfil: "development",
    leitura: "observabilidade, QA, campanhas e auditoria técnica",
    mutacao: "limitada por feature flags e guards",
    restricao: "sem financeiro operacional",
  },
];

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("pt-BR");
}

function severityClass(severity) {
  if (["ERROR", "CRITICAL"].includes(severity)) return "status-bad";
  if (severity === "WARNING") return "status-warn";
  return "status-ok";
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(1)}%`;
}

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({
    userId: "",
    action: "",
    resource: "",
    severity: "",
    limit: 50,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [logsResponse, statsResponse] = await Promise.all([
        leafAPI.listAuditLogs(filters),
        leafAPI.getAuditStats({}),
      ]);
      setLogs(logsResponse?.logs || []);
      setStats(statsResponse?.stats || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar auditoria");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const criticalCount = useMemo(
    () => logs.filter((log) => ["ERROR", "CRITICAL"].includes(log.severity)).length,
    [logs],
  );
  const failedCount = useMemo(() => logs.filter((log) => log.success === false).length, [logs]);

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Auditoria e acesso</h1>
            <p>Logs de ações críticas, leitura de RBAC e confirmações operacionais do backoffice.</p>
          </div>
          <div className="filters">
            <button type="button" onClick={load} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>
        <AppNav />

        {loading ? <LoadingState message="Carregando auditoria..." /> : null}

        <section className="grid grid-kpi">
          <KpiCard title="Eventos" value={stats?.total || logs.length} />
          <KpiCard title="Falhas" value={failedCount} tone={failedCount > 0 ? "danger" : "positive"} />
          <KpiCard title="Críticos" value={criticalCount} tone={criticalCount > 0 ? "danger" : "positive"} />
          <KpiCard title="Sucesso" value={formatPercent(stats?.successRate)} tone="positive" />
        </section>

        <Panel title="Filtros" subtitle="Consulta limitada para não varrer histórico demais em horário de operação.">
          <div className="filters">
            <label>
              Usuário
              <input
                value={filters.userId}
                onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
                placeholder="userId"
              />
            </label>
            <label>
              Ação
              <input
                value={filters.action}
                onChange={(event) => setFilters((prev) => ({ ...prev, action: event.target.value }))}
                placeholder="finishTrip, confirmPayment..."
              />
            </label>
            <label>
              Recurso
              <select value={filters.resource} onChange={(event) => setFilters((prev) => ({ ...prev, resource: event.target.value }))}>
                {resourceOptions.map((resource) => (
                  <option key={resource || "all"} value={resource}>
                    {resource || "todos"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severidade
              <select value={filters.severity} onChange={(event) => setFilters((prev) => ({ ...prev, severity: event.target.value }))}>
                {severityOptions.map((severity) => (
                  <option key={severity || "all"} value={severity}>
                    {severity || "todas"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limite
              <input
                type="number"
                min="1"
                max="200"
                value={filters.limit}
                onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value) }))}
              />
            </label>
            <button type="button" onClick={load} disabled={loading}>
              Aplicar
            </button>
          </div>
        </Panel>

        <Panel className="panel-span-full" title="Logs recentes" subtitle="Ações mais recentes gravadas em audit_logs.">
          <div
            className="table-shell table-shell-tall"
            role="region"
            tabIndex={0}
            aria-label="Logs recentes de auditoria"
          >
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Severidade</th>
                  <th>Ação</th>
                  <th>Recurso</th>
                  <th>Usuário</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Nenhum log encontrado para os filtros atuais.</td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.timestamp || log.createdAt)}</td>
                      <td><span className={severityClass(log.severity)}>{log.severity || "INFO"}</span></td>
                      <td>
                        <strong>{log.action || "-"}</strong>
                        {log.error ? <span className="table-muted error">{log.error}</span> : null}
                      </td>
                      <td>{log.resource || "-"}</td>
                      <td>{log.userId || "-"}</td>
                      <td>{log.success === false ? <span className="status-bad">falhou</span> : <span className="status-ok">ok</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <details className="audit-reference-disclosure">
          <summary>Matriz de acesso e estatísticas</summary>
          <section className="grid">
            <Panel title="Perfis de acesso" subtitle="Mapa operacional do que cada perfil deve conseguir fazer.">
              <div
                className="table-shell"
                role="region"
                tabIndex={0}
                aria-label="Matriz de acesso por perfil"
              >
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Perfil</th>
                      <th>Leitura</th>
                      <th>Ação</th>
                      <th>Restrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rbacMatrix.map((row) => (
                      <tr key={row.perfil}>
                        <td><strong>{row.perfil}</strong></td>
                        <td>{row.leitura}</td>
                        <td>{row.mutacao}</td>
                        <td>{row.restricao}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Resumo por severidade">
              <KeyValueGrid data={stats?.bySeverity || {}} maxItems={8} />
              <TechnicalDetails
                title="Estatísticas completas"
                data={{
                  bySeverity: stats?.bySeverity || {},
                  byAction: stats?.byAction || {},
                  byResource: stats?.byResource || {},
                  successRate: stats?.successRate,
                  errorRate: stats?.errorRate,
                }}
              />
            </Panel>
          </section>
        </details>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
