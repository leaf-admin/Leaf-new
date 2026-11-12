// Depois que um incidente de emergência é aberto: monta o pacote da ocorrência, guarda no
// incidente e tenta o envio para a força de segurança (desligado até haver termo de cooperação).
// Roda depois da confirmação ao app; uma falha aqui nunca desfaz o incidente já aberto.
const { logStructured } = require('../utils/logger');

function createEmergencyResponseService({
  incidentService,
  packageService,
  dispatchService,
  auditService = null
} = {}) {
  async function handleEmergencyIncident({
    incident,
    reporterId,
    reporterType,
    location = null,
    persistenceContext = null
  } = {}) {
    if (!incident?.incidentId) return { status: 'skipped' };

    const emergencyPackage = await packageService.buildEmergencyPackage({
      bookingId: incident.bookingId || null,
      reporterId,
      reporterType,
      location
    });

    const namespace = incident.financialNamespace || persistenceContext?.namespace || 'operational';
    const publicSafetyDispatch = await dispatchService.dispatch({ incident, emergencyPackage, namespace });

    await incidentService.attachEmergencyPackage(incident.incidentId, {
      emergencyPackage,
      publicSafetyDispatch,
      persistenceContext
    });

    if (auditService?.logEvent) {
      await auditService.logEvent({
        userId: 'system:emergency_response',
        action: 'safety.emergency_package',
        resource: 'ops_incident',
        severity: 'WARNING',
        details: {
          incidentId: incident.incidentId,
          bookingId: incident.bookingId || null,
          dispatchStatus: publicSafetyDispatch.status,
          agency: publicSafetyDispatch.agency || null,
          hasLocation: Boolean(emergencyPackage.location),
          warnings: emergencyPackage.warnings
        },
        success: true
      }).catch(() => null);
    }

    logStructured('warn', 'Pacote de emergência registrado', {
      service: 'emergency-response',
      incidentId: incident.incidentId,
      bookingId: incident.bookingId || null,
      dispatchStatus: publicSafetyDispatch.status,
      hasLocation: Boolean(emergencyPackage.location)
    });

    return { status: 'stored', dispatchStatus: publicSafetyDispatch.status };
  }

  return { handleEmergencyIncident };
}

let defaultService = null;
function getDefaultEmergencyResponseService() {
  if (!defaultService) {
    defaultService = createEmergencyResponseService({
      incidentService: require('./safety-incident-service'),
      packageService: require('./emergency-package-service').getDefaultEmergencyPackageService(),
      dispatchService: require('./public-safety-dispatch-service').getDefaultPublicSafetyDispatchService(),
      auditService: require('./audit-service')
    });
  }
  return defaultService;
}

module.exports = {
  createEmergencyResponseService,
  getDefaultEmergencyResponseService
};
