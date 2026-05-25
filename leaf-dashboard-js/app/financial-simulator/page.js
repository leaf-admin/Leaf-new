"use client";

import { useState } from "react";
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

  const run = async () => {
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
          <h1>Simulador Financeiro</h1>
          <div className="filters">
            <input
              type="number"
              min="1"
              value={drivers}
              onChange={(e) => setDrivers(Number(e.target.value))}
            />
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
            <button onClick={run} disabled={loading}>
              {loading ? "Executando..." : "Simular"}
            </button>
          </div>
        </header>
        <AppNav />
        <section className="grid grid-kpi">
          <KpiCard title="Motoristas" value={drivers} />
          <KpiCard title="Horas simuladas" value={hours} />
          <KpiCard title="Corridas totais" value={report?.totalRequests || 0} />
          <KpiCard title="Concluídas" value={report?.completed || 0} tone="positive" />
          <KpiCard title="Canceladas" value={report?.canceledByPassenger || 0} tone="warning" />
          <KpiCard title="Rejeitadas" value={report?.rejectedByDriver || 0} tone="danger" />
        </section>
        <section className="grid">
          <Panel title="Resumo financeiro">
            <div className="table-shell table-shell-tight">
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
          <Panel title="Resumo de performance">
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
            <TechnicalDetails title="Ver payload técnico da simulação" data={report || {}} />
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
