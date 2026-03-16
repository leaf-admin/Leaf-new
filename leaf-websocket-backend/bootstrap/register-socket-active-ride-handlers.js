function registerSocketActiveRideHandlers({
    socket,
    io,
    redisPool,
    logStructured,
    logError
}) {
    // ==================== NOVOS EVENTOS - GERENCIAMENTO DE CORRIDA EM ANDAMENTO ====================

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
            const customerId = socket.userId || data.customerId;
            const { bookingId, newEndLocation, newFare } = data;

            if (!customerId || !bookingId || !newEndLocation || !newFare) {
                socket.emit('rideExtensionError', { error: 'Dados incompletos para extensão da corrida' });
                return;
            }

            logStructured('info', 'Solicitação de extensão de rota recebida', { bookingId, customerId });

            const ExtendRideCommand = require('../commands/ExtendRideCommand');
            const command = new ExtendRideCommand({
                bookingId,
                customerId,
                newEndLocation,
                newFare,
                correlationId: bookingId
            });

            const result = await command.execute();

            if (!result.success) {
                socket.emit('rideExtensionError', { error: result.error });
                return;
            }

            // Enviar QR Code Pix para o passageiro pagar a diferença
            socket.emit('rideExtensionPaymentRequired', result.data);

            // Avisar o motorista que uma extensão está aguardando pagamento
            const redis = redisPool.getConnection();
            const bookingDataStr = await redis.hget('bookings:active', bookingId);
            if (bookingDataStr) {
                const booking = JSON.parse(bookingDataStr);
                if (booking.driverId) {
                    io.to(`driver_${booking.driverId}`).emit('rideExtensionRequested', {
                        bookingId,
                        message: 'Passageiro solicitou extensão da rota. Aguardando pagamento Pix...'
                    });
                }
            }

        } catch (error) {
            logError(error, 'Erro em requestRideExtension', { bookingId: data.bookingId });
            socket.emit('rideExtensionError', { error: 'Erro interno ao processar extensão' });
        }
    });
}

module.exports = registerSocketActiveRideHandlers;
