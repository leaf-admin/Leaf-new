const { logStructured } = require('../utils/logger');

// Aprovação automática do motorista: quando o estado canônico de ativação fica ACTIVE (CNH e
// CRLV aprovados pela análise, veículo ativo, KYC, validação facial e consentimentos), a conta
// recebe `approved` sem esperar um admin. Mesma regra da aprovação rápida do dashboard, mais a
// unicidade do CPF. Não cria subconta no provedor de pagamento. Desligada por padrão.
const AUTO_APPROVAL_ACTOR = 'system:auto_canonical_evidence';
const BLOCKING_MANUAL_STATUSES = new Set(['rejected', 'denied', 'reprovado', 'blocked', 'suspended']);

function isAutoApprovalEnabled(env = process.env) {
  return ['true', '1', 'yes', 'on'].includes(String(env.ENABLE_DRIVER_AUTO_APPROVAL || '').trim().toLowerCase());
}

function resolveDriverCpf(user = {}) {
  const fromCnh = user?.documents?.cnh?.extractedData?.cpf || user?.documents?.cnh?.data?.cpf;
  return String(fromCnh || user?.cpf || user?.cpfNormalized || '').trim();
}

function isAlreadyApproved(user = {}) {
  const flag = user?.approved ?? user?.isApproved ?? null;
  return flag === true || String(flag).toLowerCase() === 'true';
}

function createDriverAutoApprovalService({
  env = process.env,
  claimCpf,
  assertNotPermanentlyBlocked,
  auditService,
  getFirestore,
  now = () => new Date().toISOString()
} = {}) {
  async function recordNeedsReview(db, driverId, reason, details = {}) {
    const at = now();
    await db.ref(`users/${driverId}/autoApproval`).set({ status: 'needs_review', reason, ...details, updatedAt: at });
    logStructured('warn', 'Aprovação automática do motorista precisa de revisão', {
      service: 'driver-auto-approval', driverId, reason
    });
    return { approved: false, status: 'needs_review', reason };
  }

  async function maybeAutoApprove({ db, driverId, canonicalState }) {
    if (!isAutoApprovalEnabled(env)) return { approved: false, status: 'disabled' };
    if (!db || !driverId || canonicalState?.canGoOnline !== true) return { approved: false, status: 'not_eligible' };

    const user = (await db.ref(`users/${driverId}`).once('value')).val() || {};
    if (isAlreadyApproved(user)) return { approved: false, status: 'already_approved' };
    if (BLOCKING_MANUAL_STATUSES.has(String(user.manualReviewStatus || user.status || '').toLowerCase())) {
      return { approved: false, status: 'manual_decision' };
    }

    try {
      await assertNotPermanentlyBlocked(driverId);
    } catch (error) {
      return recordNeedsReview(db, driverId, 'identity_enforcement', { code: error?.code || null });
    }

    const cpf = resolveDriverCpf(user);
    if (!cpf) return recordNeedsReview(db, driverId, 'cpf_missing');
    try {
      await claimCpf({ firestore: getFirestore(), realtimeDb: db, userId: driverId, cpf });
    } catch (error) {
      return recordNeedsReview(db, driverId, 'cpf_uniqueness', { code: error?.code || null });
    }

    const at = now();
    const audit = {
      action: 'driver.auto_approval',
      driverId,
      actorId: AUTO_APPROVAL_ACTOR,
      provenance: 'driver_activation_pipeline',
      evidence: {
        activationState: canonicalState.state || null,
        checklist: canonicalState.checklist || {},
        kyc: canonicalState.kyc || {},
        liveness: canonicalState.liveness || {},
        vehicle: canonicalState.vehicle || {}
      },
      previousState: { approved: user.approved ?? null, status: user.status || null },
      createdAt: at
    };
    await db.ref(`users/${driverId}`).update({
      approved: true,
      approvedAt: at,
      approvedBy: AUTO_APPROVAL_ACTOR,
      status: 'approved',
      approvalAuditTrail: audit,
      approvalAuditUpdatedAt: at,
      autoApproval: { status: 'approved', approvedAt: at },
      updatedAt: at
    });
    await auditService.logEvent({
      userId: AUTO_APPROVAL_ACTOR,
      action: 'driver.auto_approval',
      resource: 'driver',
      severity: 'INFO',
      details: audit,
      success: true
    });
    logStructured('info', 'Motorista aprovado automaticamente', { service: 'driver-auto-approval', driverId });
    return { approved: true, status: 'approved' };
  }

  return { maybeAutoApprove };
}

let defaultService = null;
function getDefaultDriverAutoApprovalService() {
  if (!defaultService) {
    const firebaseConfig = require('../firebase-config');
    const { claimCpf } = require('./cpf-identity-registry-service');
    const { assertDriverIdentityNotPermanentlyBlocked } = require('./dashboard-user-management-service');
    defaultService = createDriverAutoApprovalService({
      claimCpf,
      assertNotPermanentlyBlocked: assertDriverIdentityNotPermanentlyBlocked,
      auditService: require('./audit-service'),
      getFirestore: () => firebaseConfig.getFirestore()
    });
  }
  return defaultService;
}

module.exports = {
  AUTO_APPROVAL_ACTOR,
  createDriverAutoApprovalService,
  getDefaultDriverAutoApprovalService,
  isAutoApprovalEnabled,
  resolveDriverCpf
};
