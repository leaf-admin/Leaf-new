// Motoristas de teste para o smoke e para a validação local do dashboard (sem dados reais).
const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();

function doc(type, status, extractedData = {}, extra = {}) {
  return { type, status, contentAvailable: true, uploadedAt: iso(90), fileType: "application/pdf", extractedData, ...extra };
}

function application(id, overrides = {}) {
  const base = {
    id,
    driverId: id,
    status: "in_review",
    submissionDate: iso(120),
    driver: { id, name: "Motorista", phone: "+55 21 90000-0000", email: "", cpf: "", approved: false, status: "pending" },
    documents: { all_documents: [] },
    kyc: { status: "missing", approved: false, needsReview: false, blocked: false },
    activation: { state: "DRIVER_DOCS_PENDING", label: "Documentos pendentes", canGoOnline: false, blockingReason: "Envie a CNH.", checklist: {}, livenessPassed: false, vehicleReady: false },
    autoApproval: null,
    vehicleConfig: { activeVehiclePlate: null, activeVehicleModel: null, activeVehicleColor: null, category: null, vehicles: [] },
  };
  return {
    ...base,
    ...overrides,
    driver: { ...base.driver, ...(overrides.driver || {}) },
    activation: { ...base.activation, ...(overrides.activation || {}) },
    vehicleConfig: { ...base.vehicleConfig, ...(overrides.vehicleConfig || {}) },
  };
}

const cnhData = { nome: "Maria Souza Lima", cpf: "123.456.789-09", dataNascimento: "12/04/1990", categoria: "B", validade: "03/2031", ear: "Sim" };
const crlvData = { placa: "QQO0G16", marcaModelo: "VW Nova Saveiro", cor: "Branco", anoFabricacao: "2021", exercicio: "2026" };

const driverApplicationsFixture = [
  application("smoke-driver", {
    driver: { name: "Maria Souza Lima", phone: "+55 21 98888-1111", cpf: "123.456.789-09", birthDate: "1990-04-12", motherName: "Ana Souza", genderLabel: "Feminino", city: "Rio de Janeiro" },
    documents: { all_documents: [doc("cnh", "approved", cnhData), doc("crlv", "approved", crlvData)] },
    kyc: { status: "approved", approved: true },
    activation: { state: "ACTIVE", label: "Apto para ficar online", canGoOnline: true, blockingReason: null, checklist: { cnhEar: true, vehicleRegistration: true, backgroundCheckConsent: true }, livenessPassed: true, vehicleReady: true },
    autoApproval: { status: "needs_review", reason: "cpf_uniqueness" },
    vehicleConfig: { activeVehiclePlate: "QQO0G16", activeVehicleModel: "VW Nova Saveiro", activeVehicleColor: "Branco", category: "Leaf Plus" },
  }),
  application("smoke-driver-crlv", {
    submissionDate: iso(30),
    driver: { name: "João Pereira", phone: "+55 21 97777-2222" },
    documents: { all_documents: [doc("cnh", "approved", { ...cnhData, nome: "João Pereira" }), doc("crlv", "in_review", { ...crlvData, placa: "RIO2A23" })] },
    kyc: { status: "approved", approved: true },
    activation: { state: "VEHICLE_IN_REVIEW", label: "Veículo em análise", blockingReason: "CRLV enviado e aguardando analise.", checklist: { cnhEar: true, backgroundCheckConsent: true }, livenessPassed: true },
    vehicleConfig: { activeVehiclePlate: "RIO2A23" },
  }),
  application("smoke-driver-new", {
    submissionDate: iso(10),
    status: "pending",
    driver: { name: "Carla Mendes", phone: "+55 21 96666-3333" },
  }),
  application("smoke-driver-approved", {
    status: "approved",
    reviewDate: iso(2000),
    reviewedBy: "system:auto_canonical_evidence",
    driver: { name: "Pedro Alves", phone: "+55 21 95555-4444", approved: true, status: "approved" },
    documents: { all_documents: [doc("cnh", "approved", cnhData), doc("crlv", "approved", crlvData)] },
    kyc: { status: "approved", approved: true },
    activation: { state: "ACTIVE", label: "Apto para ficar online", canGoOnline: true, checklist: { backgroundCheckConsent: true }, livenessPassed: true, vehicleReady: true },
    vehicleConfig: { activeVehiclePlate: "KXP4B21", activeVehicleModel: "Fiat Cronos" },
  }),
  application("smoke-driver-rejected", {
    status: "rejected",
    rejectionReason: "CNH vencida a mais de 30 dias",
    driver: { name: "Lucas Rocha", phone: "+55 21 94444-5555", status: "rejected" },
    documents: { all_documents: [doc("cnh", "rejected", cnhData, { rejectionReason: "CNH vencida a mais de 30 dias" })] },
  }),
];

module.exports = { driverApplicationsFixture };
