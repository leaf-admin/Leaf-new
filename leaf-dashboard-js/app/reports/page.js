"use client";

import { useEffect, useState } from "react";
import config from "@/src/config";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import Panel from "@/src/components/ui/Panel";
import { ErrorText, LoadingState } from "@/src/components/ui/PageFeedback";

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (mounted) {
          setLoading(true);
          setError("");
        }
        const response = await leafAPI.getReports();
        if (mounted) setReports(response?.reports || []);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar relatórios");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const generate = (reportId, format = "pdf") => {
    const url = `${config.api.baseUrl}/reports/generate/${reportId}?format=${format}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const filteredReports = reports.filter((report) =>
    `${report?.id || ""} ${report?.name || ""} ${report?.title || ""} ${report?.description || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <div>
            <h1>Relatórios</h1>
            <p>Exports operacionais para auditoria, financeiro e acompanhamento do produto.</p>
          </div>
          <div className="filters">
            <input
              placeholder="Buscar relatório"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>
        <AppNav />
        {loading ? <LoadingState message="Carregando relatórios..." /> : null}

        <section className="grid">
          <Panel
            className="panel-span-full"
            title="Relatórios disponíveis"
            subtitle="Gere arquivos sob demanda sem sair do console."
          >
            <div className="grid report-grid">
              {filteredReports.length === 0 ? (
                <article className="state-card">
                  <p>Nenhum relatório disponível para os filtros atuais.</p>
                </article>
              ) : (
                filteredReports.map((report) => (
                  <article className="card" key={report.id}>
                    <h2>{report.name || report.title || report.id}</h2>
                    <p>{report.description || "Sem descrição"}</p>
                    <div className="filters">
                      <button onClick={() => generate(report.id, "pdf")}>PDF</button>
                      <button onClick={() => generate(report.id, "excel")}>Excel</button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </Panel>
        </section>
        <ErrorText message={error} />
      </main>
    </ProtectedRoute>
  );
}
