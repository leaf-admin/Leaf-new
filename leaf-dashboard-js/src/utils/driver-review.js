// Classificação do cadastro do motorista para o dashboard. Usa o mesmo estado canônico que o
// app mostra em "Seu cadastro" (application.activation) e os documentos do registro.

export const DRIVER_TABS = [
  { id: "review", label: "Para revisar" },
  { id: "onboarding", label: "Em cadastro" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Recusados" },
  { id: "all", label: "Todos" },
];

const STEP_STATUS = {
  approved: { tone: "ok", label: "Aprovado" },
  review: { tone: "warn", label: "Em análise" },
  failed: { tone: "bad", label: "Precisa de ajuste" },
  pending: { tone: "muted", label: "Pendente" },
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function findDocument(application, type) {
  const docs = application?.documents?.all_documents;
  if (!Array.isArray(docs)) return null;
  return docs.find((doc) => normalize(doc?.type) === type) || null;
}

function documentStepStatus(doc) {
  const status = normalize(doc?.status);
  if (!doc) return "pending";
  if (status === "approved") return "approved";
  if (["rejected", "failed"].includes(status)) return "failed";
  if (["in_review", "pending", "analyzing", "uploaded"].includes(status)) return "review";
  return "pending";
}

export function resolveDriverSteps(application = {}) {
  const activation = application.activation || {};
  const checklist = activation.checklist || {};
  const kyc = application.kyc || {};
  const cnh = findDocument(application, "cnh");
  const crlv = findDocument(application, "crlv");
  const backgroundCertificate = findDocument(application, "antecedentes_criminais");
  const backgroundCertificateStatus = checklist.backgroundCertificate === true
    ? "approved"
    : documentStepStatus(backgroundCertificate);
  const faceStatus = activation.livenessPassed || kyc.approved
    ? "approved"
    : kyc.blocked
      ? "failed"
      : kyc.needsReview
        ? "review"
        : "pending";

  return [
    { key: "cnh", title: "CNH", status: documentStepStatus(cnh), document: cnh, detail: cnh?.rejectionReason || null },
    { key: "crlv", title: "CRLV e veículo", status: activation.vehicleReady ? "approved" : documentStepStatus(crlv), document: crlv, detail: crlv?.rejectionReason || null },
    { key: "face", title: "Validação facial", status: faceStatus, detail: kyc.message || null },
    { key: "consent", title: "Aceite de antecedentes e termos", status: checklist.backgroundCheckConsent ? "approved" : "pending" },
    {
      key: "background_certificate",
      title: "Certidão de antecedentes",
      status: backgroundCertificateStatus,
      document: backgroundCertificate,
      detail: backgroundCertificate?.rejectionReason
        || (checklist.awaitingBackgroundCertificate ? "Emitir e anexar a certidão para liberar o motorista." : null),
    },
  ].map((step) => ({ ...step, ...STEP_STATUS[step.status] }));
}

export function classifyDriver(application = {}) {
  const driver = application.driver || {};
  const status = normalize(application.status || driver.status);
  if (driver.approved === true || status === "approved") return "approved";
  if (status === "rejected" || normalize(driver.status) === "blocked") return "rejected";
  const steps = resolveDriverSteps(application);
  const needsHuman = normalize(application.autoApproval?.status) === "needs_review"
    || application.activation?.canGoOnline === true
    || application.kyc?.needsReview === true
    || application.activation?.checklist?.awaitingBackgroundCertificate === true
    || steps.some((step) => step.status === "review" && step.document);
  return needsHuman ? "review" : "onboarding";
}

export function resolveDriverHeadline(application = {}) {
  const bucket = classifyDriver(application);
  const auto = application.autoApproval || {};
  if (bucket === "approved") {
    return String(application.reviewedBy || "").startsWith("system:") ? "Aprovado automaticamente" : "Aprovado";
  }
  if (bucket === "rejected") return application.rejectionReason || "Cadastro recusado";
  if (normalize(auto.status) === "needs_review") {
    const reasons = {
      cpf_uniqueness: "CPF já usado em outra conta",
      cpf_missing: "CPF não identificado na CNH",
      identity_enforcement: "Identidade com bloqueio ativo",
    };
    return reasons[auto.reason] || "Precisa de revisão manual";
  }
  if (application.activation?.canGoOnline) return "Tudo certo, aguardando aprovação";
  if (application.activation?.checklist?.awaitingBackgroundCertificate === true) {
    const certificate = findDocument(application, "antecedentes_criminais");
    const certificateStatus = documentStepStatus(certificate);
    if (certificateStatus === "review") return "Certidão anexada, falta revisar";
    if (certificateStatus === "failed") return "Certidão recusada, emitir de novo";
    return "Emitir e anexar a certidão de antecedentes";
  }
  return application.activation?.blockingReason || "Cadastro em andamento";
}

export function countByTab(applications = []) {
  const counts = { review: 0, onboarding: 0, approved: 0, rejected: 0, all: applications.length };
  applications.forEach((item) => {
    counts[classifyDriver(item)] += 1;
  });
  return counts;
}

export function matchesSearch(application = {}, term = "") {
  const query = normalize(term);
  if (!query) return true;
  const driver = application.driver || {};
  const vehicle = application.vehicleConfig || {};
  return [driver.name, driver.phone, driver.email, driver.cpf, vehicle.activeVehiclePlate, application.id]
    .some((value) => normalize(value).includes(query));
}

export const REVIEW_QUEUE_STORAGE_KEY = "leaf.dashboard.review-queue";

// Fila de revisão do mais antigo para o mais novo (reviewWaitingSince vem do
// backend; sem ela, a data do cadastro).
export function waitingSinceMs(application = {}) {
  const raw = application.reviewWaitingSince || application.updatedAt || application.submissionDate;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortReviewQueue(applications = []) {
  return applications.slice().sort((left, right) => {
    const a = waitingSinceMs(left);
    const b = waitingSinceMs(right);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
}

const FUNNEL_STEPS = [
  { key: "cnh", label: "CNH aprovada" },
  { key: "crlv", label: "CRLV e veículo" },
  { key: "face", label: "Validação facial" },
  { key: "consent", label: "Aceite de antecedentes" },
  { key: "background_certificate", label: "Certidão aprovada" },
];

// Funil e tempo de aprovação a partir da lista já carregada (sem leitura extra).
export function buildDriverFunnel(applications = []) {
  const active = applications.filter((item) => classifyDriver(item) !== "rejected");
  const total = active.length;
  const stages = FUNNEL_STEPS.map((stage) => {
    const count = active.filter((item) => {
      const step = resolveDriverSteps(item).find((entry) => entry.key === stage.key);
      return step?.status === "approved";
    }).length;
    return { ...stage, count, percent: total ? Math.round((count / total) * 100) : 0 };
  });
  const approved = active.filter((item) => classifyDriver(item) === "approved");
  stages.push({
    key: "approved",
    label: "Aprovados",
    count: approved.length,
    percent: total ? Math.round((approved.length / total) * 100) : 0,
  });

  const durations = approved
    .map((item) => {
      const start = Date.parse(item.submissionDate || "");
      const end = Date.parse(item.reviewDate || "");
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
    })
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const medianApprovalMs = durations.length ? durations[Math.floor(durations.length / 2)] : null;

  return { total, stages, medianApprovalMs, approvalSamples: durations.length };
}
