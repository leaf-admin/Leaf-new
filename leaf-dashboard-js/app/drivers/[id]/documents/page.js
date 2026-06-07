"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";

const DOCUMENT_REJECTION_REASON_OPTIONS = {
  cnh: [
    "CNH sem EAR - Exerce atividade remunerada",
    "CNH vencida a mais de 30 dias",
    "CNH inválida - enviar CNH-e digital em PDF",
  ],
  crlv: [
    "CRLV inválido - enviar CRLV digital em PDF",
    "CRLV - ano do veículo não permitido (apenas são aceitos veículos com no máximo 10 anos de fabricação)",
    "CRLV - marca/modelo do veículo não permitido",
    "CRLV - licenciamento pendente (verificar no campo Exercício se corresponde ao ano atual)",
  ],
  antecedentes_criminais: [
    "Certidão inválida - enviar certidão oficial em PDF",
    "Certidão fora do prazo de validade",
    "Certidão não corresponde ao CPF do motorista",
  ],
};

const DOCUMENT_LABELS = {
  cnh: "CNH",
  crlv: "CRLV",
  antecedentes_criminais: "Certidão de antecedentes",
};

const OPERATIONAL_DOCUMENT_TYPES = new Set(["cnh", "crlv", "antecedentes_criminais"]);

const DOCUMENT_STATUS_LABELS = {
  approved: "Aprovado",
  pending: "Pendente",
  rejected: "Rejeitado",
  requested: "Solicitado",
  missing: "Ausente",
};

function getReasonOptions(documentType) {
  const normalized = String(documentType || "").trim().toLowerCase();
  return DOCUMENT_REJECTION_REASON_OPTIONS[normalized] || [];
}

function resolveDocumentUrl(doc) {
  const candidates = [
    doc?.fileUrl,
    doc?.url,
    doc?.downloadUrl,
    doc?.front,
    doc?.back,
    doc?.registration,
    doc?.insurance,
    doc?.file?.url,
    doc?.metadata?.fileUrl,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

function normalizeDocumentType(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveDocumentLabel(value) {
  const normalized = normalizeDocumentType(value);
  return DOCUMENT_LABELS[normalized] || normalized.toUpperCase() || "Documento";
}

function isDocumentRequested(doc) {
  return String(doc?.requestStatus || "").toLowerCase() === "requested" || doc?.requiredUpdate === true;
}

function resolveDocumentStatus(doc) {
  const status = String(doc?.status || "").trim().toLowerCase();
  if (status) return status;
  return isDocumentRequested(doc) ? "requested" : "missing";
}

function formatDocumentStatus(doc) {
  const status = resolveDocumentStatus(doc);
  const label = DOCUMENT_STATUS_LABELS[status] || status || "-";
  if (isDocumentRequested(doc) && status === "approved") return `${label} - atualização solicitada`;
  if (isDocumentRequested(doc) && status !== "requested") return `${label} - solicitação aberta`;
  return label;
}

function documentStatusTone(doc) {
  const status = resolveDocumentStatus(doc);
  if (status === "approved" && !isDocumentRequested(doc)) return "status-ok";
  if (status === "rejected") return "status-bad";
  return "status-warn";
}

export default function DriverDocumentsPage({ params }) {
  const resolvedParams = use(params);
  const id = String(resolvedParams?.id || "").trim();
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewingType, setReviewingType] = useState(null);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [uploadingBackgroundDoc, setUploadingBackgroundDoc] = useState(false);
  const [backgroundDocFile, setBackgroundDocFile] = useState(null);
  const [selectedRejectionReasons, setSelectedRejectionReasons] = useState({});
  const [customRejectionReasons, setCustomRejectionReasons] = useState({});
  const [applicationDecisionModal, setApplicationDecisionModal] = useState(null);
  const [applicationDecisionReason, setApplicationDecisionReason] = useState("");
  const [showRatingReviews, setShowRatingReviews] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [docStatusFilter, setDocStatusFilter] = useState("all");
  const [vehicleForm, setVehicleForm] = useState({
    userVehicleId: "",
    category: "plus",
    vehicleStatus: "approved",
    setActive: true,
    acceptPlusWithElite: true,
  });

  const load = async () => {
    if (!id) return;
    const response = await leafAPI.getDriverDocuments(id);
    setDocuments(response?.data || response);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!id) return;
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
      category: currentCategory.includes("elite") ? "elite" : currentCategory.includes("moto") ? "moto" : "plus",
      vehicleStatus: String(activeVehicle?.status || "approved").toLowerCase(),
      setActive: true,
      acceptPlusWithElite: !!config.acceptPlusWithElite,
    }));
  }, [documents]);

  const approveAll = async (notes = "Aprovado pelo dashboard Leaf") => {
    try {
      setBusy(true);
      setError("");
      setActionMessage("");
      await leafAPI.approveDriverApplication(id, notes);
      setActionMessage("Motorista aprovado com sucesso.");
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao aprovar motorista");
    } finally {
      setBusy(false);
    }
  };

  const rejectAll = async (reason) => {
    const safeReason = String(reason || "").trim();
    if (!safeReason) return;
    try {
      setBusy(true);
      setError("");
      setActionMessage("");
      await leafAPI.rejectDriverApplication(id, [safeReason]);
      setActionMessage("Motorista rejeitado com sucesso.");
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao rejeitar motorista");
    } finally {
      setBusy(false);
    }
  };

  const openApplicationDecisionModal = (action) => {
    setApplicationDecisionModal({ action });
    setApplicationDecisionReason(action === "approve" ? "Aprovado pelo dashboard Leaf" : "");
    setError("");
    setActionMessage("");
  };

  const closeApplicationDecisionModal = () => {
    if (busy) return;
    setApplicationDecisionModal(null);
    setApplicationDecisionReason("");
  };

  const submitApplicationDecisionModal = async () => {
    if (!applicationDecisionModal?.action) return;
    const reason = String(applicationDecisionReason || "").trim();
    if (!reason) {
      setError("Informe o motivo antes de concluir a ação.");
      return;
    }
    if (applicationDecisionModal.action === "approve") {
      await approveAll(reason);
    } else {
      await rejectAll(reason);
    }
    setApplicationDecisionModal(null);
    setApplicationDecisionReason("");
  };

  const resolveRejectionReason = (documentType) => {
    const selected = String(selectedRejectionReasons?.[documentType] || "").trim();
    if (selected && selected !== "__custom__") {
      return selected;
    }

    const options = getReasonOptions(documentType);
    if (options.length > 0 && !selected) {
      return "";
    }

    return String(customRejectionReasons?.[documentType] || "").trim();
  };

  const reviewSingle = async (documentType, action) => {
    const normalizedType = String(documentType || "").toLowerCase();
    const reason = action === "reject" ? resolveRejectionReason(normalizedType) : "";

    if (action === "reject" && !reason) {
      setError("Selecione um motivo padrão de rejeição ou informe um motivo personalizado.");
      return;
    }

    try {
      setError("");
      setActionMessage("");
      setReviewingType(normalizedType);
      await leafAPI.reviewDriverDocument(id, normalizedType, action, reason || "");
      setActionMessage(
        `${resolveDocumentLabel(normalizedType)} ${action === "approve" ? "aprovado" : "rejeitado"} com sucesso.`,
      );
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
      setActionMessage("");
      await leafAPI.updateDriverVehicleConfig(id, {
        userVehicleId: vehicleForm.userVehicleId,
        category: vehicleForm.category,
        vehicleStatus: vehicleForm.vehicleStatus,
        setActive: vehicleForm.setActive,
        acceptPlusWithElite: vehicleForm.acceptPlusWithElite,
      });
      setActionMessage("Configuração de veículo atualizada.");
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao atualizar configuração de veículo");
    } finally {
      setVehicleBusy(false);
    }
  };

  const uploadBackgroundDocument = async () => {
    if (!backgroundDocFile) {
      setError("Selecione um arquivo PDF para anexar a certidão de antecedentes.");
      return;
    }

    try {
      setUploadingBackgroundDoc(true);
      setError("");
      setActionMessage("");
      await leafAPI.uploadDriverDocument(id, "antecedentes_criminais", backgroundDocFile);
      setBackgroundDocFile(null);
      setActionMessage("Certidão de antecedentes anexada com sucesso.");
      await load();
    } catch (err) {
      setError(err?.message || "Falha ao anexar certidão de antecedentes");
    } finally {
      setUploadingBackgroundDoc(false);
    }
  };

  const docsList = useMemo(
    () => {
      const allDocs = documents?.documents?.all_documents;
      const source = Array.isArray(allDocs)
        ? allDocs
        : Object.entries(documents?.documents || {}).map(([type, doc]) => ({ type, ...(doc || {}) }));

      return source.filter((doc) => {
        const normalizedType = normalizeDocumentType(doc?.type);
        return OPERATIONAL_DOCUMENT_TYPES.has(normalizedType);
      });
    },
    [documents?.documents],
  );
  const filteredDocsList = useMemo(() => {
    const term = docSearch.trim().toLowerCase();
    return docsList.filter((doc) => {
      const status = String(doc?.status || "").toLowerCase();
      if (docStatusFilter === "requested" && !isDocumentRequested(doc)) return false;
      if (docStatusFilter !== "all" && docStatusFilter !== "requested" && status !== docStatusFilter) return false;
      if (!term) return true;
      return `${doc?.type || ""} ${doc?.fileName || ""} ${status} ${doc?.requestStatus || ""} ${doc?.requestReason || ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [docsList, docSearch, docStatusFilter]);

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
  const ratingInsights = documents?.ratingInsights || {};
  const averageRating = ratingInsights?.averageRating || documents?.driver?.rating || "-";
  const totalRatings = Number(ratingInsights?.totalRatings || documents?.driver?.ratingCount || 0);
  const latestNegativeReviews = Array.isArray(ratingInsights?.latestNegativeReviews)
    ? ratingInsights.latestNegativeReviews
    : [];
  const backgroundCheckDoc = documents?.documents?.antecedentes_criminais || null;
  const backgroundCheckUrl = resolveDocumentUrl(backgroundCheckDoc || {});

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Documentos do Motorista</h1>
          <div className="filters">
            <button onClick={() => openApplicationDecisionModal("approve")} disabled={busy}>
              Aprovar
            </button>
            <button onClick={() => openApplicationDecisionModal("reject")} disabled={busy}>
              Rejeitar
            </button>
            <Link href="/drivers">Voltar</Link>
          </div>
        </header>
        <AppNav />

        <section className="card">
          <h2>Resumo do motorista</h2>
          <KeyValueGrid
            data={{
              id: documents?.driver?.id || id,
              nome: documents?.driver?.name || "-",
              email: documents?.driver?.email || "-",
              telefone: documents?.driver?.phone || "-",
              cpf: documents?.driver?.cpf || "-",
              dataNascimento: documents?.driver?.birthDate || null,
              nomeMae: documents?.driver?.motherName || "-",
              genero: documents?.driver?.genderLabel || documents?.driver?.gender || "-",
              dataCadastro: documents?.driver?.registrationDate || null,
              rating: averageRating,
              status: documents?.driver?.status || "pending",
              aprovado: documents?.driver?.approved || false,
            }}
            labels={{
              id: "ID",
              nome: "Nome",
              email: "E-mail",
              telefone: "Telefone",
              cpf: "CPF",
              dataNascimento: "Data de nascimento",
              nomeMae: "Nome da mãe",
              genero: "Gênero",
              dataCadastro: "Data do cadastro",
              rating: "Rating",
              status: "Status",
              aprovado: "Aprovado",
            }}
            valueFormatter={(key, value) => {
              if (key === "dataNascimento" || key === "dataCadastro") {
                return formatDateTime(value);
              }

              if (key === "rating") {
                return (
                  <button
                    type="button"
                    className="inline-link-btn"
                    onClick={() => setShowRatingReviews((prev) => !prev)}
                  >
                    {value !== "-" ? `⭐ ${value}` : "Sem avaliações"} {totalRatings > 0 ? `(${totalRatings})` : ""}
                  </button>
                );
              }

              return value;
            }}
          />
          {showRatingReviews ? (
            <div className="review-list-wrap">
              <h3>Avaliações recentes com comentário negativo</h3>
              {latestNegativeReviews.length === 0 ? (
                <p className="text-muted">Sem comentários negativos recentes para este motorista.</p>
              ) : (
                <ul className="review-list">
                  {latestNegativeReviews.map((review, index) => (
                    <li
                      key={review.id || `${review.tripId || "trip"}-${review.createdAt || index}`}
                      className="review-item"
                    >
                      <div className="review-meta">
                        <span>⭐ {review.rating ?? "-"}</span>
                        <span>{formatDateTime(review.createdAt)}</span>
                        <span>Trip: {review.tripId || "-"}</span>
                      </div>
                      <p className="review-comment">{review.comment || "Sem comentário"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          <TechnicalDetails title="Ver payload técnico do motorista" data={documents?.driver || {}} />
        </section>

        <section className="card">
          <h2>Certidão de antecedentes</h2>
          <div className="filters" style={{ display: "grid", gap: 6 }}>
            <p>
              <strong>Status:</strong>{" "}
              <span className={documentStatusTone(backgroundCheckDoc || {})}>
                {formatDocumentStatus(backgroundCheckDoc || {})}
              </span>
            </p>
            {backgroundCheckDoc?.requestReason ? (
              <p>
                <strong>Solicitação:</strong> {backgroundCheckDoc.requestReason}
              </p>
            ) : null}
            {backgroundCheckDoc?.uploadedAt ? (
              <p>
                <strong>Enviado em:</strong> {new Date(backgroundCheckDoc.uploadedAt).toLocaleString("pt-BR")}
              </p>
            ) : null}
            <button
              type="button"
              disabled={!backgroundCheckUrl}
              onClick={() => {
                if (!backgroundCheckUrl) return;
                window.open(backgroundCheckUrl, "_blank", "noopener,noreferrer");
              }}
            >
              {backgroundCheckUrl ? "Visualizar certidão atual" : "Sem certidão anexada"}
            </button>
          </div>
          <div className="filters" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                const nextFile = event?.target?.files?.[0] || null;
                setBackgroundDocFile(nextFile);
              }}
            />
            <button onClick={uploadBackgroundDocument} disabled={busy || uploadingBackgroundDoc || !backgroundDocFile}>
              {uploadingBackgroundDoc ? "Enviando..." : "Anexar certidão (PDF)"}
            </button>
          </div>
          <p className="text-muted" style={{ marginTop: 8 }}>
            Documento anexado aqui fica disponível para revisão junto com CNH/CRLV.
          </p>
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
                  <option value="moto">Leaf Moto</option>
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
          <article className="card">
            <h2>Filtros de documentos</h2>
            <div className="filters">
              <input
                placeholder="Buscar por tipo ou arquivo"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
              <select
                value={docStatusFilter}
                onChange={(e) => setDocStatusFilter(e.target.value)}
              >
                <option value="all">Todos os status</option>
                <option value="requested">Solicitado</option>
                <option value="pending">Pendente</option>
                <option value="approved">Aprovado</option>
                <option value="rejected">Rejeitado</option>
              </select>
            </div>
          </article>
        </section>

        <section className="grid list-scroll list-scroll-tall">
          {filteredDocsList.length === 0 ? (
            <article className="card">
              <p>Nenhum documento encontrado.</p>
            </article>
          ) : (
            filteredDocsList.map((doc, idx) => {
              const normalizedType = String(doc.type || "documento").toLowerCase();
              const docUrl = resolveDocumentUrl(doc);
              const reasonOptions = getReasonOptions(normalizedType);
              const currentReasonSelection = selectedRejectionReasons[normalizedType] || "";

              return (
                <article className="card" key={`${doc.type}-${idx}`}>
                  <h2>{resolveDocumentLabel(doc.type)}</h2>
                  <p>
                    Status: <span className={documentStatusTone(doc)}>{formatDocumentStatus(doc)}</span>
                  </p>
                  {doc.fileName ? <p>Arquivo: {doc.fileName}</p> : null}
                  {doc.uploadedAt ? <p>Enviado em: {new Date(doc.uploadedAt).toLocaleString("pt-BR")}</p> : null}
                  {doc.requestedAt ? <p>Solicitado em: {formatDateTime(doc.requestedAt)}</p> : null}
                  {doc.requestReason ? <p>Motivo da solicitação: {doc.requestReason}</p> : null}
                  {doc.rejectionReason ? <p className="error">{doc.rejectionReason}</p> : null}

                  {reasonOptions.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <label>
                        Motivo padrão de rejeição
                        <select
                          value={currentReasonSelection}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setSelectedRejectionReasons((prev) => ({
                              ...prev,
                              [normalizedType]: nextValue,
                            }));
                          }}
                        >
                          <option value="">Selecione um motivo</option>
                          {reasonOptions.map((reason) => (
                            <option key={reason} value={reason}>
                              {reason}
                            </option>
                          ))}
                          <option value="__custom__">Outro motivo (digitar)</option>
                        </select>
                      </label>
                      {currentReasonSelection === "__custom__" ? (
                        <label className="field-stack" style={{ marginTop: 10 }}>
                          Motivo personalizado
                          <textarea
                            rows={3}
                            value={customRejectionReasons[normalizedType] || ""}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setCustomRejectionReasons((prev) => ({
                                ...prev,
                                [normalizedType]: nextValue,
                              }));
                            }}
                            placeholder="Descreva o motivo para auditoria."
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="filters">
                    <button
                      type="button"
                      disabled={!docUrl}
                      onClick={() => {
                        if (!docUrl) return;
                        window.open(docUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      {docUrl ? "Visualizar documento" : "Sem arquivo para visualizar"}
                    </button>
                    <button
                      disabled={reviewingType === normalizedType || busy}
                      onClick={() => reviewSingle(normalizedType, "approve")}
                    >
                      Aprovar doc
                    </button>
                    <button
                      disabled={reviewingType === normalizedType || busy}
                      onClick={() => reviewSingle(normalizedType, "reject")}
                    >
                      Rejeitar doc
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>

        {applicationDecisionModal ? (
          <div className="admin-modal-backdrop" role="presentation">
            <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="driver-decision-title">
              <div className="admin-modal-head">
                <div>
                  <h2 id="driver-decision-title">
                    {applicationDecisionModal.action === "approve" ? "Aprovar motorista" : "Rejeitar motorista"}
                  </h2>
                  <p>
                    {applicationDecisionModal.action === "approve"
                      ? "Registre a nota operacional antes de liberar o cadastro."
                      : "Informe o motivo de rejeição para auditoria e histórico do cadastro."}
                  </p>
                </div>
                <button type="button" onClick={closeApplicationDecisionModal} disabled={busy}>
                  Fechar
                </button>
              </div>
              <div className="admin-modal-body">
                <label className="field-stack">
                  {applicationDecisionModal.action === "approve" ? "Nota de aprovação" : "Motivo da rejeição"}
                  <textarea
                    rows={4}
                    value={applicationDecisionReason}
                    onChange={(event) => setApplicationDecisionReason(event.target.value)}
                    placeholder={
                      applicationDecisionModal.action === "approve"
                        ? "Ex.: aprovado pelo dashboard Leaf após revisão de documentos."
                        : "Ex.: documento incompatível com o cadastro enviado."
                    }
                  />
                </label>
              </div>
              <div className="admin-modal-actions">
                <button type="button" onClick={closeApplicationDecisionModal} disabled={busy}>
                  Cancelar
                </button>
                <button type="button" onClick={submitApplicationDecisionModal} disabled={busy || !applicationDecisionReason.trim()}>
                  {busy ? "Salvando..." : applicationDecisionModal.action === "approve" ? "Confirmar aprovação" : "Confirmar rejeição"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    </ProtectedRoute>
  );
}
