const firebaseConfig = require('../firebase-config');
const kycPolicyService = require('./kyc-policy-service');
const { logStructured, logError } = require('../utils/logger');

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || null;
}

function resolveMetadata(ticket = {}) {
  return ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
}

class SupportDriverIdentityReverificationService {
  async resolveDriverId(ticket = {}) {
    const metadata = resolveMetadata(ticket);
    const directDriverId = firstString(
      metadata.driverId,
      metadata.driver_id,
      metadata.targetDriverId,
      metadata.reportedDriverId
    );
    if (directDriverId) return directDriverId;

    const bookingId = firstString(metadata.bookingId, metadata.tripId, metadata.rideId);
    if (!bookingId) return null;

    const booking = await firebaseConfig.getFromRealtimeDB(`bookings/${bookingId}`).catch(() => null);
    return firstString(
      booking?.driverId,
      booking?.driver_id,
      booking?.driver,
      booking?.acceptedDriverId
    );
  }

  shouldTrigger(ticket = {}) {
    const metadata = resolveMetadata(ticket);
    return kycPolicyService.isPhotoMismatchReport({
      ...metadata,
      subject: ticket.subject,
      description: ticket.description,
      comment: ticket.description,
      feedback: metadata.feedback,
      selectedOptions: metadata.selectedOptions
    });
  }

  async handleTicket(ticket = {}) {
    if (!this.shouldTrigger(ticket)) {
      return { triggered: false, reason: 'no_identity_mismatch_signal' };
    }

    const driverId = await this.resolveDriverId(ticket);
    if (!driverId) {
      logStructured('warn', 'Ticket com sinal de divergencia de motorista sem driverId resolvido', {
        service: 'support-driver-identity-reverification-service',
        ticketId: ticket.id || null
      });
      return { triggered: false, reason: 'driver_not_resolved' };
    }

    const metadata = resolveMetadata(ticket);
    const result = await kycPolicyService.markDriverForPhotoMismatch({
      driverId,
      tripId: firstString(metadata.bookingId, metadata.tripId, metadata.rideId),
      reporterId: ticket.userId || metadata.reporterId || null,
      reporterType: ticket.userType || 'passenger',
      supportTicketId: ticket.id || null,
      payload: {
        selectedOptions: metadata.selectedOptions,
        subject: ticket.subject,
        description: ticket.description,
        comment: ticket.description,
        suggestion: metadata.suggestion || null
      }
    });

    return {
      triggered: true,
      driverId,
      ...result
    };
  }
}

module.exports = new SupportDriverIdentityReverificationService();
module.exports.SupportDriverIdentityReverificationService = SupportDriverIdentityReverificationService;
