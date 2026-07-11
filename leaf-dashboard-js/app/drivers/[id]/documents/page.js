"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";

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

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocumentRequestMessage(result) {
  if (result?.push?.success) return "Atualização solicitada e push enviado ao motorista.";
  if (result?.push?.skipped) return "Atualização solicitada sem envio de push.";
  return "Atualização solicitada; o backend não confirmou a entrega do push.";
}

export default function DriverDocumentsPage({ params }) {
  const resolvedParams = use(params);
  const id = String(resolvedParams?.id || "").trim();
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [reviewingType, setReviewingType] = useState(null);
  const [requestingDocumentType, setRequestingDocumentType] = useState(null);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [uploadingBackgroundDoc, setUploadingBackgroundDoc] = useState(false);
  const [backgroundDocFile, setBackgroundDocFile] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [rejectionReasonDraft, setRejectionReasonDraft] = useState("");
  const [documentRequestReasonDraft, setDocumentRequestReasonDraft] = useState("");
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

  const requestDocumentReview = (doc, action) => {
    const normalizedType = normalizeDocumentType(doc?.type);
    if (!normalizedType) return;
    setError("");
    setActionMessage("");
    setRejectionReasonDraft("");
    setPendingAction({
      type: "document-review",
      action,
      documentType: normalizedType,
      doc,
    });
  };

  const reviewSingle = async (documentType, action, reason = "") => {
    const normalizedType = String(documentType || "").toLowerCase();
    const normalizedReason = String(reason || "").trim();

    if (action === "reject" && !normalizedReason) {
      setError("Informe o motivo da rejeição antes de confirmar.");
      return;
    }

    try {
      setError("");
      setActionMessage("");
      setReviewingType(normalizedType);
      await leafAPI.reviewDriverDocument(id, normalizedType, action, normalizedReason);
      setActionMessage(
        `${resolveDocumentLabel(normalizedType)} ${action === "approve" ? "aprovado" : "rejeitado"} com sucesso.`,
      );
      await load();
      setPendingAction(null);
      setRejectionReasonDraft("");
    } catch (err) {
      setError(err?.message || "Falha ao revisar documento");
    } finally {
      setReviewingType(null);
    }
  };

  const requestDocumentUpdate = (doc) => {
    const documentType = normalizeDocumentType(doc?.type);
    if (!documentType) return;
    const defaultReason = doc?.rejectionReason || doc?.requestReason ||
      "Precisamos que você envie uma versão atualizada deste documento no app.";
    setError("");
    setActionMessage("");
    setDocumentRequestReasonDraft(defaultReason);
    setPendingAction({
      type: "document-request",
      documentType,
      doc,
    });
  };

  const sendDocumentUpdateRequest = async (documentType, reason) => {
    const normalizedType = normalizeDocumentType(documentType);
    const normalizedReason = String(reason || "").trim();
    if (!normalizedType || !normalizedReason) {
      setError("Informe a mensagem que será enviada ao motorista.");
      return;
    }

    try {
      setRequestingDocumentType(normalizedType);
      setError("");
      setActionMessage("");
      const result = await leafAPI.requestDriverDocument(id, normalizedType, {
        reason: normalizedReason,
        sendPush: true,
      });
      setActionMessage(formatDocumentRequestMessage(result));
      await load();
      setPendingAction(null);
      setDocumentRequestReasonDraft("");
    } catch (err) {
      setError(err?.message || "Falha ao solicitar atualização do documento");
    } finally {
      setRequestingDocumentType(null);
    }
  };

  const requestVehicleConfigSave = () => {
    if (!vehicleForm.userVehicleId) {
      setError("Selecione um veículo para configurar.");
      return;
    }

    const selectedVehicle = vehicleList.find((vehicle) => vehicle.userVehicleId === vehicleForm.userVehicleId) || null;
    setError("");
    setActionMessage("");
    setPendingAction({
      type: "vehicle-config",
      vehicle: selectedVehicle,
      payload: {
        userVehicleId: vehicleForm.userVehicleId,
        category: vehicleForm.category,
        vehicleStatus: vehicleForm.vehicleStatus,
        setActive: vehicleForm.setActive,
        acceptPlusWithElite: vehicleForm.acceptPlusWithElite,
      },
    });
  };

  const saveVehicleConfig = async (payload) => {
    try {
      setVehicleBusy(true);
      setError("");
      setActionMessage("");
      await leafAPI.updateDriverVehicleConfig(id, payload);
      setActionMessage("Configuração de veículo atualizada.");
      await load();
      setPendingAction(null);
    } catch (err) {
      setError(err?.message || "Falha ao atualizar configuração de veículo");
    } finally {
      setVehicleBusy(false);
    }
  };

  const requestBackgroundDocumentUpload = () => {
    if (!backgroundDocFile) {
      setError("Selecione um arquivo PDF para anexar a certidão de antecedentes.");
      return;
    }

    setError("");
    setActionMessage("");
    setPendingAction({
      type: "background-upload",
      file: backgroundDocFile,
    });
  };

  const uploadBackgroundDocument = async (file) => {
    try {
      setUploadingBackgroundDoc(true);
      setError("");
      setActionMessage("");
      await leafAPI.uploadDriverDocument(id, "antecedentes_criminais", file);
      setBackgroundDocFile(null);
      setActionMessage("Certidão de antecedentes anexada com sucesso.");
      await load();
      setPendingAction(null);
    } catch (err) {
      setError(err?.message || "Falha ao anexar certidão de antecedentes");
    } finally {
      setUploadingBackgroundDoc(false);
    }
  };

  const confirmPendingAction = () => {
    if (pendingAction?.type === "document-review") {
      const reason = pendingAction.action === "reject" ? rejectionReasonDraft : "";
      reviewSingle(pendingAction.documentType, pendingAction.action, reason);
      return;
    }
    if (pendingAction?.type === "document-request") {
      sendDocumentUpdateRequest(pendingAction.documentType, documentRequestReasonDraft);
      return;
    }
    if (pendingAction?.type === "vehicle-config") {
      saveVehicleConfig(pendingAction.payload);
      return;
    }
    if (pendingAction?.type === "background-upload") {
      uploadBackgroundDocument(pendingAction.file);
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
  const documentsRequiringAttention = docsList.filter((doc) => {
    const status = resolveDocumentStatus(doc);
    return status !== "approved" || isDocumentRequested(doc);
  }).length;
  const mutationBusy = Boolean(reviewingType) || Boolean(requestingDocumentType) || vehicleBusy || uploadingBackgroundDoc;
  const pendingDocument = ["document-review", "document-request"].includes(pendingAction?.type)
    ? pendingAction.doc
    : null;
  const pendingDocumentAction = pendingAction?.type === "document-review" ? pendingAction.action : "";
  const pendingVehicle = pendingAction?.type === "vehicle-config" ? pendingAction.vehicle : null;
  const pendingDialogBusy = pendingAction?.type === "document-review"
    ? Boolean(reviewingType)
    : pendingAction?.type === "document-request"
      ? Boolean(requestingDocumentType)
    : pendingAction?.type === "vehicle-config"
      ? vehicleBusy
      : uploadingBackgroundDoc;
  const pendingDialogTone = pendingAction?.type === "document-review" && pendingDocumentAction === "approve"
    ? "warning"
    : ["background-upload", "document-request"].includes(pendingAction?.type)
      ? "warning"
      : "danger";
  const pendingDialogTitle = pendingAction?.type === "document-review"
    ? `${pendingDocumentAction === "approve" ? "Aprovar" : "Rejeitar"} ${resolveDocumentLabel(pendingAction.documentType)}`
    : pendingAction?.type === "document-request"
      ? `Solicitar ${resolveDocumentLabel(pendingAction.documentType)}`
    : pendingAction?.type === "vehicle-config"
      ? "Confirmar veículo e categoria"
      : "Confirmar anexo da certidão";
  const pendingDialogDescription = pendingAction?.type === "document-review"
    ? "Revise o motorista, o arquivo e a consequência desta decisão documental."
    : pendingAction?.type === "document-request"
      ? "Revise a mensagem antes de solicitar uma nova versão pelo app e tentar notificar o motorista."
    : pendingAction?.type === "vehicle-config"
      ? "Esta alteração muda a configuração operacional usada pelo perfil do motorista."
      : "O PDF será anexado à ficha e seguirá para revisão; o upload não aprova o documento.";
  const pendingConfirmLabel = pendingAction?.type === "document-review"
    ? pendingDocumentAction === "approve" ? "Confirmar aprovação" : "Confirmar rejeição"
    : pendingAction?.type === "document-request"
      ? "Solicitar atualização"
    : pendingAction?.type === "vehicle-config"
      ? "Salvar configuração"
      : "Anexar documento";

  return (
    <ProtectedRoute>
      <main className="page-shell">
        <header className="header">
          <h1>Documentos do Motorista</h1>
          <div className="filters">
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
              kycStatus,
              kycBloqueado: kyc.blocked || false,
              kycNeedsReview: kyc.needsReview || false,
              documentosAtencao: documentsRequiringAttention,
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
              kycStatus: "Status KYC",
              kycBloqueado: "KYC bloqueado",
              kycNeedsReview: "KYC precisa revisão",
              documentosAtencao: "Documentos que exigem atenção",
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

        <details className="driver-background-disclosure">
          <summary>
            Certidão de antecedentes · {formatDocumentStatus(backgroundCheckDoc || {})}
          </summary>
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
            <button
              type="button"
              onClick={requestBackgroundDocumentUpload}
              disabled={mutationBusy || !backgroundDocFile}
            >
              {uploadingBackgroundDoc ? "Enviando..." : "Anexar certidão (PDF)"}
            </button>
          </div>
          <p className="text-muted" style={{ marginTop: 8 }}>
            Documento anexado aqui fica disponível para revisão junto com CNH/CRLV.
          </p>
          </section>
        </details>

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

        <details className="driver-vehicle-disclosure">
          <summary>
            Veículo e categoria · {vehicleForm.category} · {vehicleForm.vehicleStatus}
          </summary>
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
                <button type="button" onClick={requestVehicleConfigSave} disabled={mutationBusy}>
                  {vehicleBusy ? "Salvando..." : "Salvar Configuração"}
                </button>
              </div>
            </div>
          )}
          </section>
        </details>

        <details className="driver-documents-disclosure" open>
          <summary>Documentos operacionais · {documentsRequiringAttention} exigindo atenção</summary>
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
              const docUrl = resolveDocumentUrl(doc);

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

                  <div className="filters">
                    <button
                      type="button"
                      className="primary-action"
                      disabled={!docUrl}
                      onClick={() => {
                        if (!docUrl) return;
                        window.open(docUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      {docUrl ? "Visualizar documento" : "Sem arquivo para visualizar"}
                    </button>
                    <details className="driver-document-actions-disclosure">
                      <summary>Decidir sobre o documento</summary>
                      <div>
                        <button
                          type="button"
                          disabled={mutationBusy}
                          onClick={() => requestDocumentReview(doc, "approve")}
                        >
                          Aprovar documento
                        </button>
                        <button
                          type="button"
                          className="button-danger"
                          disabled={mutationBusy}
                          onClick={() => requestDocumentReview(doc, "reject")}
                        >
                          Rejeitar documento
                        </button>
                        <button
                          type="button"
                          disabled={mutationBusy}
                          onClick={() => requestDocumentUpdate(doc)}
                        >
                          Solicitar atualização
                        </button>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })
          )}
          </section>
        </details>

        <ConfirmActionDialog
          open={Boolean(pendingAction)}
          title={pendingDialogTitle}
          description={pendingDialogDescription}
          confirmLabel={pendingConfirmLabel}
          tone={pendingDialogTone}
          busy={pendingDialogBusy}
          onConfirm={confirmPendingAction}
          onCancel={() => {
            setPendingAction(null);
            setRejectionReasonDraft("");
            setDocumentRequestReasonDraft("");
            setError("");
          }}
        >
          {pendingAction?.type === "document-review" ? (
            <div className="section-stack">
              <KeyValueGrid
                data={{
                  motorista: documents?.driver?.name || id,
                  motoristaId: documents?.driver?.id || id,
                  documento: resolveDocumentLabel(pendingAction.documentType),
                  arquivo: pendingDocument?.fileName || (resolveDocumentUrl(pendingDocument || {}) ? "arquivo disponível" : "arquivo não informado"),
                  statusAtual: formatDocumentStatus(pendingDocument || {}),
                }}
                labels={{
                  motorista: "Motorista",
                  motoristaId: "ID do motorista",
                  documento: "Documento revisado",
                  arquivo: "Arquivo revisado",
                  statusAtual: "Status atual",
                }}
                maxItems={5}
              />
              <p>
                <strong>Consequência:</strong>{" "}
                {pendingDocumentAction === "approve"
                  ? "Registra somente este documento como aprovado. Elegibilidade e KYC continuam governados pelo backend."
                  : "Registra este documento como rejeitado com o motivo informado. Elegibilidade e KYC continuam governados pelo backend."}
              </p>
              {pendingDocumentAction === "reject" ? (
                <div className="section-stack">
                  {getReasonOptions(pendingAction.documentType).length > 0 ? (
                    <label className="form-field">
                      Motivo sugerido
                      <select
                        value={getReasonOptions(pendingAction.documentType).includes(rejectionReasonDraft) ? rejectionReasonDraft : ""}
                        onChange={(event) => setRejectionReasonDraft(event.target.value)}
                      >
                        <option value="">Escolha um motivo ou escreva abaixo</option>
                        {getReasonOptions(pendingAction.documentType).map((reason) => (
                          <option key={reason} value={reason}>{reason}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="form-field">
                    Motivo obrigatório da rejeição
                    <textarea
                      rows={4}
                      value={rejectionReasonDraft}
                      onChange={(event) => setRejectionReasonDraft(event.target.value)}
                      placeholder="Explique objetivamente o que precisa ser corrigido."
                      required
                      aria-required="true"
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {pendingAction?.type === "document-request" ? (
            <div className="section-stack">
              <KeyValueGrid
                data={{
                  motorista: documents?.driver?.name || id,
                  motoristaId: documents?.driver?.id || id,
                  documento: resolveDocumentLabel(pendingAction.documentType),
                  statusAtual: formatDocumentStatus(pendingDocument || {}),
                  canal: "App do motorista + tentativa de push",
                }}
                labels={{
                  motorista: "Motorista",
                  motoristaId: "ID do motorista",
                  documento: "Documento solicitado",
                  statusAtual: "Status atual",
                  canal: "Canal",
                }}
                maxItems={5}
              />
              <label className="form-field">
                Mensagem obrigatória para o motorista
                <textarea
                  rows={4}
                  value={documentRequestReasonDraft}
                  onChange={(event) => setDocumentRequestReasonDraft(event.target.value)}
                  placeholder="Explique objetivamente qual documento precisa ser enviado ou corrigido."
                  required
                  aria-required="true"
                />
              </label>
              <p>
                <strong>Consequência:</strong> abre uma solicitação de atualização e tenta notificar o motorista;
                não aprova, rejeita ou altera a política KYC.
              </p>
            </div>
          ) : null}

          {pendingAction?.type === "vehicle-config" ? (
            <KeyValueGrid
              data={{
                motorista: documents?.driver?.name || id,
                veiculo: pendingVehicle
                  ? `${pendingVehicle.plate || "Sem placa"} · ${pendingVehicle.brand || "-"} ${pendingVehicle.model || ""}`
                  : pendingAction.payload?.userVehicleId || "-",
                categoria: pendingAction.payload?.category || "-",
                status: pendingAction.payload?.vehicleStatus || "-",
                ativarNoPerfil: pendingAction.payload?.setActive ? "sim" : "não",
                eliteRecebePlus: pendingAction.payload?.acceptPlusWithElite ? "sim" : "não",
              }}
              labels={{
                motorista: "Motorista",
                veiculo: "Veículo",
                categoria: "Categoria",
                status: "Status resultante",
                ativarNoPerfil: "Ativar no perfil",
                eliteRecebePlus: "Elite recebe Plus",
              }}
              maxItems={6}
            />
          ) : null}

          {pendingAction?.type === "vehicle-config" ? (
            <p>
              <strong>Consequência:</strong> Atualiza veículo, categoria e disponibilidade configurada; o backend
              mantém as guardas de trabalho e KYC.
            </p>
          ) : null}

          {pendingAction?.type === "background-upload" ? (
            <KeyValueGrid
              data={{
                motorista: documents?.driver?.name || id,
                documento: "Certidão de antecedentes",
                arquivo: pendingAction.file?.name || "-",
                tamanho: formatFileSize(pendingAction.file?.size),
              }}
              labels={{
                motorista: "Motorista",
                documento: "Documento",
                arquivo: "Arquivo",
                tamanho: "Tamanho",
              }}
              maxItems={4}
            />
          ) : null}

          {pendingAction?.type === "background-upload" ? (
            <p>
              <strong>Consequência:</strong> Anexa o PDF à ficha para revisão. O upload não aprova a certidão nem
              altera a política KYC.
            </p>
          ) : null}

          {pendingAction && error ? <p className="error">{error}</p> : null}
        </ConfirmActionDialog>

        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    </ProtectedRoute>
  );
}
