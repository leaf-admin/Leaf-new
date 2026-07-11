"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import KpiCard from "@/src/components/ui/KpiCard";
import Panel from "@/src/components/ui/Panel";
import { ErrorText } from "@/src/components/ui/PageFeedback";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

export default function FinancialSimulatorPage() {
  const [drivers, setDrivers] = useState(250);
  const [hours, setHours] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runtimeFlags, setRuntimeFlags] = useState(null);

  useEffect(() => {
    let mounted = true;
    leafAPI.getRuntimeFlags()
      .then((payload) => {
        if (mounted) setRuntimeFlags(payload || null);
      })
      .catch(() => {
        if (mounted) setRuntimeFlags(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const simulatorEnabled = runtimeFlags?.launch?.financialSimulatorEnabled === true;

  const run = async () => {
    if (!simulatorEnabled) {
      setError("Simulador financeiro desativado no perfil atual.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await leafAPI.runFinancialSimulation(drivers, hours);
      setReport(response);
    } catch (err) {
      setError(err?.message || "Falha ao executar simulação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <p className="ops-eyebrow">Labs · simulação</p>
            <h1>Simulador Financeiro</h1>
            <p>Cenário hipotético isolado dos indicadores e lançamentos da operação real.</p>
          </div>
          <div className="filters">
            <label>
              Motoristas no cenário
              <input
                type="number"
                min="1"
                value={drivers}
                onChange={(e) => setDrivers(Number(e.target.value))}
              />
            </label>
            <label>
              Duração simulada (horas)
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <button onClick={run} disabled={loading || !simulatorEnabled}>
              {loading ? "Executando..." : "Simular"}
            </button>
          </div>
        </header>
        <AppNav />

        <article className="card">
          <div className="filters">
            <span className="status-warn">LABS · NÃO OPERACIONAL</span>
          </div>
          <strong>Os valores desta página pertencem somente ao cenário simulado.</strong>
          <p className="text-muted">
            Eles não representam corridas, receita, repasses ou taxas confirmadas na operação real.
          </p>
        </article>

        <section className="grid grid-kpi">
          <KpiCard title="Motoristas no cenário" value={drivers} />
          <KpiCard title="Horas simuladas" value={hours} />
          <KpiCard title="Solicitações simuladas" value={report ? report.totalRequests || 0 : "—"} />
          <KpiCard title="Concluídas na simulação" value={report ? report.completed || 0 : "—"} tone={report ? "positive" : "default"} />
        </section>

        {!simulatorEnabled ? (
          <Panel title="Simulador desativado">
            <p className="text-muted">
              Esta superfície usa cenários hipotéticos e só pode ser usada com flag explícita de lançamento.
            </p>
          </Panel>
        ) : null}

        {simulatorEnabled && !report ? (
          <Panel title="Aguardando simulação">
            <p className="text-muted">Defina o cenário e execute a simulação para gerar resultados hipotéticos.</p>
          </Panel>
        ) : (
        <section className="grid" aria-label="Resultados simulados">
          <Panel title="Resultado simulado · Financeiro">
            <div
              className="table-shell table-shell-tight"
              role="region"
              tabIndex={0}
              aria-label="Resultado da simulação financeira"
            >
              <table className="table table-compact">
                <tbody>
                  <tr>
                    <td>GMV</td>
                    <td>R$ {Number(report?.grossVolume || 0).toLocaleString("pt-BR")}</td>
                  </tr>
                  <tr>
                    <td>Repasse motoristas</td>
                    <td>R$ {Number(report?.totalDriverPayout || 0).toLocaleString("pt-BR")}</td>
                  </tr>
                  <tr>
                    <td>Taxa Woovi</td>
                    <td>R$ {Number(report?.totalWooviFees || 0).toLocaleString("pt-BR")}</td>
                  </tr>
                  <tr>
                    <td>Receita Leaf (líquida)</td>
                    <td>R$ {Number(report?.leafNetRevenue || 0).toLocaleString("pt-BR")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Resultado simulado · Performance">
            <KeyValueGrid
              data={{
                totalRequests: report?.totalRequests || 0,
                completed: report?.completed || 0,
                canceledByPassenger: report?.canceledByPassenger || 0,
                rejectedByDriver: report?.rejectedByDriver || 0,
                completionRate:
                  report?.totalRequests > 0
                    ? `${((Number(report?.completed || 0) / Number(report?.totalRequests || 1)) * 100).toFixed(1)}%`
                    : "0%",
              }}
              labels={{
                totalRequests: "Solicitações totais",
                completed: "Corridas concluídas",
                canceledByPassenger: "Canceladas por passageiro",
                rejectedByDriver: "Rejeitadas por motorista",
                completionRate: "Taxa de conclusão",
              }}
            />
            <TechnicalDetails title="Ver payload técnico da simulação" data={report} />
          </Panel>
        </section>
        )}
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
