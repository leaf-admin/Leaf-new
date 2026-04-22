const {
    isRideExtensionFlowEnabled,
    isOperationalReassignmentEnabled
} = require('../utils/ride-lifecycle-feature-flags');
const { buildActiveRideSnapshotForUser } = require('./active-ride-sync-utils');

function registerSocketActiveRideHandlers({
    socket,
    io,
    redisPool,
    logStructured,
    logError
}) {
    // ==================== NOVOS EVENTOS - GERENCIAMENTO DE CORRIDA EM ANDAMENTO ====================

    socket.on('syncActiveRide', async (data = {}) => {
        try {
            const userId = socket.userId || data.uid || data.userId;
            const userType = socket.userType || data.userType || data.usertype;

            if (!userId || !userType) {
                socket.emit('activeRideSync', {
                    success: false,
                    code: 'NOT_AUTHENTICATED',
                    message: 'Usuário não autenticado para sincronização de corrida ativa'
                });
                return;
            }

            const redis = redisPool.getConnection();
            if (redis.status !== 'ready' && redis.status !== 'connect') {
                await redis.connect().catch(() => { });
            }

            const activeRideSnapshot = await buildActiveRideSnapshotForUser(redis, userId, userType);

            socket.emit('activeRideSync', {
                success: true,
                source: 'explicit_sync',
                ...activeRideSnapshot,
                syncedAt: new Date().toISOString()
            });
        } catch (error) {
            logStructured('error', 'Erro ao sincronizar corrida ativa para reconexão', {
                service: 'websocket',
                socketId: socket.id,
                userId: socket.userId || 'unknown',
                userType: socket.userType || 'unknown',
                error: error.message
            });

            socket.emit('activeRideSync', {
                success: false,
                code: 'SYNC_FAILED',
                message: 'Não foi possível sincronizar a corrida ativa agora'
            });
        }
    });

    // Reportar problema durante corrida
    socket.on('reportProblem', async (data) => {
        try {
            logStructured('info', 'Problema reportado durante corrida', {
                service: 'websocket',
                operation: 'reportProblem',
                userId: socket.userId || socket.id,
                bookingId: data.bookingId,
                problemType: data.problemType
            });

            const { bookingId, problemType, description } = data;

            if (!bookingId || !problemType) {
                socket.emit('problemReportError', { error: 'bookingId e problemType obrigatórios' });
                return;
            }

            const redis = redisPool.getConnection();

            // Buscar dados da corrida
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('problemReportError', { error: 'Corrida não encontrada' });
                return;
            }

            // Salvar problema reportado
            const problemData = {
                problemId: `problem_${Date.now()}`,
                bookingId,
                problemType, // 'accident', 'vehicle_defect', 'unsafe', 'danger'
                description: description || '',
                timestamp: new Date().toISOString(),
                status: 'reported'
            };

            await redis.hset(`problems:${bookingId}`, problemData.problemId, JSON.stringify(problemData));

            socket.emit('problemReported', {
                success: true,
                problemId: problemData.problemId,
                problemType,
                message: 'Problema reportado com sucesso',
                data: problemData
            });

            logStructured('info', `Problema reportado`, { service: 'reportProblem', problemId: problemData.problemId, userId: socket.userId });

        } catch (error) {
            logError(error, 'Erro ao reportar problema', { service: 'reportProblem', userId: socket.userId });
            socket.emit('problemReportError', { error: 'Erro interno do servidor' });
        }
    });

    // Calcular pagamento parcial ao motorista
    socket.on('calculatePartialPayment', async (data) => {
        try {
            logStructured('info', `Calculando pagamento parcial`, { service: 'calculatePartialPayment', bookingId: data.bookingId, userId: socket.userId });

            const { bookingId } = data;

            if (!bookingId) {
                socket.emit('partialPaymentError', { error: 'bookingId obrigatório' });
                return;
            }

            const redis = redisPool.getConnection();

            // Buscar dados da corrida
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('partialPaymentError', { error: 'Corrida não encontrada' });
                return;
            }

            const booking = JSON.parse(bookingData);

            // Calcular valor percorrido (metade do valor total estimado)
            const originalFare = parseFloat(booking.estimate || 0);
            const partialValue = originalFare / 2; // Metade do valor

            // Calcular taxas (usar valores do payment-service)
            const PaymentService = require('../services/payment-service');
            const paymentService = new PaymentService();

            // Converter para centavos para cálculo
            const partialValueCents = Math.round(partialValue * 100);
            const netCalculation = paymentService.calculateNetAmount(partialValueCents);

            // Converter de volta para reais
            const operationalFee = netCalculation.operationalFee / 100;
            const wooviFee = netCalculation.wooviFee / 100;
            const driverPayment = netCalculation.netAmount / 100;

            socket.emit('partialPaymentCalculated', {
                success: true,
                bookingId,
                partialValue: partialValue.toFixed(2),
                operationalFee: operationalFee.toFixed(2),
                wooviFee: wooviFee.toFixed(2),
                driverPayment: driverPayment.toFixed(2),
                breakdown: {
                    originalFare: originalFare.toFixed(2),
                    partialValue: partialValue.toFixed(2),
                    operationalFee: operationalFee.toFixed(2),
                    wooviFee: wooviFee.toFixed(2),
                    driverPayment: driverPayment.toFixed(2)
                }
            });

            logStructured('info', `Pagamento parcial calculado`, { service: 'calculatePartialPayment', bookingId, driverPayment: driverPayment.toFixed(2), partialValue: partialValue.toFixed(2) });

        } catch (error) {
            logError(error, 'Erro ao calcular pagamento parcial', { service: 'calculatePartialPayment', bookingId: data.bookingId });
            socket.emit('partialPaymentError', { error: 'Erro interno do servidor' });
        }
    });

    // Procurar novo motorista após problema
    socket.on('findNewDriver', async (data) => {
        try {
            logStructured('info', `Procurando novo motorista`, { service: 'findNewDriver', bookingId: data.bookingId, problemType: data.problemType, userId: socket.userId });

            const { bookingId, problemType, partialPayment } = data;

            if (!bookingId) {
                socket.emit('findNewDriverError', { error: 'bookingId obrigatório' });
                return;
            }

            const redis = redisPool.getConnection();

            // Buscar dados da corrida
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('findNewDriverError', { error: 'Corrida não encontrada' });
                return;
            }

            const booking = JSON.parse(bookingData);

            // Liberar lock do motorista anterior
            if (booking.driverId) {
                await redis.del(`driver_lock:${booking.driverId}`);
            }

            // Processar pagamento parcial ao motorista anterior
            if (partialPayment && booking.driverId) {
                // ✅ Pagamento via Woovi já implementado em processAdvancePayment
                logStructured('info', `Pagando motorista anterior`, { service: 'findNewDriver', bookingId, driverId: booking.driverId, partialPayment });
            }

            // Criar nova busca de motorista
            const newBooking = {
                ...booking,
                driverId: null,
                status: 'DRIVER_SEARCH',
                previousDriverId: booking.driverId,
                previousDriverPayment: partialPayment,
                problemType,
                searchStartedAt: new Date().toISOString()
            };

            await redis.hset('bookings:active', bookingId, JSON.stringify(newBooking));

            // Emitir evento para iniciar nova busca
            socket.emit('newDriverSearchStarted', {
                success: true,
                bookingId,
                message: 'Buscando novo motorista...'
            });

            // ✅ Integrado com sistema de filas e matching (rideQueueManager)
            // Por enquanto, apenas emitir evento
            logStructured('info', `Nova busca de motorista iniciada`, { service: 'findNewDriver', bookingId });

        } catch (error) {
            logError(error, 'Erro ao procurar novo motorista', { service: 'findNewDriver', bookingId: data.bookingId });
            socket.emit('findNewDriverError', { error: 'Erro interno do servidor' });
        }
    });

    // Alterar destino durante corrida
    socket.on('changeDestination', async (data) => {
        try {
            logStructured('info', `Alterando destino`, { service: 'changeDestination', bookingId: data.bookingId, userId: socket.userId });

            const { bookingId, newDestination } = data;

            if (!bookingId || !newDestination || !newDestination.lat || !newDestination.lng) {
                socket.emit('changeDestinationError', { error: 'bookingId e newDestination obrigatórios' });
                return;
            }

            const redis = redisPool.getConnection();

            // Buscar dados da corrida
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('changeDestinationError', { error: 'Corrida não encontrada' });
                return;
            }

            const booking = JSON.parse(bookingData);

            // Obter localização atual do passageiro (usar pickup atual ou localização do motorista)
            const currentLocation = booking.currentLocation || booking.pickup;
            if (!currentLocation) {
                socket.emit('changeDestinationError', { error: 'Localização atual não encontrada' });
                return;
            }

            // ✅ Rota calculada no frontend usando Google Directions API
            // Por enquanto, usar estimativa baseada em distância Haversine
            function calculateDistance(lat1, lng1, lat2, lng2) {
                const R = 6371; // Raio da Terra em km
                const dLat = (lat2 - lat1) * Math.PI / 180;
                const dLng = (lng2 - lng1) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLng / 2) * Math.sin(dLng / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c; // Retorna em km
            }

            const distanceKm = calculateDistance(
                currentLocation.lat,
                currentLocation.lng,
                newDestination.lat,
                newDestination.lng
            );

            // ✅ Tarifa calculada no frontend e enviada no createBooking
            const newFare = booking.estimate * (distanceKm / (booking.distance || 1)); // Estimativa simples

            const currentFare = parseFloat(booking.estimate || 0);
            const fareDifference = newFare - currentFare;

            if (fareDifference > 0) {
                socket.emit('destinationChanged', {
                    success: true,
                    bookingId,
                    newDestination,
                    newFare: newFare.toFixed(2),
                    fareDifference: fareDifference.toFixed(2),
                    requiresPayment: true,
                    requiresDriverApproval: true,
                    destinationUpdated: false,
                    message: 'A alteração aumenta o valor da corrida e precisa de aceite do motorista e pagamento complementar.'
                });
                return;
            }

            // Atualizar destino no booking
            const updatedBooking = {
                ...booking,
                drop: newDestination,
                newEstimate: newFare,
                fareDifference,
                destinationChangedAt: new Date().toISOString()
            };

            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            socket.emit('destinationChanged', {
                success: true,
                bookingId,
                newDestination,
                newFare: newFare.toFixed(2),
                fareDifference: fareDifference.toFixed(2),
                requiresPayment: fareDifference > 0,
                requiresRefund: fareDifference < 0,
                message: 'Destino alterado com sucesso'
            });

            logStructured('info', `Destino alterado para corrida`, { service: 'changeDestination', bookingId });

        } catch (error) {
            logError(error, 'Erro ao alterar destino', { service: 'changeDestination', bookingId: data.bookingId });
            socket.emit('changeDestinationError', { error: 'Erro interno do servidor' });
        }
    });

    // ✅ CAOS SCENARIO: Extensão de Rota Pré-Paga (Pix)
    socket.on('requestRideExtension', async (data) => {
        try {
            if (!isRideExtensionFlowEnabled()) {
                socket.emit('rideExtensionError', {
                    error: 'Fluxo de extensão de corrida desabilitado no momento.'
                });
                return;
            }

            const customerId = socket.userId || data.customerId;
            const bookingId = data.bookingId || data.rideId;
            const newEndLocation = data.newEndLocation || data.newDrop;
            const newFare = data.newFare;

            if (!customerId || !bookingId || !newEndLocation || !newFare) {
                socket.emit('rideExtensionError', { error: 'Dados incompletos para extensão da corrida' });
                return;
            }

            logStructured('info', 'Solicitação de extensão de rota recebida', { bookingId, customerId });

            const RequestRideExtensionCommand = require('../commands/RequestRideExtensionCommand');
            const command = new RequestRideExtensionCommand({
                bookingId,
                customerId,
                newEndLocation,
                newFare,
                routeDistanceKm: data.routeDistanceKm ?? data.routeDistance ?? null,
                routeDurationSecs: data.routeDurationSecs ?? data.routeDuration ?? null,
                correlationId: bookingId
            });

            const result = await command.execute();

            if (!result.success) {
                socket.emit('rideExtensionError', { error: result.error });
                return;
            }

            socket.emit('rideExtensionRequestAccepted', result.data);

            const redis = redisPool.getConnection();
            let driverId = null;

            const bookingDataStr = await redis.hget('bookings:active', bookingId);
            if (bookingDataStr) {
                try {
                    const booking = JSON.parse(bookingDataStr);
                    driverId = booking?.driverId || null;
                } catch (_error) {
                    driverId = null;
                }
            }

            if (!driverId) {
                const bookingHash = await redis.hgetall(`booking:${bookingId}`);
                driverId = bookingHash?.driverId || null;
            }

            if (driverId) {
                io.to(`driver_${driverId}`).emit('rideExtensionApprovalRequested', {
                    bookingId,
                    requestId: result.data.requestId,
                    currentFare: result.data.currentFare,
                    newFare: result.data.newFare,
                    diffFare: result.data.diffFare,
                    newEndLocation,
                    message: 'Passageiro solicitou extensão da rota. Aceite ou recuse a alteração.'
                });
            }

        } catch (error) {
            logError(error, 'Erro em requestRideExtension', { bookingId: data.bookingId });
            socket.emit('rideExtensionError', { error: 'Erro interno ao processar extensão' });
        }
    });

    socket.on('respondRideExtension', async (data) => {
        try {
            if (!isRideExtensionFlowEnabled()) {
                socket.emit('rideExtensionResponseError', {
                    error: 'Fluxo de extensão de corrida desabilitado no momento.'
                });
                return;
            }

            const driverId = socket.userId || data.driverId;
            const bookingId = data.bookingId || data.rideId;
            const accepted = data.accepted === true;

            if (!driverId || !bookingId) {
                socket.emit('rideExtensionResponseError', { error: 'bookingId e driverId são obrigatórios' });
                return;
            }

            const RespondRideExtensionCommand = require('../commands/RespondRideExtensionCommand');
            const command = new RespondRideExtensionCommand({
                bookingId,
                driverId,
                accepted,
                mockPayment: data.mockPayment === true || data.__mockPayment === true,
                correlationId: bookingId
            });

            const result = await command.execute();
            if (!result.success) {
                socket.emit('rideExtensionResponseError', { error: result.error });
                return;
            }

            const extensionRequest = result.data.extensionRequest || {};
            const passengerId = extensionRequest.requestedBy || null;

            if (!accepted) {
                const payload = {
                    success: true,
                    bookingId,
                    status: 'DRIVER_DECLINED',
                    message: 'O motorista recusou a extensão da corrida.',
                    extensionRequest
                };
                socket.emit('rideExtensionRejected', payload);
                if (passengerId) {
                    io.to(`customer_${passengerId}`).emit('rideExtensionRejected', payload);
                }
                return;
            }

            const passengerPayload = {
                success: true,
                bookingId,
                status: 'PENDING_PAYMENT',
                diffFare: result.data.payment.diffFare,
                newFare: result.data.payment.newFare,
                chargeId: result.data.payment.chargeId,
                pixQRCode: result.data.payment.pixQRCode,
                paymentLink: result.data.payment.paymentLink,
                brCode: result.data.payment.brCode,
                expiresAt: result.data.payment.expiresAt || extensionRequest.expiresAt || null,
                newEndLocation: extensionRequest.newEndLocation,
                message: 'Motorista aceitou a extensão. Pague o complemento Pix para confirmar o novo destino.'
            };

            socket.emit('rideExtensionPendingPayment', passengerPayload);
            if (passengerId) {
                io.to(`customer_${passengerId}`).emit('rideExtensionPaymentRequired', passengerPayload);
            }
        } catch (error) {
            logError(error, 'Erro em respondRideExtension', { bookingId: data.bookingId });
            socket.emit('rideExtensionResponseError', { error: 'Erro interno ao responder extensão' });
        }
    });

    socket.on('interruptRideOperational', async (data) => {
        try {
            if (!isOperationalReassignmentEnabled()) {
                socket.emit('rideOperationalInterruptionError', {
                    error: 'Continuidade operacional com reatribuição está desabilitada no momento.'
                });
                return;
            }

            const driverId = socket.userId || data.driverId || socket.id;
            const bookingId = data.bookingId;
            const interruptionLocation = data.interruptionLocation || data.endLocation;
            const distanceKm = Number.parseFloat(data.distanceKm ?? data.distance ?? 0) || 0;
            const durationSecs = Number.parseFloat(data.durationSecs ?? data.duration ?? 0) || 0;
            const reason = String(data.reason || 'VEHICLE_BREAKDOWN').trim() || 'VEHICLE_BREAKDOWN';
            const note = String(data.note || '').trim();

            if (!bookingId || !interruptionLocation?.lat || !interruptionLocation?.lng) {
                socket.emit('rideOperationalInterruptionError', {
                    error: 'bookingId e interruptionLocation são obrigatórios'
                });
                return;
            }

            const InterruptRideOperationalCommand = require('../commands/InterruptRideOperationalCommand');
            const command = new InterruptRideOperationalCommand({
                bookingId,
                driverId,
                interruptionLocation,
                distanceKm,
                durationSecs,
                reason,
                note,
                correlationId: bookingId
            });

            const result = await command.execute();
            if (!result.success) {
                socket.emit('rideOperationalInterruptionError', {
                    error: result.error || 'Erro ao interromper corrida'
                });
                return;
            }

            const payload = {
                success: true,
                bookingId,
                reason,
                note,
                interruption: result.data.interruption,
                rideLegs: result.data.rideLegs,
                message: 'Corrida interrompida por motivo operacional. Aguardando decisão do passageiro.'
            };

            socket.emit('rideOperationalInterrupted', payload);
            if (result.data.customerId) {
                io.to(`customer_${result.data.customerId}`).emit('rideOperationalInterruption', {
                    ...payload,
                    message: 'Seu motorista não consegue continuar. Deseja seguir com outro parceiro?'
                });
            }
        } catch (error) {
            logError(error, 'Erro em interruptRideOperational', { bookingId: data.bookingId });
            socket.emit('rideOperationalInterruptionError', {
                error: 'Erro interno ao interromper corrida'
            });
        }
    });

    socket.on('respondOperationalContinuation', async (data) => {
        try {
            if (!isOperationalReassignmentEnabled()) {
                socket.emit('rideOperationalContinuationError', {
                    error: 'Continuidade operacional com reatribuição está desabilitada no momento.'
                });
                return;
            }

            const customerId = socket.userId || data.customerId || socket.id;
            const bookingId = data.bookingId;
            const continueTrip = data.continueTrip === true || data.accepted === true;

            if (!bookingId) {
                socket.emit('rideOperationalContinuationError', { error: 'bookingId é obrigatório' });
                return;
            }

            const RespondOperationalContinuationCommand = require('../commands/RespondOperationalContinuationCommand');
            const command = new RespondOperationalContinuationCommand({
                bookingId,
                customerId,
                continueTrip,
                correlationId: bookingId
            });

            const result = await command.execute();
            if (!result.success) {
                socket.emit('rideOperationalContinuationError', {
                    error: result.error || 'Erro ao responder continuidade'
                });
                return;
            }

            if (result.data.continueTrip) {
                const { triggerDispatchAfterPayment } = require('../services/payment-dispatch-service');
                const dispatchResult = await triggerDispatchAfterPayment({
                    bookingId,
                    io,
                    pickupLocation: result.data.pickupLocation,
                    source: 'operational_reassignment',
                    force: true
                });

                const payload = {
                    success: true,
                    bookingId,
                    status: 'REASSIGNMENT_PENDING',
                    pickupLocation: result.data.pickupLocation,
                    previousDriverId: result.data.previousDriverId,
                    dispatchResult,
                    rideLegs: result.data.rideLegs,
                    message: 'Estamos procurando outro motorista parceiro para continuar a corrida.'
                };

                socket.emit('rideOperationalContinuationSearching', payload);
                io.to(`customer_${customerId}`).emit('rideOperationalContinuationSearching', payload);
                if (result.data.previousDriverId) {
                    io.to(`driver_${result.data.previousDriverId}`).emit('rideOperationalReleased', {
                        success: true,
                        bookingId,
                        message: 'O passageiro optou por continuar com outro parceiro.'
                    });
                }
                const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
                scheduleMapH3Refresh(io, {
                    reason: 'operational_continuation_searching',
                    bookingId,
                    driverId: result.data.previousDriverId || null
                });
                return;
            }

            const PaymentService = require('../services/payment-service');
            const { buildTripCompletedPayload } = require('../utils/trip-completion-payload');
            const paymentService = new PaymentService();
            const fareBreakdown = paymentService.calculateFareBreakdownFromReais(
                Number(result.data.finalFare || 0),
                0
            );
            const redis = redisPool.getConnection();
            const bookingSnapshot = await redis.hgetall(`booking:${bookingId}`);
            const endLocation = result.data.interruption?.pickupLocation;
            const tripCompletedData = buildTripCompletedPayload({
                bookingId,
                message: 'Corrida encerrada por interrupção operacional',
                bookingData: bookingSnapshot,
                resultEndLocation: endLocation,
                endLocation,
                distance: result.data.distance,
                duration: result.data.duration,
                fareBreakdown,
                paymentDistribution: {
                    status: 'PENDING',
                    message: 'Distribuição financeira em processamento assíncrono'
                },
                completionType: 'INTERRUPTED_OPERATIONAL_ENDED',
                settlement: result.data.settlement || {
                    estimatedRefund: result.data.interruption?.estimatedRefund || 0,
                    remainingReservedAmount: result.data.interruption?.remainingReservedAmount || 0
                },
                rideLegs: result.data.rideLegs,
                operationalContinuation: result.data.interruption,
                persistence: 'accepted_background'
            });

            if (result.data.driverId) {
                io.to(`driver_${result.data.driverId}`).emit('tripCompleted', tripCompletedData);
            }
            io.to(`customer_${customerId}`).emit('tripCompleted', tripCompletedData);
            const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
            scheduleMapH3Refresh(io, {
                reason: 'operational_interruption_ended',
                bookingId,
                driverId: result.data.driverId || null
            });
        } catch (error) {
            logError(error, 'Erro em respondOperationalContinuation', { bookingId: data.bookingId });
            socket.emit('rideOperationalContinuationError', {
                error: 'Erro interno ao responder continuidade'
            });
        }
    });

    socket.on('endRideWithReview', async (data) => {
        try {
            const actorId = socket.userId || data.actorId || data.userId || socket.id;
            const bookingId = data.bookingId;
            const endLocation = data.endLocation || data.interruptionLocation;
            const distanceKm = Number.parseFloat(data.distanceKm ?? data.distance ?? 0) || 0;
            const durationSecs = Number.parseFloat(data.durationSecs ?? data.duration ?? 0) || 0;
            const actorType = data.actorType || 'system';
            const reviewCategory = data.reviewCategory || 'TECHNICAL_FAILURE';
            const reason = data.reason || 'MANUAL_REVIEW_REQUIRED';
            const note = String(data.note || '').trim();

            if (!bookingId || !endLocation?.lat || !endLocation?.lng) {
                socket.emit('endRideWithReviewError', {
                    error: 'bookingId e endLocation são obrigatórios'
                });
                return;
            }

            const EndRideWithReviewCommand = require('../commands/EndRideWithReviewCommand');
            const command = new EndRideWithReviewCommand({
                bookingId,
                actorId,
                actorType,
                endLocation,
                distanceKm,
                durationSecs,
                reviewCategory,
                reason,
                note,
                correlationId: bookingId
            });

            const result = await command.execute();
            if (!result.success) {
                socket.emit('endRideWithReviewError', {
                    error: result.error || 'Erro ao encerrar corrida para revisão'
                });
                return;
            }

            const PaymentService = require('../services/payment-service');
            const { buildTripCompletedPayload } = require('../utils/trip-completion-payload');
            const paymentService = new PaymentService();
            const fareBreakdown = paymentService.calculateFareBreakdownFromReais(
                Number(result.data.finalFare || 0),
                0
            );
            const redis = redisPool.getConnection();
            const bookingSnapshot = await redis.hgetall(`booking:${bookingId}`);
            const tripCompletedData = buildTripCompletedPayload({
                bookingId,
                message: 'Corrida encerrada e encaminhada para revisão manual',
                bookingData: bookingSnapshot,
                resultEndLocation: result.data.endLocation,
                endLocation: result.data.endLocation,
                distance: result.data.distance,
                duration: result.data.duration,
                fareBreakdown,
                paymentDistribution: result.data.paymentDistribution,
                completionType: 'EARLY_ENDED_REVIEW',
                settlement: result.data.settlement,
                rideLegs: result.data.rideLegs,
                operationalContinuation: result.data.interruption || null,
                reviewContext: result.data.reviewContext,
                persistence: 'accepted_background'
            });

            if (result.data.driverId) {
                io.to(`driver_${result.data.driverId}`).emit('tripCompleted', tripCompletedData);
            }
            if (result.data.customerId) {
                io.to(`customer_${result.data.customerId}`).emit('tripCompleted', tripCompletedData);
            }

            socket.emit('rideEndedWithReview', {
                success: true,
                bookingId,
                reviewContext: result.data.reviewContext,
                settlement: result.data.settlement
            });

            const { scheduleMapH3Refresh } = require('../utils/map-h3-refresh-broadcaster');
            scheduleMapH3Refresh(io, {
                reason: 'trip_review_completed',
                bookingId,
                driverId: result.data.driverId || null
            });
        } catch (error) {
            logError(error, 'Erro em endRideWithReview', { bookingId: data.bookingId });
            socket.emit('endRideWithReviewError', {
                error: 'Erro interno ao encerrar corrida para revisão'
            });
        }
    });
}

module.exports = registerSocketActiveRideHandlers;
