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
    reasons
  };
}

module.exports = {
  classifySupportTicketSeverity,
  normalizePriority,
  strongerPriority
};
