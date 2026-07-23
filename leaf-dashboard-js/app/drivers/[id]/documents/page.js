"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/src/components/ProtectedRoute";
import AppNav from "@/src/components/AppNav";
import { leafAPI } from "@/src/services/api";
import { KeyValueGrid, TechnicalDetails } from "@/src/components/ui/DataViews";
import ConfirmActionDialog from "@/src/components/ui/ConfirmActionDialog";
import KycIdentityReviewPanel from "@/src/components/kyc/KycIdentityReviewPanel";

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
const MIN_IDENTITY_RECONCILIATION_REASON_LENGTH = 20;
const MIN_ORPHAN_RECOVERY_REASON_LENGTH = 20;
const ORPHAN_RECOVERY_CONFIRMATION_PHRASE = "AUTORIZAR NOVA VALIDAÇÃO";

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

function hasDocumentStorageBinding(doc) {
  return doc?.contentAvailable === true;
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

function isValidCivilDate(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function formatDateOnly(value) {
  if (!value) return "-";

  const raw = String(value).trim();
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  const brDate = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  const parts = isoDate
    ? { year: Number(isoDate[1]), month: Number(isoDate[2]), day: Number(isoDate[3]) }
    : brDate
      ? { year: Number(brDate[3]), month: Number(brDate[2]), day: Number(brDate[1]) }
      : null;

  if (!parts || !isValidCivilDate(parts.year, parts.month, parts.day)) return "-";

  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
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

function getSupportTicketId(ticket = {}) {
  return String(ticket.id || ticket.ticketId || "").trim();
}

function listPendingIdentityReviewTickets(response, driverId) {
  const payload = response?.data || response || {};
  const tickets = Array.isArray(payload?.tickets) ? payload.tickets : [];
  const safeDriverId = String(driverId || "").trim();
  return tickets.filter((ticket) => {
    const metadata = ticket?.metadata || {};
    const ticketDriverId = String(ticket?.userId || ticket?.user?.id || "").trim();
    return getSupportTicketId(ticket) &&
      (!ticketDriverId || ticketDriverId === safeDriverId) &&
      String(metadata.identityReviewLinkStatus || "").trim().toLowerCase() === "pending" &&
      Boolean(String(metadata.kycEvidenceId || "").trim());
  });
}

export default function DriverDocumentsPage({ params }) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const id = String(resolvedParams?.id || "").trim();
  const kycPersistenceScope = String(searchParams.get("kycScope") || "")
    .trim()
    .toLowerCase() === "sandbox"
    ? "sandbox"
    : "operational";
  const kycRequestContext = useMemo(
    () => ({ scope: kycPersistenceScope }),
    [kycPersistenceScope],
  );
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [reviewingType, setReviewingType] = useState(null);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [uploadingBackgroundDoc, setUploadingBackgroundDoc] = useState(false);
  const [backgroundDocFile, setBackgroundDocFile] = useState(null);
  const [openingDocumentType, setOpeningDocumentType] = useState("");
  const [selectedRejectionReasons, setSelectedRejectionReasons] = useState({});
  const [showRatingReviews, setShowRatingReviews] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [docStatusFilter, setDocStatusFilter] = useState("all");
  const [identityReviews, setIdentityReviews] = useState([]);
  const [selectedIdentityReviewId, setSelectedIdentityReviewId] = useState("");
  const [identityReviewBusy, setIdentityReviewBusy] = useState("");
  const [identityReviewError, setIdentityReviewError] = useState("");
  const [identityEvidenceUrls, setIdentityEvidenceUrls] = useState({ cnh: "", selfie: "" });
  const [pendingIdentityReviewTickets, setPendingIdentityReviewTickets] = useState([]);
  const [selectedPendingIdentityTicketId, setSelectedPendingIdentityTicketId] = useState("");
  const [identityReconciliationReason, setIdentityReconciliationReason] = useState("");
  const [identityReconciliationBusy, setIdentityReconciliationBusy] = useState(false);
  const [identityReconciliationError, setIdentityReconciliationError] = useState("");
  const [orphanRecoveryCandidate, setOrphanRecoveryCandidate] = useState(null);
  const [orphanRecoveryReason, setOrphanRecoveryReason] = useState("");
  const [orphanRecoveryConfirmation, setOrphanRecoveryConfirmation] = useState("");
  const [orphanRecoveryDialogOpen, setOrphanRecoveryDialogOpen] = useState(false);
  const [orphanRecoveryBusy, setOrphanRecoveryBusy] = useState(false);
  const [orphanRecoveryError, setOrphanRecoveryError] = useState("");
  const [vehicleForm, setVehicleForm] = useState({
    userVehicleId: "",
    category: "plus",
    vehicleStatus: "approved",
    setActive: true,
    acceptPlusWithElite: true,
  });

  const busy = Boolean(reviewingType) || vehicleBusy || uploadingBackgroundDoc;

  const load = async () => {
    if (!id) return;
    const response = await leafAPI.getDriverDocuments(id, kycRequestContext);
    setDocuments(response?.data || response);
  };

  const loadIdentityReviews = async () => {
    if (!id) return;
    const response = await leafAPI.getDriverKycIdentityReviews(id, kycRequestContext);
    const payload = response?.data || response || {};
    setIdentityReviews(Array.isArray(payload?.cases) ? payload.cases : []);
    setOrphanRecoveryCandidate(
      payload?.orphanRecoveryCandidate?.available === true
        ? payload.orphanRecoveryCandidate
        : null,
    );
    setIdentityReviewError("");
  };

  const openDriverDocument = async (documentType) => {
    const normalizedType = String(documentType || "").trim().toLowerCase();
    if (!id || !OPERATIONAL_DOCUMENT_TYPES.has(normalizedType)) return;

    try {
      setOpeningDocumentType(normalizedType);
      setError("");
      const file = await leafAPI.getDriverDocumentFile(id, normalizedType, kycRequestContext);
      const objectUrl = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      setError(err?.message || "Não foi possível abrir o documento agora.");
    } finally {
      setOpeningDocumentType("");
    }
  };

  const loadPendingIdentityReviewTickets = async () => {
    if (!id) return;
    const response = await leafAPI.getSupportTickets(
      { userId: id, limit: 100 },
      kycRequestContext,
    );
    const pendingTickets = listPendingIdentityReviewTickets(response, id);
    setPendingIdentityReviewTickets(pendingTickets);
    setSelectedPendingIdentityTicketId((current) => (
      pendingTickets.some((ticket) => getSupportTicketId(ticket) === current)
        ? current
        : getSupportTicketId(pendingTickets[0])
    ));
    setIdentityReconciliationError("");
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!id) return;
      try {
        const [documentsResult, reviewsResult, pendingTicketsResult] = await Promise.allSettled([
          leafAPI.getDriverDocuments(id, kycRequestContext),
          leafAPI.getDriverKycIdentityReviews(id, kycRequestContext),
          leafAPI.getSupportTickets(
            { userId: id, limit: 100 },
            kycRequestContext,
          ),
        ]);
        if (!mounted) return;
        if (documentsResult.status === "rejected") throw documentsResult.reason;
        setDocuments(documentsResult.value?.data || documentsResult.value);
        if (reviewsResult.status === "fulfilled") {
          const reviewPayload = reviewsResult.value?.data || reviewsResult.value || {};
          setIdentityReviews(Array.isArray(reviewPayload?.cases) ? reviewPayload.cases : []);
          setOrphanRecoveryCandidate(
            reviewPayload?.orphanRecoveryCandidate?.available === true
              ? reviewPayload.orphanRecoveryCandidate
              : null,
          );
        } else {
          setIdentityReviewError(reviewsResult.reason?.message || "Falha ao carregar casos de identidade");
        }
        if (pendingTicketsResult.status === "fulfilled") {
          const pendingTickets = listPendingIdentityReviewTickets(pendingTicketsResult.value, id);
          setPendingIdentityReviewTickets(pendingTickets);
          setSelectedPendingIdentityTicketId(getSupportTicketId(pendingTickets[0]));
        } else {
          setIdentityReconciliationError(
            pendingTicketsResult.reason?.message || "Falha ao verificar chamados KYC pendentes",
          );
        }
      } catch (err) {
        if (mounted) setError(err?.message || "Falha ao carregar documentos");
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [id, kycRequestContext]);

  useEffect(() => () => {
    Object.values(identityEvidenceUrls).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }, [identityEvidenceUrls]);

  useEffect(() => {
    if (identityReviews.length === 0) {
      setSelectedIdentityReviewId("");
      return;
    }
    if (!identityReviews.some((item) => item?.caseId === selectedIdentityReviewId)) {
      setSelectedIdentityReviewId(identityReviews[0]?.caseId || "");
    }
  }, [identityReviews, selectedIdentityReviewId]);

  useEffect(() => {
    setIdentityEvidenceUrls({ cnh: "", selfie: "" });
  }, [selectedIdentityReviewId]);

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

  const resolveRejectionReason = (documentType) => {
    const selected = String(selectedRejectionReasons?.[documentType] || "").trim();
    if (selected && selected !== "__custom__") {
      return selected;
    }

    const options = getReasonOptions(documentType);
    if (options.length > 0 && !selected) {
      return "";
    }

    const customReason = window.prompt("Motivo da rejeição:");
    return String(customReason || "").trim();
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
      await leafAPI.reviewDriverDocument(
        id,
        normalizedType,
        action,
        reason || "",
        kycRequestContext,
      );
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
      await leafAPI.uploadDriverDocument(
        id,
        "antecedentes_criminais",
        backgroundDocFile,
        kycRequestContext,
      );
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
  const backgroundCheckDoc = docsList.find(
    (doc) => String(doc?.type || "").trim().toLowerCase() === "antecedentes_criminais",
  ) || documents?.documents?.backgroundCheck || null;
  const backgroundCheckAvailable = hasDocumentStorageBinding(backgroundCheckDoc || {});

  const selectedIdentityReview = identityReviews.find(
    (item) => item?.caseId === selectedIdentityReviewId,
  ) || identityReviews[0] || null;
  const selectedIdentityEvidence = selectedIdentityReview?.evidence ||
    selectedIdentityReview?.evidenceSummary || {};
  const selectedPendingIdentityTicket = pendingIdentityReviewTickets.find(
    (ticket) => getSupportTicketId(ticket) === selectedPendingIdentityTicketId,
  ) || pendingIdentityReviewTickets[0] || null;

  const authorizeOrphanHoldRecovery = async () => {
    const reason = orphanRecoveryReason.trim();
    const candidate = orphanRecoveryCandidate;
    if (
      !candidate?.failureEvidenceId ||
      !candidate?.expectedStateRevision ||
      !candidate?.expectedRevokedAt ||
      reason.length < MIN_ORPHAN_RECOVERY_REASON_LENGTH ||
      orphanRecoveryConfirmation !== ORPHAN_RECOVERY_CONFIRMATION_PHRASE
    ) {
      setOrphanRecoveryError("Revise a justificativa e digite a frase de confirmação exatamente como exibida.");
      return;
    }

    try {
      setOrphanRecoveryBusy(true);
      setOrphanRecoveryError("");
      const response = await leafAPI.authorizeDriverKycOrphanHoldRecovery(id, {
        failureEvidenceId: candidate.failureEvidenceId,
        expectedStateRevision: candidate.expectedStateRevision,
        expectedRevokedAt: candidate.expectedRevokedAt,
        reason,
        explicitRecovery: true,
      }, kycRequestContext);
      const recovery = response?.data?.recovery || response?.recovery || null;
      setOrphanRecoveryCandidate(null);
      setOrphanRecoveryReason("");
      setOrphanRecoveryConfirmation("");
      setOrphanRecoveryDialogOpen(false);
      setActionMessage(
        recovery?.expiresAt
          ? `Nova validação única autorizada até ${formatDateTime(recovery.expiresAt)}.`
          : "Nova validação única autorizada. O motorista já pode iniciar uma nova tentativa.",
      );
      try {
        await loadIdentityReviews();
      } catch {
        setOrphanRecoveryError(
          "A autorização foi concluída, mas o painel não conseguiu atualizar o estado. Recarregue a página.",
        );
      }
    } catch (err) {
      setOrphanRecoveryError(err?.message || "Não foi possível autorizar a nova validação");
    } finally {
      setOrphanRecoveryBusy(false);
    }
  };

  const reconcileIdentityReviewTicket = async () => {
    const ticketId = getSupportTicketId(selectedPendingIdentityTicket);
    const evidenceId = String(selectedPendingIdentityTicket?.metadata?.kycEvidenceId || "").trim();
    const reason = identityReconciliationReason.trim();
    if (!ticketId || !evidenceId || reason.length < MIN_IDENTITY_RECONCILIATION_REASON_LENGTH) return;

    try {
      setIdentityReconciliationBusy(true);
      setIdentityReconciliationError("");
      const response = await leafAPI.reconcileDriverKycIdentityReview(id, {
        ticketId,
        evidenceId,
        reason,
      }, kycRequestContext);
      const reconciledCase = response?.data?.case || response?.case || null;
      setPendingIdentityReviewTickets((current) => (
        current.filter((ticket) => getSupportTicketId(ticket) !== ticketId)
      ));
      setSelectedPendingIdentityTicketId("");
      setIdentityReconciliationReason("");
      if (reconciledCase?.caseId) {
        setSelectedIdentityReviewId(reconciledCase.caseId);
      }
      setActionMessage("Chamado KYC vinculado ao caso de revisão de identidade.");

      const refreshResults = await Promise.allSettled([
        loadIdentityReviews(),
        loadPendingIdentityReviewTickets(),
      ]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        setIdentityReconciliationError(
          "O vínculo foi concluído, mas o painel não conseguiu atualizar todos os dados. Recarregue a página.",
        );
      }
    } catch (err) {
      setIdentityReconciliationError(err?.message || "Falha ao vincular chamado KYC ao caso");
    } finally {
      setIdentityReconciliationBusy(false);
    }
  };

  const loadIdentityEvidence = async ({ ticketId, justification }) => {
    if (!selectedIdentityReview?.caseId) return;
    try {
      setIdentityReviewBusy("load_evidence");
      setIdentityReviewError("");
      const context = {
        ticketId,
        justification,
        evidenceBindingHash: selectedIdentityReview.evidenceBindingHash,
        scope: kycPersistenceScope,
      };
      const [cnhFile, selfieFile] = await Promise.all([
        leafAPI.getDriverKycIdentityEvidence(id, selectedIdentityReview.caseId, "cnh", context),
        leafAPI.getDriverKycIdentityEvidence(id, selectedIdentityReview.caseId, "selfie", context),
      ]);
      setIdentityEvidenceUrls({
        cnh: URL.createObjectURL(cnhFile.blob),
        selfie: URL.createObjectURL(selfieFile.blob),
      });
    } catch (err) {
      setIdentityReviewError(err?.message || "Falha ao carregar evidências restritas");
    } finally {
      setIdentityReviewBusy("");
    }
  };

  const startIdentityReview = async ({ ticketId, justification }) => {
    if (!selectedIdentityReview?.caseId) return;
    try {
      setIdentityReviewBusy("start_review");
      setIdentityReviewError("");
      await leafAPI.startDriverKycIdentityReview(id, selectedIdentityReview.caseId, {
        ticketId,
        reason: justification,
        evidenceBindingHash: selectedIdentityReview.evidenceBindingHash,
      }, kycRequestContext);
      setActionMessage("Análise de identidade iniciada e auditada.");
      try {
        await loadIdentityReviews();
      } catch {
        setIdentityReviewError(
          "A análise foi iniciada, mas o painel não conseguiu atualizar o caso. Recarregue a página.",
        );
      }
    } catch (err) {
      setIdentityReviewError(err?.message || "Falha ao iniciar análise de identidade");
    } finally {
      setIdentityReviewBusy("");
    }
  };

  const decideIdentityReview = async (decision, {
    ticketId,
    justification,
    confirmationPhrase = "",
  }) => {
    if (!selectedIdentityReview?.caseId) return;
    const busyAction = decision === "CONFIRMED_FRAUD" ? "permanent_block" : "authorize_retry";
    try {
      setIdentityReviewBusy(busyAction);
      setIdentityReviewError("");
      await leafAPI.decideDriverKycIdentityReview(id, selectedIdentityReview.caseId, {
        ticketId,
        reason: justification,
        evidenceBindingHash: selectedIdentityReview.evidenceBindingHash,
        decision,
        explicitDecision: true,
        confirmPermanentBlock: decision === "CONFIRMED_FRAUD",
        confirmationPhrase,
      }, kycRequestContext);
      setActionMessage(
        decision === "CONFIRMED_FRAUD"
          ? "Fraude confirmada e bloqueio permanente aplicado."
          : "Falso positivo registrado; uma nova tentativa limpa foi autorizada.",
      );
      const refreshResults = await Promise.allSettled([load(), loadIdentityReviews()]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        setIdentityReviewError(
          "A decisão foi concluída, mas o painel não conseguiu atualizar todos os dados. Recarregue a página.",
        );
      }
    } catch (err) {
      setIdentityReviewError(err?.message || "Falha ao concluir análise de identidade");
    } finally {
      setIdentityReviewBusy("");
    }
  };

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
              if (key === "dataNascimento") {
                return formatDateOnly(value);
              }

              if (key === "dataCadastro") {
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
              disabled={!backgroundCheckAvailable || openingDocumentType === "antecedentes_criminais"}
              onClick={() => openDriverDocument("antecedentes_criminais")}
            >
              {openingDocumentType === "antecedentes_criminais"
                ? "Abrindo..."
                : backgroundCheckAvailable
                  ? "Visualizar certidão atual"
                  : "Sem certidão anexada"}
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
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>KYC (Onboarding + Diário)</h2>
            <span className={kycPersistenceScope === "sandbox" ? "status-warn" : "status-ok"}>
              {kycPersistenceScope === "sandbox" ? "Sandbox KYC" : "Operacional"}
            </span>
            <Link
              href={kycPersistenceScope === "sandbox"
                ? `/drivers/${encodeURIComponent(id)}/documents`
                : `/drivers/${encodeURIComponent(id)}/documents?kycScope=sandbox`}
            >
              {kycPersistenceScope === "sandbox" ? "Voltar ao KYC operacional" : "Abrir KYC sandbox"}
            </Link>
          </div>
          {kycPersistenceScope === "sandbox" ? (
            <p className="text-muted" style={{ marginTop: 6 }}>
              Evidências, casos e decisões desta visualização ficam isolados do ambiente operacional.
            </p>
          ) : null}
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

        {orphanRecoveryCandidate ? (
          <section className="card" aria-labelledby="orphan-identity-recovery-title">
            <div className="section-stack">
              <div>
                <span className="status-warn">Ação administrativa disponível</span>
                <h2 id="orphan-identity-recovery-title" style={{ marginBottom: 4 }}>
                  Liberar uma nova validação de identidade
                </h2>
                <p className="text-muted" style={{ margin: 0 }}>
                  Há um bloqueio canônico sem caso ou evidência privada disponível para análise. Esta ação libera
                  uma única tentativa, com prazo curto, sem aprovar a identidade nem remover as proteções KYC.
                </p>
              </div>

              <p style={{ margin: 0 }}>
                <strong>Falha registrada em:</strong> {formatDateTime(orphanRecoveryCandidate.expectedRevokedAt)}
              </p>

              <label className="form-field">
                Justificativa obrigatória
                <textarea
                  name="orphanIdentityRecoveryReason"
                  value={orphanRecoveryReason}
                  onChange={(event) => setOrphanRecoveryReason(event.target.value)}
                  minLength={MIN_ORPHAN_RECOVERY_REASON_LENGTH}
                  maxLength={1000}
                  placeholder="Explique por que o hold sem caso exige uma nova tentativa controlada."
                  disabled={orphanRecoveryBusy}
                  required
                />
                <span className="text-muted" style={{ margin: 0 }}>
                  Mínimo de {MIN_ORPHAN_RECOVERY_REASON_LENGTH} caracteres · {orphanRecoveryReason.trim().length} informados
                </span>
              </label>

              {orphanRecoveryError ? (
                <p className="error-banner" role="alert">{orphanRecoveryError}</p>
              ) : null}

              <div>
                <button
                  type="button"
                  className="primary-action"
                  disabled={
                    orphanRecoveryBusy ||
                    orphanRecoveryReason.trim().length < MIN_ORPHAN_RECOVERY_REASON_LENGTH
                  }
                  onClick={() => {
                    setOrphanRecoveryError("");
                    setOrphanRecoveryConfirmation("");
                    setOrphanRecoveryDialogOpen(true);
                  }}
                >
                  {orphanRecoveryBusy ? "Autorizando..." : "Revisar e autorizar tentativa"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {pendingIdentityReviewTickets.length > 0 ? (
          <section className="card" aria-labelledby="pending-identity-review-title">
            <div className="section-stack">
              <div>
                <span className="status-warn">Vínculo pendente</span>
                <h2 id="pending-identity-review-title" style={{ marginBottom: 4 }}>
                  Chamado KYC ainda não vinculado
                </h2>
                <p className="text-muted" style={{ margin: 0 }}>
                  O chamado foi preservado no suporte, mas precisa ser reconciliado com a evidência exata antes da análise.
                </p>
              </div>

              {pendingIdentityReviewTickets.length > 1 ? (
                <label className="form-field">
                  Chamado pendente
                  <select
                    value={getSupportTicketId(selectedPendingIdentityTicket)}
                    onChange={(event) => setSelectedPendingIdentityTicketId(event.target.value)}
                    disabled={identityReconciliationBusy}
                  >
                    {pendingIdentityReviewTickets.map((ticket) => (
                      <option key={getSupportTicketId(ticket)} value={getSupportTicketId(ticket)}>
                        {getSupportTicketId(ticket)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p style={{ margin: 0 }}>
                  <strong>Chamado:</strong> {getSupportTicketId(selectedPendingIdentityTicket)}
                </p>
              )}

              <label className="form-field">
                Justificativa da reconciliação
                <textarea
                  name="identityReviewReconciliationReason"
                  value={identityReconciliationReason}
                  onChange={(event) => setIdentityReconciliationReason(event.target.value)}
                  minLength={MIN_IDENTITY_RECONCILIATION_REASON_LENGTH}
                  placeholder="Explique por que este chamado deve ser vinculado à evidência registrada."
                  disabled={identityReconciliationBusy}
                  required
                />
                <span className="text-muted" style={{ margin: 0 }}>
                  Mínimo de {MIN_IDENTITY_RECONCILIATION_REASON_LENGTH} caracteres ·{" "}
                  {identityReconciliationReason.trim().length} informados
                </span>
              </label>

              {identityReconciliationError ? (
                <p className="error-banner" role="alert">{identityReconciliationError}</p>
              ) : null}

              <div>
                <button
                  type="button"
                  className="primary-action"
                  onClick={reconcileIdentityReviewTicket}
                  disabled={
                    identityReconciliationBusy ||
                    identityReconciliationReason.trim().length < MIN_IDENTITY_RECONCILIATION_REASON_LENGTH
                  }
                >
                  {identityReconciliationBusy ? "Vinculando chamado..." : "Vincular chamado ao caso"}
                </button>
              </div>
            </div>
          </section>
        ) : identityReconciliationError ? (
          <p className="error-banner" role="alert">{identityReconciliationError}</p>
        ) : null}

        {identityReviews.length > 1 ? (
          <section className="card">
            <label className="form-field">
              Caso de revisão de identidade
              <select
                value={selectedIdentityReview?.caseId || ""}
                onChange={(event) => setSelectedIdentityReviewId(event.target.value)}
              >
                {identityReviews.map((reviewCase) => (
                  <option key={reviewCase.caseId} value={reviewCase.caseId}>
                    {reviewCase.caseId} · {reviewCase.status || "OPEN"}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : null}

        {selectedIdentityReview ? (
          <KycIdentityReviewPanel
            key={selectedIdentityReview.caseId}
            driverId={id}
            driverName={documents?.driver?.name || ""}
            incidentId={selectedIdentityReview.caseId}
            attemptId={selectedIdentityEvidence.evidenceId || ""}
            approvedCnhPortraitUrl={identityEvidenceUrls.cnh}
            failedReferenceImageUrl={identityEvidenceUrls.selfie}
            reviewStatus={selectedIdentityReview.status || "OPEN"}
            evidence={{
              ...selectedIdentityEvidence,
              incidentId: selectedIdentityReview.caseId,
              attemptId: selectedIdentityEvidence.evidenceId || "",
              providerDecision: selectedIdentityEvidence.decision ||
                selectedIdentityEvidence.faceCompare?.decision ||
                "reject",
              similarity: selectedIdentityEvidence.similarityScore ??
                selectedIdentityEvidence.faceCompare?.similarityScore,
              threshold: selectedIdentityEvidence.threshold ??
                selectedIdentityEvidence.faceCompare?.threshold,
              createdAt: selectedIdentityEvidence.faceCompare?.comparedAt ||
                selectedIdentityReview.createdAt ||
                selectedIdentityEvidence.createdAt,
              expiresAt: selectedIdentityReview.evidenceExpiresAt ||
                selectedIdentityEvidence.expiresAt ||
                selectedIdentityEvidence.retainUntil ||
                selectedIdentityReview.evidenceAccess?.retainUntil,
            }}
            retentionExpiresAt={
              selectedIdentityReview.evidenceExpiresAt ||
              selectedIdentityEvidence.expiresAt ||
              selectedIdentityEvidence.retainUntil ||
              selectedIdentityReview.evidenceAccess?.retainUntil ||
              ""
            }
            initialTicketId={selectedIdentityReview.ticketId || selectedIdentityReview.ticketIds?.[0] || ""}
            busyAction={identityReviewBusy}
            actionError={identityReviewError}
            onLoadEvidence={loadIdentityEvidence}
            onStartReview={startIdentityReview}
            onAuthorizeRetry={(payload) => decideIdentityReview("FALSE_POSITIVE", payload)}
            onConfirmPermanentBlock={(payload) => decideIdentityReview("CONFIRMED_FRAUD", payload)}
          />
        ) : identityReviewError ? (
          <p className="error-banner" role="alert">{identityReviewError}</p>
        ) : null}

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
              const documentAvailable = hasDocumentStorageBinding(doc);
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
                    </div>
                  ) : null}

                  <div className="filters">
                    <button
                      type="button"
                      disabled={!documentAvailable || openingDocumentType === normalizedType}
                      onClick={() => openDriverDocument(normalizedType)}
                    >
                      {openingDocumentType === normalizedType
                        ? "Abrindo..."
                        : documentAvailable
                          ? "Visualizar documento"
                          : "Sem arquivo para visualizar"}
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

        <ConfirmActionDialog
          open={orphanRecoveryDialogOpen}
          title="Autorizar uma única nova validação?"
          description="O backend manterá o motorista bloqueado para corridas e aceitará somente uma tentativa vinculada a esta autorização."
          confirmLabel={orphanRecoveryBusy ? "Autorizando..." : "Autorizar nova validação"}
          tone="warning"
          busy={orphanRecoveryBusy}
          onConfirm={authorizeOrphanHoldRecovery}
          onCancel={() => {
            if (orphanRecoveryBusy) return;
            setOrphanRecoveryDialogOpen(false);
            setOrphanRecoveryConfirmation("");
            setOrphanRecoveryError("");
          }}
        >
          <div className="section-stack">
            <p>
              <strong>Consequência:</strong> uma tentativa limpa, auditada e com expiração será criada. A identidade
              só será liberada se o novo liveness e a comparação facial forem aprovados, sempre fora de corrida.
            </p>
            <label className="form-field">
              Digite <strong>{ORPHAN_RECOVERY_CONFIRMATION_PHRASE}</strong> para confirmar
              <input
                name="orphanIdentityRecoveryConfirmation"
                value={orphanRecoveryConfirmation}
                onChange={(event) => setOrphanRecoveryConfirmation(event.target.value)}
                autoComplete="off"
                disabled={orphanRecoveryBusy}
                required
              />
            </label>
            {orphanRecoveryError ? (
              <p className="error-banner" role="alert">{orphanRecoveryError}</p>
            ) : null}
          </div>
        </ConfirmActionDialog>

        {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    </ProtectedRoute>
  );
}
