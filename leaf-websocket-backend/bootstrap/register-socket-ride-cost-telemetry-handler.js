function registerSocketRideCostTelemetryHandler({
    socket,
    logStructured,
    rideCostTelemetryService
}) {
    if (!rideCostTelemetryService) {
        return;
    }

    socket.on('rideCostTelemetry', async (data = {}) => {
        const bookingId = typeof data?.bookingId === 'string' ? data.bookingId.trim() : '';
        if (!bookingId || !data?.snapshot || typeof data.snapshot !== 'object') {
            return;
        }

        if (!socket.userId) {
            logStructured('warn', 'Telemetria de custo recebida sem usuário autenticado', {
                bookingId,
                socketId: socket.id,
                eventType: 'rideCostTelemetry'
            });
            return;
        }

        try {
            await rideCostTelemetryService.ingestSnapshot({
                bookingId,
                sourceMeta: {
                    ...data?.sourceMeta,
                    userId: socket.userId,
                    userType: socket.userType || data?.sourceMeta?.userType || 'unknown',
                    socketId: socket.id
                },
                snapshot: data.snapshot,
                pricingSheet: data?.pricingSheet || null,
                requestMeta: {
                    source: 'socket.rideCostTelemetry',
                    socketId: socket.id,
                    receivedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logStructured('warn', 'Falha ao persistir telemetria de custo da corrida', {
                bookingId,
                socketId: socket.id,
                userId: socket.userId,
                eventType: 'rideCostTelemetry',
                error: error.message
            });
        }
    });
}

module.exports = registerSocketRideCostTelemetryHandler;
