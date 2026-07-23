const PaymentService = require('../services/payment-service');
const ridePersistenceService = require('../services/ride-persistence-service');
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const { isRiderEarlyEndEnabled } = require('../utils/ride-lifecycle-feature-flags');
const { buildTripCompletedPayload } = require('../utils/trip-completion-payload');

function registerSocketEndTripEarlyHandler({
  socket,
  io,
  redisPool,
  logStructured,
  EndRideEarlyByRiderCommand,
  traceContext = null,
  eventBus = null
}) {
  socket.on('endTripEarlyByRider', async (data = {}) => {
    const run = async () => {
      try {
        if (!isRiderEarlyEndEnabled()) {
          socket.emit('tripCompleteError', {
            error: 'Encerramento antecipado pelo passageiro está desabilitado no momento.'
          });
          return;
        }

        const customerId = socket.userId || data.customerId || socket.id;
        const bookingId = data.bookingId;
        const endLocation = data.endLocation;
        const distanceKm = Number.parseFloat(data.distanceKm ?? data.distance ?? 0) || 0;
        const durationSecs = Number.parseFloat(data.durationSecs ?? data.duration ?? 0) || 0;
        const reason = String(data.reason || 'EARLY_DROPOFF_BY_RIDER').trim() || 'EARLY_DROPOFF_BY_RIDER';

        if (!bookingId || !endLocation?.lat || !endLocation?.lng) {
          socket.emit('tripCompleteError', { error: 'bookingId e endLocation são obrigatórios' });
          return;
        }

        const traceId = data.traceId || traceContext?.generateTraceId?.('end_trip_early_by_rider') || `end_trip_early_${Date.now()}`;
        const command = new EndRideEarlyByRiderCommand({
          bookingId,
          customerId,
          endLocation,
          distanceKm,
          durationSecs,
          reason,
          traceId,
          correlationId: bookingId
        });

        const result = await command.execute();
        if (!result.success) {
          socket.emit('tripCompleteError', { error: result.error || 'Erro ao encerrar corrida antecipadamente' });
          return;
        }

        const {
          driverId,
          customerId: resultCustomerId,
          event,
          finalFare,
          tollFee,
          distance,
          duration,
          paymentDistribution,
          settlement
        } = result.data || {};

        const redis = redisPool.getConnection();
        const bookingSnapshot = await redis.hgetall(`booking:${bookingId}`);
        const paymentService = new PaymentService();
        const fareBreakdown = paymentService.calculateFareBreakdownFromReais(
          Number(finalFare || 0),
          Number(tollFee || 0)
        );

        const tripCompletedData = buildTripCompletedPayload({
          bookingId,
          message: 'Corrida encerrada antecipadamente pelo passageiro',
          bookingData: bookingSnapshot,
          resultEndLocation: endLocation,
          endLocation,
          distance,
          duration,
          fareBreakdown,
          paymentDistribution,
          completionType: 'EARLY_ENDED_BY_RIDER',
          settlement,
          rideLegs: bookingSnapshot?.rideLegs ? JSON.parse(bookingSnapshot.rideLegs) : null,
          operationalContinuation: bookingSnapshot?.operationalContinuation
            ? JSON.parse(bookingSnapshot.operationalContinuation)
            : null,
          persistence: 'accepted_background'
        });

        if (driverId) {
          io.to(`driver_${driverId}`).emit('tripCompleted', tripCompletedData);
          io.to(`driver_${driverId}`).emit('paymentDistributed', {
            success: true,
            bookingId,
            pending: true,
            message: 'Distribuição financeira em processamento assíncrono'
          });
        }

        if (resultCustomerId) {
          io.to(`customer_${resultCustomerId}`).emit('tripCompleted', {
            ...tripCompletedData,
            message: 'Corrida encerrada antecipadamente'
          });
        }

        setImmediate(async () => {
          try {
            if (event && eventBus?.publish) {
              await eventBus.publish({
                eventType: 'ride.completed',
                data: event
              });
            }

            await ridePersistenceService.persistFinalRideDataWithOutbox(bookingId, {
              fare: finalFare,
              netFare: null,
              distance,
              duration,
              endLocation,
              driverEarnings: null,
              financialBreakdown: paymentDistribution || null,
              completionType: 'EARLY_ENDED_BY_RIDER',
              settlement,
              financialContext: bookingSnapshot?.financialContext || null,
              financialNamespace: bookingSnapshot?.financialNamespace || null,
              financialContextId: bookingSnapshot?.financialContextId || null,
              providerEnvironment: bookingSnapshot?.providerEnvironment || null,
              paymentProviderEnvironment: bookingSnapshot?.paymentProviderEnvironment || null,
              paymentProfileId: bookingSnapshot?.paymentProfileId || null,
              testUserSandbox: bookingSnapshot?.testUserSandbox === true
                || bookingSnapshot?.testUserSandbox === 'true'
            });
          } catch (backgroundError) {
            logStructured('error', 'Erro no pós-processamento do endTripEarlyByRider', {
              bookingId,
              customerId,
              eventType: 'endTripEarlyByRider',
              error: backgroundError.message
            });
          } finally {
            try {
              await redis.hdel('bookings:active', bookingId);
              await pricingH3ReadModelService.clearBookingSnapshot(redis, bookingId);
            } catch (cleanupError) {
              logStructured('warn', 'Falha ao remover booking encerrado pelo passageiro de bookings:active', {
                bookingId,
                eventType: 'endTripEarlyByRider',
                error: cleanupError.message
              });
            }
            if (io.activeBookings) {
              io.activeBookings.delete(bookingId);
            }
          }
        });
      } catch (error) {
        logStructured('error', 'Erro ao encerrar corrida antecipadamente pelo passageiro', {
          service: 'websocket',
          operation: 'endTripEarlyByRider',
          userId: socket.userId || socket.id,
          bookingId: data?.bookingId,
          error: error.message,
          stack: error.stack
        });
        socket.emit('tripCompleteError', { error: 'Erro ao encerrar corrida antecipadamente' });
      }
    };

    if (traceContext?.runWithTraceId) {
      const traceId = data.traceId || traceContext.generateTraceId?.('end_trip_early_by_rider') || `end_trip_early_${Date.now()}`;
      await traceContext.runWithTraceId(traceId, run);
      return;
    }

    await run();
  });
}

module.exports = registerSocketEndTripEarlyHandler;
