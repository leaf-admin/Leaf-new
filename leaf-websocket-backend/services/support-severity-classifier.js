'use strict';

const PRIORITY_RANK = {
  N1: 3,
  N2: 2,
  N3: 1
};

const N1_PATTERNS = [
  /\b(sos|emerg[eê]ncia|p[aâ]nico|risco de vida)\b/i,
  /\b(acidente|colis[aã]o|batida|ferid[oa]|machucad[oa])\b/i,
  /\b(assalto|roubo|sequestro|amea[cç]a|viol[eê]ncia|agress[aã]o|ass[eé]dio)\b/i,
  /\b(motorista|passageiro).*\b(amea[cç]ou|agrediu|assediou|roubou|bateu)\b/i
];

const N2_PATTERNS = [
  /\b(pagamento|pix|cobran[cç]a|cobrado|paguei|reembolso|estorno|chargeback)\b/i,
  /\b(fraude|golpe|suspeit[ao]|conta invadida|acesso indevido)\b/i,
  /\b(conta bloqueada|bloqueio|n[aã]o consigo acessar|login bloqueado)\b/i,
  /\b(documento|cnh|crlv|kyc|biometria|face compare|aprova[cç][aã]o)\b/i,
  /\b(corrida travada|app travado|busca travada|n[aã]o finalizou)\b/i
];

// Quem resolve (A a D), ao lado da urgência N1-N3. Definido no plano de
// observabilidade e bots de 19/10/2026.
// A: o bot responde com dados do próprio usuário, sem alterar nada.
// B: bug do app que sai por OTA (o bot abre o PR, o responsável aprova).
// C: correção simples no backend/config dentro de regra aprovada.
// D: decisão do responsável (dinheiro, segurança, KYC contestado, jurídico, bloqueio).
// O texto só sabe dizer "parece bug" (B); a triagem pode subir para C ou D,
// nunca descer.
const RESOLUTION_RANK = {
  A: 1,
  B: 2,
  C: 3,
  D: 4
};

const RESOLUTION_OWNER = {
  A: 'bot',
  B: 'bot_ota_fix',
  C: 'bot_backend_fix',
  D: 'owner_decision'
};

const OWNER_DECISION_PATTERNS = [
  ['money_dispute', /\b(reembolso|estorno|chargeback|devolu[cç][aã]o|cobran[cç]a indevida|cobrad[oa] (a mais|duas vezes|errado))\b/i],
  ['fraud_or_account_security', /\b(fraude|golpe|conta invadida|acesso indevido|hackead[oa])\b/i],
  ['account_restriction', /\b(conta bloqueada|bloqueio|bloquead[oa]|banid[oa]|suspens[aã]o|suspens[oa])\b/i],
  ['legal', /\b(lgpd|advogad[oa]|processo judicial|procon|justi[cç]a)\b/i],
  ['stuck_ride', /\b(corrida travada|n[aã]o finalizou|n[aã]o encerrou)\b/i]
];

// "Como vejo meu saldo?" o bot responde; "meu saque não caiu" é decisão.
const BALANCE_TOPIC_PATTERN = /\b(saldo|saque|repasse|ganhos?)\b/i;
const BALANCE_PROBLEM_PATTERN = /\b(errad[oa]|incorret[oa]|n[aã]o caiu|n[aã]o recebi|sumiu|faltando|a menos|menor|n[aã]o apareceu)\b/i;
const KYC_TOPIC_PATTERN = /\b(documento|cnh|crlv|kyc|biometria|selfie|antecedentes|cadastro)\b/i;
const KYC_DISPUTE_PATTERN = /\b(recusad[oa]|reprovad[oa]|negad[oa]|rejeitad[oa]|contest\w*)\b/i;
const APP_BUG_PATTERN = /\b(n[aã]o abre|travou|trava|crash|fecha sozinho|erro|bug|n[aã]o carrega|tela (branca|preta)|n[aã]o funciona)\b/i;

function normalizeResolutionClass(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return RESOLUTION_RANK[normalized] ? normalized : null;
}

function strongerResolutionClass(left, right) {
  const safeLeft = normalizeResolutionClass(left) || 'A';
  const safeRight = normalizeResolutionClass(right) || 'A';
  return RESOLUTION_RANK[safeLeft] >= RESOLUTION_RANK[safeRight] ? safeLeft : safeRight;
}

function classifyResolution({ text, category, priority }) {
  if (priority === 'N1') {
    return { resolutionClass: 'D', reasons: ['safety_always_owner'] };
  }
  if (category === 'payment') {
    return { resolutionClass: 'D', reasons: ['payment_category_is_money'] };
  }
  const ownerMatches = OWNER_DECISION_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([reason]) => reason);
  if (BALANCE_TOPIC_PATTERN.test(text) && BALANCE_PROBLEM_PATTERN.test(text)) {
    ownerMatches.push('balance_dispute');
  }
  if (KYC_TOPIC_PATTERN.test(text) && KYC_DISPUTE_PATTERN.test(text)) {
    ownerMatches.push('kyc_dispute');
  }
  if (ownerMatches.length) {
    return { resolutionClass: 'D', reasons: ownerMatches };
  }
  if (APP_BUG_PATTERN.test(text)) {
    return { resolutionClass: 'B', reasons: ['reported_app_bug_needs_triage'] };
  }
  return { resolutionClass: 'A', reasons: ['answerable_with_user_data'] };
}

function normalizePriority(value) {
  const normalized = String(value || 'N3').trim().toUpperCase();
  return PRIORITY_RANK[normalized] ? normalized : 'N3';
}

function strongerPriority(left, right) {
  const safeLeft = normalizePriority(left);
  const safeRight = normalizePriority(right);
  return PRIORITY_RANK[safeLeft] >= PRIORITY_RANK[safeRight] ? safeLeft : safeRight;
}

function classifyText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return {
      priority: 'N3',
      severity: 'normal',
      reasons: ['empty_text_default']
    };
  }

  if (N1_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      priority: 'N1',
      severity: 'critical',
      reasons: ['safety_or_emergency_keyword']
    };
  }

  if (N2_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      priority: 'N2',
      severity: 'elevated',
      reasons: ['payment_account_document_or_stuck_flow_keyword']
    };
  }

  return {
    priority: 'N3',
    severity: 'normal',
    reasons: ['standard_support']
  };
}

function isTrustedPrioritySource({ metadata = {}, requesterIsAgent = false } = {}) {
  if (requesterIsAgent) return true;
  const source = String(metadata?.source || metadata?.createdBy || '').trim().toLowerCase();
  return [
    'ops_incident',
    'kyc_policy',
    'support_agent',
    'dashboard',
    'system'
  ].includes(source);
}

function classifySupportTicketSeverity({
  subject,
  description,
  category = 'general',
  requestedPriority = 'N3',
  metadata = {},
  requesterIsAgent = false
} = {}) {
  const requested = normalizePriority(requestedPriority);
  const trustedPriority = isTrustedPrioritySource({ metadata, requesterIsAgent });
  const textClassification = classifyText(`${subject || ''}\n${description || ''}`);
  const normalizedCategory = String(category || 'general').trim().toLowerCase();
  let computedPriority = textClassification.priority;
  const reasons = [...textClassification.reasons];

  if (normalizedCategory === 'safety') {
    computedPriority = strongerPriority(computedPriority, 'N1');
    reasons.push('safety_category_minimum');
  }

  if (normalizedCategory === 'payment') {
    computedPriority = strongerPriority(computedPriority, 'N2');
    reasons.push('payment_category_minimum');
  }

  if (normalizedCategory === 'technical' && /\b(n[aã]o abre|n[aã]o consigo usar|travou|crash|erro)\b/i.test(`${subject || ''}\n${description || ''}`)) {
    computedPriority = strongerPriority(computedPriority, 'N2');
    reasons.push('blocking_technical_issue');
  }

  const effectivePriority = trustedPriority
    ? strongerPriority(computedPriority, requested)
    : computedPriority;

  const resolution = classifyResolution({
    text: `${subject || ''}\n${description || ''}`,
    category: normalizedCategory,
    priority: effectivePriority
  });
  const requestedResolutionClass = normalizeResolutionClass(metadata?.resolutionClass);
  const resolutionClass = trustedPriority && requestedResolutionClass
    ? strongerResolutionClass(resolution.resolutionClass, requestedResolutionClass)
    : resolution.resolutionClass;

  return {
    priority: effectivePriority,
    severity: effectivePriority === 'N1'
      ? 'critical'
      : (effectivePriority === 'N2' ? 'elevated' : 'normal'),
    computedPriority,
    requestedPriority: requested,
    requestedPriorityTrusted: trustedPriority,
    prioritySource: trustedPriority && PRIORITY_RANK[requested] > PRIORITY_RANK[computedPriority]
      ? 'trusted_requested_priority'
      : 'classifier',
    reasons,
    resolutionClass,
    resolutionOwner: RESOLUTION_OWNER[resolutionClass],
    autoReplyAllowed: resolutionClass === 'A',
    resolutionReasons: resolutionClass === resolution.resolutionClass
      ? resolution.reasons
      : [...resolution.reasons, 'trusted_requested_resolution_class']
  };
}

module.exports = {
  classifySupportTicketSeverity,
  normalizePriority,
  normalizeResolutionClass,
  strongerPriority,
  strongerResolutionClass
};
