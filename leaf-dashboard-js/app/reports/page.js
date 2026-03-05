"use client";

import { useEffect, useState } from "react";
import config from "@/src/config";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await leafAPI.getReports();
        if (mounted) setReports(response?.reports || []);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar relatórios");
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

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Relatórios</h1>
        </header>
        <AppNav />
        <section className="grid">
          {reports.length === 0 ? (
            <article className="card">
              <p>Nenhum relatório disponível</p>
            </article>
          ) : (
            reports.map((report) => (
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
        </section>
        {error ? <p className="error">{error}</p> : null}
      </main>
    </ProtectedRoute>
  );
}
