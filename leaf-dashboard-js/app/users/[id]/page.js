"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

export default function UserDetailsPage({ params }) {
  const resolvedParams = use(params);
  const id = String(resolvedParams?.id || "").trim();
  const [user, setUser] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!id) return;
      try {
        const userData = await leafAPI.getUserDetails(id);
        if (!mounted) return;
        setUser(userData);

        const isDriver = userData?.type === "driver" || userData?.usertype === "driver";
        if (isDriver) {
          const [complete, docs] = await Promise.all([
            leafAPI.getDriverComplete(id).catch(() => null),
            leafAPI.getDriverDocuments(id).catch(() => null),
          ]);
          if (!mounted) return;
          setDriverData(complete);
          setDocuments(docs?.data || docs);
        }
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar usuário");
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [id]);

  const current = driverData || user;
  const isDriver = current?.type === "driver" || current?.usertype === "driver" || !!driverData;
  const docsCount = documents?.documents ? Object.keys(documents.documents).length : 0;

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Detalhes do Usuário</h1>
          <Link href="/users">Voltar</Link>
        </header>
        <AppNav />

        {current ? (
          <section className="grid">
            <article className="card">
              <h2>Perfil</h2>
              <KeyValueGrid
                data={{
                  id: current?.id || current?.uid || id,
                  nome: current?.name || current?.displayName || "-",
                  email: current?.email || "-",
                  telefone: current?.phone || current?.phoneNumber || "-",
                  tipo: current?.type || current?.usertype || "-",
                  status: current?.status || "-",
                  cidade: current?.city || current?.cityCode || "-",
                }}
                labels={{
                  id: "ID",
                  nome: "Nome",
                  email: "E-mail",
                  telefone: "Telefone",
                  tipo: "Tipo",
                  status: "Status",
                  cidade: "Cidade",
                }}
              />
              <TechnicalDetails title="Ver payload técnico do perfil" data={current} />
            </article>

            {isDriver ? (
              <article className="card">
                <h2>Documentos</h2>
                <KeyValueGrid
                  data={{
                    documentosEnviados: docsCount,
                    statusKyc: documents?.kyc?.status || "not_started",
                    bloqueado: documents?.kyc?.blocked || false,
                    needsReview: documents?.kyc?.needsReview || false,
                    similaridade:
                      typeof documents?.kyc?.similarity === "number"
                        ? `${(documents.kyc.similarity * 100).toFixed(1)}%`
                        : "-",
                  }}
                  labels={{
                    documentosEnviados: "Documentos enviados",
                    statusKyc: "Status KYC",
                    bloqueado: "Bloqueado",
                    needsReview: "Precisa revisão",
                    similaridade: "Similaridade",
                  }}
                />
                <TechnicalDetails title="Ver payload técnico de documentos" data={documents || {}} />
                <Link href={`/drivers/${id}/documents`}>Abrir tela de documentos</Link>
              </article>
            ) : null}
          </section>
        ) : (
          <p>Carregando...</p>
        )}

        {error ? <p className="error">{error}</p> : null}
      </main>
    </ProtectedRoute>
  );
}
