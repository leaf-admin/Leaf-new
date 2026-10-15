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
    { key: "consent", title: "Antecedentes e termos", status: checklist.backgroundCheckConsent ? "approved" : "pending" },
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
