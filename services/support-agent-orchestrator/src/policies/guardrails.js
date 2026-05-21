const RULES = {
  emergency: ["sos", "emergencia", "acidente", "assedio", "ameaca", "violencia", "roubo", "agressao", "risco fisico"],
  fraud: ["fraude", "golpe", "conta invadida", "vazamento", "lgpd", "dados pessoais", "phishing"],
  payment: ["pagamento", "pix", "cobranca", "reembolso", "charge", "woovi", "openpix", "saldo", "saque"],
  kyc: ["documento", "kyc", "cnh", "crlv", "antecedentes", "biometria", "cadastro motorista"],
  technical: ["bug", "erro", "falha", "travou", "websocket", "redis", "timeout", "indisponivel", "app fora"],
};

const CATEGORY_BY_RULE = {
  emergency: "safety",
  fraud: "fraud",
  payment: "payment",
  kyc: "driver_kyc",
  technical: "technical",
};

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findRiskFlags(text) {
  const normalized = normalize(text);
  return Object.entries(RULES)
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(normalize(keyword))))
    .map(([flag]) => flag);
}

function categoryFromFlags(flags, fallback = "general") {
  const first = flags.find((flag) => CATEGORY_BY_RULE[flag]);
  return first ? CATEGORY_BY_RULE[first] : fallback;
}

function priorityFromFlags(flags, ticketPriority) {
  const current = String(ticketPriority || "").toUpperCase();
  if (flags.some((flag) => ["emergency", "fraud"].includes(flag))) return "N1";
  if (flags.some((flag) => ["payment", "kyc", "technical"].includes(flag))) return current === "N1" ? "N1" : "N2";
  return ["N1", "N2", "N3"].includes(current) ? current : "N3";
}

function supportTierFromFlags(flags) {
  if (flags.includes("emergency") || flags.includes("fraud")) return "N3";
  if (flags.includes("payment") || flags.includes("kyc") || flags.includes("technical")) return "N2";
  return "N1";
}

function canAutoReply({ flags, confidence, minConfidence, autonomousMode, playbookMatches, approvedMacro }) {
  if (!autonomousMode) return false;
  if (confidence < minConfidence) return false;
  if (!playbookMatches?.length) return false;
  if (!approvedMacro) return false;
  if (flags.some((flag) => ["emergency", "fraud", "payment", "kyc"].includes(flag))) return false;
  return true;
}

module.exports = {
  RULES,
  findRiskFlags,
  categoryFromFlags,
  priorityFromFlags,
  supportTierFromFlags,
  canAutoReply,
};
