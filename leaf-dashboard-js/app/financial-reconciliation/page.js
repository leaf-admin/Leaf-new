"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";
import { EmptyState, ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const severityTone = {
  critical: "status-bad",
  high: "status-bad",
  medium: "status-warn",
  low: "status-warn",
  info: "status-ok",
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function formatMoneyCents(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "--";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }

  return (numeric / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function statusLabel(report) {
  if (!report) return "Sem relatório";
  return report.ok ? "OK" : "Divergente";
}

function statusClass(report) {
  if (!report) return "meta-badge";
  return report.ok ? "status-ok" : "status-bad";
}

function issueText(issue) {
  const code = issue?.code || "UNKNOWN";
  const message = issue?.message || "Sem detalhe informado";
  return `${code}: ${message}`;
}

function reportHasIssue(report, matcher) {
  const issues = report?.issues || [];
  return issues.some((issue) => matcher.test(`${issue?.code || ""} ${issue?.message || ""}`));
}

function buildMoneyFlowChecklist(report, detail) {
  const totals = report?.totals || {};
  const paymentAmount = Number(totals.paymentAmountCents);
  const distributionTotal = Number(totals.distributionTotalCents);
  const hasPaymentAmount = Number.isFinite(paymentAmount) && paymentAmount > 0;
  const hasDistributionTotal = Number.isFinite(distributionTotal) && distributionTotal >= 0;
  const ledgerEventCount = Number(totals.ledgerEventCount || detail?.ledgerEvents?.length || 0);
  const paymentIssue = reportHasIssue(report, /PAYMENT|PIX|WOOVI/i);
  const holdingIssue = reportHasIssue(report, /HOLDING|ESCROW|RESERVE/i);
  const splitIssue = reportHasIssue(report, /SPLIT|DISTRIBUTION|DRIVER_BALANCE|OPERATIONAL_FEE/i);
  const ledgerIssue = reportHasIssue(report, /LEDGER|IDEMPOTENCY|EVENT/i);
  const withdrawalIssue = reportHasIssue(report, /WITHDRAW|PAYOUT|SAQUE/i);

  return [
    {
      label: "Pagamento Pix",
      status: hasPaymentAmount && !paymentIssue ? "ok" : "attention",
      value: formatMoneyCents(totals.paymentAmountCents),
      detail: paymentIssue ? "há divergência no pagamento" : "valor capturado para a corrida",
    },
    {
      label: "Holding backend",
      status:
        hasPaymentAmount &&
        hasDistributionTotal &&
        !holdingIssue &&
        paymentAmount >= distributionTotal
          ? "ok"
          : "attention",
      value:
        hasPaymentAmount && hasDistributionTotal && paymentAmount >= distributionTotal
          ? "coberto"
          : "revisar",
      detail: "pagamento fica reservado até a corrida ser concluída",
    },
    {
      label: "Split e taxa Leaf",
      status:
        hasPaymentAmount &&
        hasDistributionTotal &&
        !splitIssue &&
        distributionTotal <= paymentAmount
          ? "ok"
          : "attention",
      value: formatMoneyCents(totals.distributionTotalCents),
      detail: splitIssue ? "split precisa de auditoria" : "distribuição reconciliada com o total pago",
    },
    {
      label: "Ledger idempotente",
      status: ledgerEventCount > 0 && !ledgerIssue ? "ok" : "attention",
      value: `${ledgerEventCount} evento(s)`,
      detail: ledgerIssue ? "evento duplicado, ausente ou divergente" : "eventos financeiros encontrados",
    },
    {
      label: "Saldo e saque",
      status: withdrawalIssue ? "attention" : "ok",
      value: withdrawalIssue ? "revisar" : "bloqueado por saldo",
      detail: "saque deve respeitar saldo líquido, taxa aplicável e KYC/senha",
    },
  ];
}

export default function FinancialReconciliationPage() {
  const [status, setStatus] = useState("divergent");
  const [severity, setSeverity] = useState("");
  const [code, setCode] = useState("");
  const [rideId, setRideId] = useState("");
  const [includeTestData, setIncludeTestData] = useState(false);
  const [limit, setLimit] = useState(50);
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedRideId, setSelectedRideId] = useState("");
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [pendingRun, setPendingRun] = useState(null);
  const [error, setError] = useState("");

  const filters = useMemo(() => ({
    status,
    severity,
    code: code.trim(),
    rideId: rideId.trim(),
    includeTestData: includeTestData ? "true" : "",
    limit,
  }), [code, includeTestData, limit, rideId, severity, status]);

  const manualRunPreview = useMemo(() => {
    const requestedRideId = rideId.trim();
    const visibleReportCount = reports.length;

    return {
      rideId: requestedRideId,
      payload: {
        limit,
        includeTestData,
        rideId: requestedRideId || undefined,
      },
      scope: requestedRideId
        ? `Corrida específica ${requestedRideId}`
        : `Lote de até ${limit} corridas elegíveis pelo backend`,
      period: requestedRideId
        ? "Corrida informada, sem janela temporal"
        : "Pagamentos elegíveis no backend, sem período explícito no endpoint",
      estimatedTotal: requestedRideId
        ? "1 corrida"
        : visibleReportCount > 0
          ? `${visibleReportCount} relatório(s) visível(is); execução limitada a ${limit}`
          : `Até ${limit} corridas; total final resolvido pelo backend`,
    };
  }, [includeTestData, limit, reports.length, rideId]);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.listFinancialReconciliationReports(filters);
      setReports(Array.isArray(response?.reports) ? response.reports : []);
      setSummary(response?.summary || null);
      if (!selectedRideId && response?.reports?.[0]?.rideId) {
        setSelectedRideId(response.reports[0].rideId);
      }
    } catch (err) {
      setError(err?.message || "Falha ao carregar reconciliação financeira");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (nextRideId = selectedRideId) => {
    if (!nextRideId) {
      setDetail(null);
      return;
    }
    try {
      setDetailLoading(true);
      setError("");
      const response = await leafAPI.getFinancialReconciliationRide(nextRideId);
      setDetail(response || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar detalhe financeiro da corrida");
    } finally {
      setDetailLoading(false);
    }
  };

  const requestReconciliation = () => {
    setError("");
    setPendingRun(manualRunPreview);
  };

  const executeReconciliation = async () => {
    if (!pendingRun) return;

    const request = pendingRun;
    try {
      setRunning(true);
      setError("");
      const response = request.rideId
        ? await leafAPI.runFinancialReconciliationRide(request.rideId)
        : await leafAPI.runFinancialReconciliation(request.payload);
      setLastRun(response);
      await loadReports();
      if (selectedRideId) await loadDetail(selectedRideId);
      setPendingRun(null);
    } catch (err) {
      setError(err?.message || "Falha ao executar reconciliação");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDetail(selectedRideId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRideId]);

  const selectedReport = detail?.report || reports.find((report) => report.rideId === selectedRideId) || null;
  const issueCount = Number(summary?.totalIssueCount || 0);
  const divergentCount = Number(summary?.divergentInPage || 0);
  const okCount = Number(summary?.okInPage || 0);
  const moneyFlowChecklist = useMemo(
    () => buildMoneyFlowChecklist(selectedReport, detail),
    [detail, selectedReport],
  );

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Reconciliação financeira</h1>
            <p>Confira pagamentos, holdings, repasses e ledger antes da operação assistida.</p>
          </div>
          <div className="filters">
            <button type="button" onClick={loadReports} disabled={loading || running}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>
        <AppNav />

        <section className="grid grid-kpi">
          <KpiCard title="Divergências" value={divergentCount} tone={divergentCount > 0 ? "danger" : "positive"} />
          <KpiCard title="OK na página" value={okCount} tone="positive" />
          <KpiCard title="Issues" value={issueCount} tone={issueCount > 0 ? "warning" : "positive"} />
          <KpiCard title="Relatórios" value={summary?.totalInPage || 0} />
        </section>

        <Panel
          title="Filtros"
          subtitle="Por padrão, massa de teste e smoke fica fora da operação real."
          className="panel-span-full"
        >
          <div className="filters">
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="divergent">Divergentes</option>
                <option value="ok">OK</option>
                <option value="all">Todos</option>
              </select>
            </label>
            <label>
              Severidade
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="">Todas</option>
                <option value="critical">Crítica</option>
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label>
              Código
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="PAYMENT_WITHOUT_LEDGER_EVENT" />
            </label>
            <label>
              Ride ID
              <input value={rideId} onChange={(event) => setRideId(event.target.value)} placeholder="ride_..." />
            </label>
            <label>
              Limite
              <input type="number" min="1" max="100" value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            </label>
            <label className="meta-badge">
              <input type="checkbox" checked={includeTestData} onChange={(event) => setIncludeTestData(event.target.checked)} />
              Incluir teste
            </label>
            <button type="button" onClick={loadReports} disabled={loading}>
              Aplicar
            </button>
          </div>
        </Panel>

        <Panel
          title="Exceções financeiras"
          subtitle="Workspace principal para priorizar divergências e abrir a inspeção de cada corrida."
          className="panel-span-full"
        >
          {loading ? <LoadingState message="Carregando relatórios financeiros..." /> : null}
          {!loading && reports.length === 0 ? <EmptyState message="Nenhuma divergência financeira encontrada para os filtros atuais." /> : null}
          {!loading && reports.length > 0 ? (
            <div
              className="table-shell table-shell-tall"
              role="region"
              tabIndex={0}
              aria-label="Relatórios de reconciliação financeira"
            >
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Corrida</th>
                    <th>Status</th>
                    <th>Severidade</th>
                    <th>Issues</th>
                    <th>Checado em</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id || report.rideId}>
                      <td>
                        <code>{report.rideId}</code>
                        {report.testData ? <span className="table-muted">Massa de teste</span> : null}
                      </td>
                      <td><span className={statusClass(report)}>{statusLabel(report)}</span></td>
                      <td><span className={severityTone[report.severity] || "meta-badge"}>{report.severity || "info"}</span></td>
                      <td>{report.issues?.length || 0}</td>
                      <td>{formatDate(report.checkedAtIso || report.checkedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => {
                            setSelectedRideId(report.rideId);
                            setDetailExpanded(true);
                          }}
                        >
                          Abrir detalhe
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        <details
          className="technical-details"
          open={detailExpanded}
          onToggle={(event) => setDetailExpanded(event.currentTarget.open)}
        >
          <summary>
            Detalhes financeiros avançados{selectedRideId ? ` · ${selectedRideId}` : ""}
          </summary>
          <div className="technical-details-inner">
            <section className="grid">
              <Panel
                title="Fluxo do dinheiro"
                subtitle="Pagamento antecipado, holding, split, ledger, saldo e saque em uma leitura única."
              >
                <div className="metric-list">
                  {moneyFlowChecklist.map((item) => (
                    <div className="row" key={item.label}>
                      <div className="label">
                        <span className={item.status === "ok" ? "status-ok" : "status-warn"}>{item.label}</span>
                        <small>{item.detail}</small>
                      </div>
                      <div className="value">{item.value}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="Detalhe da corrida"
                subtitle={selectedRideId ? selectedRideId : "Selecione uma corrida"}
                actions={selectedRideId ? (
                  <button type="button" className="button-secondary" onClick={() => loadDetail(selectedRideId)} disabled={detailLoading}>
                    Recarregar
                  </button>
                ) : null}
              >
                {detailLoading ? <LoadingState message="Carregando detalhe..." /> : null}
                {!detailLoading && !selectedRideId ? <EmptyState message="Selecione um relatório para abrir o detalhe financeiro." /> : null}
                {!detailLoading && selectedRideId ? (
                  <div className="section-stack">
                    <KeyValueGrid
                      data={{
                        status: statusLabel(selectedReport),
                        severity: selectedReport?.severity || "-",
                        checkedAt: formatDate(selectedReport?.checkedAtIso || selectedReport?.checkedAt),
                        paymentAmount: formatMoneyCents(selectedReport?.totals?.paymentAmountCents),
                        distributionTotal: formatMoneyCents(selectedReport?.totals?.distributionTotalCents),
                        passengerGross: formatMoneyCents(selectedReport?.totals?.passengerGrossCents),
                        driverNetAmount: formatMoneyCents(selectedReport?.totals?.driverNetAmountCents),
                        operationalFee: formatMoneyCents(selectedReport?.totals?.operationalFeeCents),
                        wooviFee: formatMoneyCents(selectedReport?.totals?.wooviFeeCents),
                        ledgerEvents: selectedReport?.totals?.ledgerEventCount || detail?.ledgerEvents?.length || 0,
                      }}
                      labels={{
                        status: "Status",
                        severity: "Severidade",
                        checkedAt: "Última checagem",
                        paymentAmount: "Pagamento",
                        distributionTotal: "Distribuição",
                        passengerGross: "Bruto passageiro",
                        driverNetAmount: "Líquido motorista",
                        operationalFee: "Taxa operacional Leaf",
                        wooviFee: "Taxa Woovi",
                        ledgerEvents: "Eventos ledger",
                      }}
                    />
                    {selectedReport?.issues?.length ? (
                      <div
                        className="table-shell table-shell-tight"
                        role="region"
                        tabIndex={0}
                        aria-label="Divergências do relatório financeiro selecionado"
                      >
                        <table className="table table-compact">
                          <tbody>
                            {selectedReport.issues.map((issue, index) => (
                              <tr key={`${issue?.code || "issue"}-${index}`}>
                                <td><span className={severityTone[issue?.severity] || "meta-badge"}>{issue?.severity || "info"}</span></td>
                                <td>{issueText(issue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-muted">Sem issues no relatório selecionado.</p>
                    )}
                    <TechnicalDetails
                      title="Ver documentos financeiros e eventos"
                      data={{
                        report: detail?.report || null,
                        ledgerEvents: detail?.ledgerEvents || [],
                        sourceDocuments: detail?.sourceDocuments || {},
                      }}
                    />
                  </div>
                ) : null}
              </Panel>
            </section>
          </div>
        </details>

        <details className="technical-details">
          <summary>Execução manual · avançado</summary>
          <div className="technical-details-inner">
            <Panel
              title="Reexecutar verificação"
              subtitle="Gera ou atualiza relatórios técnicos; não altera valores ou regras financeiras."
              className="panel-span-full"
            >
              <KeyValueGrid
                data={{
                  scope: manualRunPreview.scope,
                  period: manualRunPreview.period,
                  estimatedTotal: manualRunPreview.estimatedTotal,
                  includeTestData: manualRunPreview.payload.includeTestData ? "Sim" : "Não",
                }}
                labels={{
                  scope: "Escopo",
                  period: "Período",
                  estimatedTotal: "Total estimado",
                  includeTestData: "Massa de teste",
                }}
              />
              <p className="text-muted">
                A execução lê os registros financeiros e atualiza o relatório de reconciliação. Taxa, split,
                saldo, refund, saque e política financeira permanecem inalterados.
              </p>
              <div className="panel-actions">
                <button type="button" className="button-secondary" onClick={requestReconciliation} disabled={running}>
                  {running ? "Reconciliando..." : "Revisar e executar"}
                </button>
              </div>

              {lastRun ? (
                <div className="section-stack">
                  <h3>Última execução</h3>
                  <KeyValueGrid
                    data={{
                      success: lastRun.success,
                      scannedRideCount: lastRun.scannedRideCount ?? lastRun.summary?.scannedRideCount,
                      reconciledRideCount: lastRun.reconciledRideCount ?? lastRun.summary?.reconciledRideCount,
                      divergentRideCount: lastRun.divergentRideCount ?? lastRun.summary?.divergentRideCount,
                      failedRideCount: lastRun.failedRideCount ?? lastRun.summary?.failedRideCount,
                      skippedTestRideCount: lastRun.skippedTestRideCount ?? lastRun.summary?.skippedTestRideCount,
                    }}
                    labels={{
                      success: "Resultado",
                      scannedRideCount: "Escaneadas",
                      reconciledRideCount: "Reconciliadas",
                      divergentRideCount: "Divergentes",
                      failedRideCount: "Falhas",
                      skippedTestRideCount: "Testes ignorados",
                    }}
                  />
                </div>
              ) : null}
            </Panel>
          </div>
        </details>

        <ConfirmActionDialog
          open={Boolean(pendingRun)}
          title="Confirmar execução manual"
          description="A ação reexecuta a verificação e atualiza o relatório técnico de reconciliação."
          confirmLabel={running ? "Executando..." : "Executar verificação"}
          tone="warning"
          busy={running}
          onConfirm={executeReconciliation}
          onCancel={() => {
            setPendingRun(null);
            setError("");
          }}
        >
          <div className="section-stack">
            <KeyValueGrid
              data={{
                scope: pendingRun?.scope,
                period: pendingRun?.period,
                estimatedTotal: pendingRun?.estimatedTotal,
                includeTestData: pendingRun?.payload?.includeTestData ? "Sim" : "Não",
              }}
              labels={{
                scope: "Escopo",
                period: "Período",
                estimatedTotal: "Total estimado",
                includeTestData: "Massa de teste",
              }}
            />
            <p className="text-muted">
              Consequência: os registros financeiros são lidos novamente e o relatório da corrida é gravado ou
              atualizado. A ação não altera taxa, split, saldo, refund, saque nem política financeira.
            </p>
            <ErrorText message={error} />
          </div>
        </ConfirmActionDialog>

        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
