"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";

export default function DriverDocumentsPage({ params }) {
  const { id } = params;
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewingType, setReviewingType] = useState(null);

  const load = async () => {
    const response = await leafAPI.getDriverDocuments(id);
    setDocuments(response?.data || response);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const response = await leafAPI.getDriverDocuments(id);
        if (mounted) setDocuments(response?.data || response);
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar documentos");
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [id]);

  const approveAll = async () => {
    if (!window.confirm("Aprovar motorista e todos os documentos?")) return;
    try {
      setBusy(true);
      await leafAPI.approveDriverApplication(id);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aprovar motorista");
    } finally {
      setBusy(false);
    }
  };

  const rejectAll = async () => {
    const reason = window.prompt("Motivo da rejeição:");
    if (!reason) return;
    try {
      setBusy(true);
      await leafAPI.rejectDriverApplication(id, [reason]);
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao rejeitar motorista");
    } finally {
      setBusy(false);
    }
  };

  const reviewSingle = async (documentType, action) => {
    const reason = action === "reject" ? window.prompt("Motivo da rejeição:") : "";
    if (action === "reject" && !reason) return;
    try {
      setReviewingType(documentType);
      await leafAPI.reviewDriverDocument(id, documentType, action, reason || "");
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao revisar documento");
    } finally {
      setReviewingType(null);
    }
  };

  const docsList = documents?.documents
    ? Object.values(documents.documents)
    : [];

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Documentos do Motorista</h1>
          <div className="filters">
            <button onClick={approveAll} disabled={busy}>
              Aprovar
            </button>
            <button onClick={rejectAll} disabled={busy}>
              Rejeitar
            </button>
            <Link href="/drivers">Voltar</Link>
          </div>
        </header>
        <AppNav />
        <section className="card">
          <h2>Resumo do motorista</h2>
          <pre>{JSON.stringify(documents?.driver || {}, null, 2)}</pre>
        </section>

        <section className="grid">
          {docsList.length === 0 ? (
            <article className="card">
              <p>Nenhum documento encontrado.</p>
            </article>
          ) : (
            docsList.map((doc, idx) => (
              <article className="card" key={`${doc.type}-${idx}`}>
                <h2>{String(doc.type || "documento").toUpperCase()}</h2>
                <p>Status: {doc.status || "pending"}</p>
                {doc.url ? (
                  <a href={doc.url} target="_blank" rel="noreferrer">
                    Ver documento
                  </a>
                ) : null}
                {doc.rejectionReason ? <p className="error">{doc.rejectionReason}</p> : null}
                <div className="filters">
                  <button
                    disabled={reviewingType === doc.type || busy}
                    onClick={() => reviewSingle(doc.type, "approve")}
                  >
                    Aprovar doc
                  </button>
                  <button
                    disabled={reviewingType === doc.type || busy}
                    onClick={() => reviewSingle(doc.type, "reject")}
                  >
                    Rejeitar doc
                  </button>
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
