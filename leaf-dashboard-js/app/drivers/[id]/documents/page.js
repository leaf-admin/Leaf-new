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
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    userVehicleId: "",
    category: "plus",
    vehicleStatus: "approved",
    setActive: true,
    acceptPlusWithElite: true,
  });

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

  useEffect(() => {
    const config = documents?.vehicleConfig;
    if (!config) return;

    const activeVehicle = Array.isArray(config.vehicles)
      ? config.vehicles.find((v) => v?.isActive) || config.vehicles[0]
      : null;

    const currentCategory = String(activeVehicle?.category || config.category || "plus").toLowerCase();
    setVehicleForm((prev) => ({
      ...prev,
      userVehicleId: activeVehicle?.userVehicleId || "",
      category: currentCategory.includes("elite") ? "elite" : "plus",
      vehicleStatus: String(activeVehicle?.status || "approved").toLowerCase(),
      setActive: true,
      acceptPlusWithElite: !!config.acceptPlusWithElite,
    }));
  }, [documents]);

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

  const saveVehicleConfig = async () => {
    if (!vehicleForm.userVehicleId) {
      setError("Selecione um veículo para configurar.");
      return;
    }

    try {
      setVehicleBusy(true);
      setError("");
      await leafAPI.updateDriverVehicleConfig(id, {
        userVehicleId: vehicleForm.userVehicleId,
        category: vehicleForm.category,
        vehicleStatus: vehicleForm.vehicleStatus,
        setActive: vehicleForm.setActive,
        acceptPlusWithElite: vehicleForm.acceptPlusWithElite,
      });
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao atualizar configuração de veículo");
    } finally {
      setVehicleBusy(false);
    }
  };

  const docsList = documents?.documents
    ? Object.values(documents.documents)
    : [];
  const vehicleList = Array.isArray(documents?.vehicleConfig?.vehicles)
    ? documents.vehicleConfig.vehicles
    : [];
  const kyc = documents?.kyc || {};
  const kycStatus = String(kyc.status || "not_started").toLowerCase();
  const kycTone =
    kycStatus === "approved"
      ? "status-ok"
      : (kycStatus === "rejected" || kycStatus === "blocked")
        ? "status-bad"
        : "status-warn";

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

        <section className="card">
          <h2>KYC (Onboarding + Diário)</h2>
          <div className="filters" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))", gap: 12 }}>
            <p>
              <strong>Status:</strong>{" "}
              <span className={kycTone}>{kycStatus}</span>
            </p>
            <p>
              <strong>Bloqueado:</strong> {kyc.blocked ? "Sim" : "Não"}
            </p>
            <p>
              <strong>Needs Review:</strong> {kyc.needsReview ? "Sim" : "Não"}
            </p>
            <p>
              <strong>Similaridade:</strong>{" "}
              {typeof kyc.similarity === "number" ? `${(kyc.similarity * 100).toFixed(1)}%` : "-"}
            </p>
            <p style={{ gridColumn: "1 / -1" }}>
              <strong>Última atualização:</strong> {kyc.updatedAt || "-"}
            </p>
            {kyc.message ? (
              <p style={{ gridColumn: "1 / -1" }}>
                <strong>Mensagem:</strong> {kyc.message}
              </p>
            ) : null}
          </div>
        </section>

        <section className="card">
          <h2>Configuração de Veículo e Categoria</h2>
          {vehicleList.length === 0 ? (
            <p>Nenhum veículo encontrado para este motorista.</p>
          ) : (
            <div className="filters" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))", gap: 12 }}>
              <label>
                Veículo
                <select
                  value={vehicleForm.userVehicleId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const selected = vehicleList.find((v) => v.userVehicleId === nextId);
                    setVehicleForm((prev) => ({
                      ...prev,
                      userVehicleId: nextId,
                      vehicleStatus: String(selected?.status || "approved").toLowerCase(),
                    }));
                  }}
                >
                  <option value="">Selecione</option>
                  {vehicleList.map((vehicle) => (
                    <option key={vehicle.userVehicleId} value={vehicle.userVehicleId}>
                      {vehicle.plate || "Sem placa"} • {vehicle.brand || "-"} {vehicle.model || ""} ({vehicle.year || "-"})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Categoria
                <select
                  value={vehicleForm.category}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, category: e.target.value }))}
                >
                  <option value="plus">Leaf Plus</option>
                  <option value="elite">Leaf Elite</option>
                </select>
              </label>

              <label>
                Status do Veículo
                <select
                  value={vehicleForm.vehicleStatus}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, vehicleStatus: e.target.value }))}
                >
                  <option value="approved">Aprovado</option>
                  <option value="pending">Pendente</option>
                  <option value="rejected">Rejeitado</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
                <input
                  type="checkbox"
                  checked={vehicleForm.setActive}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, setActive: e.target.checked }))}
                />
                Ativar este veículo no perfil
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
                <input
                  type="checkbox"
                  checked={vehicleForm.acceptPlusWithElite}
                  onChange={(e) => setVehicleForm((prev) => ({ ...prev, acceptPlusWithElite: e.target.checked }))}
                />
                Elite pode receber corridas Plus
              </label>

              <div>
                <button onClick={saveVehicleConfig} disabled={vehicleBusy || busy}>
                  {vehicleBusy ? "Salvando..." : "Salvar Configuração"}
                </button>
              </div>
            </div>
          )}
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
