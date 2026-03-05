"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";

export default function UserDetailsPage({ params }) {
  const { id } = params;
  const [user, setUser] = useState(null);
  const [driverData, setDriverData] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
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
              <pre>{JSON.stringify(current, null, 2)}</pre>
            </article>

            {isDriver ? (
              <article className="card">
                <h2>Documentos</h2>
                <pre>{JSON.stringify(documents || {}, null, 2)}</pre>
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
