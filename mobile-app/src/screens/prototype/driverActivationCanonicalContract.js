function isApprovedDocument(document = null) {
  return String(document?.status || '').trim().toLowerCase() === 'approved';
}

export function resolveCanonicalDriverActivationGates(remoteSnapshot = null) {
  const documents = remoteSnapshot?.documents || {};
  const checklist = remoteSnapshot?.checklist || {};

  return {
    cnhApproved: isApprovedDocument(documents.cnh) || checklist.cnhEar === true,
    crlvDocumentApproved: isApprovedDocument(documents.crlv),
    canonicalVehicleApproved: checklist.vehicleRegistration === true,
    consentApproved: checklist.backgroundCheckConsent === true,
  };
}

export function resolveCanonicalLivenessGate(remoteSnapshot = null) {
  const activationState = String(
    remoteSnapshot?.activationState || remoteSnapshot?.state || '',
  ).trim().toUpperCase();
  const requiresLiveness = remoteSnapshot?.requiresLiveness === true;
  const completed = activationState === 'ACTIVE';
  const canStart =
    activationState === 'APPROVED_NEEDS_LIVENESS' && requiresLiveness;

  return {
    activationState,
    requiresLiveness,
    canStart,
    completed,
    visible: canStart || completed,
  };
}

export function isDriverActivationOnlineAttemptAllowed(activationState = null) {
  return Boolean(
    activationState?.canGoOnline === true ||
    activationState?.canAttemptOnline === true,
  );
}
