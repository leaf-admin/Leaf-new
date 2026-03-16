function registerSocketUpdateDriverLocationHandler({
    socket,
    rateLimiterService,
    logStructured,
    saveDriverLocation
}) {
    socket.on('updateDriverLocation', async (data) => {
        try {
            // ✅ NOVO: Rate Limiting (leve para não afetar GPS)
            const driverId = socket.userId || data.driverId || socket.id;
            const rateLimitCheck = await rateLimiterService.checkRateLimit(driverId, 'updateDriverLocation');

            if (!rateLimitCheck.allowed) {
                // Para GPS, apenas logar mas não bloquear (fail-open para não afetar rastreamento)
                logStructured('warn', `updateDriverLocation excedido para ${driverId}, mas permitindo (GPS crítico)`, {
                    service: 'RateLimiter',
                    driverId,
                    action: 'updateDriverLocation'
                });
                // Continuar processamento (GPS é crítico)
            }

            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                logStructured('debug', 'Localização do driver atualizada', {
                    service: 'server',
                    driverId: socket.userId || socket.id,
                    location: { lat: data?.lat, lng: data?.lng },
                    eventType: 'updateLocation'
                });
            }

            const { lat, lng, heading, speed, timestamp } = data;

            if (!driverId || !lat || !lng) {
                socket.emit('locationError', { error: 'Dados de localização incompletos' });
                return;
            }

            await saveDriverLocation(driverId, lat, lng, heading, speed, timestamp);

            // Emitir confirmação
            socket.emit('locationUpdated', {
                success: true,
                driverId,
                message: 'Localização atualizada com sucesso',
                data: {
                    driverId,
                    location: { lat, lng },
                    heading: heading || 0,
                    speed: speed || 0,
                    timestamp: timestamp || Date.now()
                }
            });

            // Notificar outros clientes sobre mudança de localização
            socket.broadcast.emit('driverLocationUpdated', {
                driverId,
                location: { lat, lng },
                heading,
                speed,
                timestamp: timestamp || Date.now()
            });

            logStructured('info', 'Localização do driver atualizada', {
                service: 'server',
                driverId,
                location: { lat, lng },
                eventType: 'updateLocation'
            });

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização do driver', {
                service: 'websocket',
                operation: 'updateDriverLocation',
                driverId: socket.userId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('locationError', { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketUpdateDriverLocationHandler;
