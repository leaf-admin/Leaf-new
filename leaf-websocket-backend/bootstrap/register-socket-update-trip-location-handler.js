function registerSocketUpdateTripLocationHandler({
    socket,
    io,
    logStructured
}) {
    socket.on('updateTripLocation', async (data) => {
        try {
            const { bookingId, lat, lng, heading, speed } = data;

            if (!bookingId || !lat || !lng) {
                // Não emitir erro para não interromper atualizações frequentes
                // Apenas logar em desenvolvimento
                if (process.env.NODE_ENV !== 'production') {
                    logStructured('warn', 'Dados incompletos para atualização de localização da viagem', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        data
                    });
                }
                return;
            }

            // Simular atualização no Redis/Firebase para trip específica
            const tripLocationData = {
                bookingId,
                location: { lat, lng },
                heading: heading || 0,
                speed: speed || 0,
                timestamp: Date.now(),
                lastUpdate: new Date().toISOString()
            };

            // Notificar cliente sobre atualização de localização do driver durante viagem
            io.emit('tripLocationUpdated', {
                bookingId,
                location: { lat, lng },
                heading: heading || 0,
                speed: speed || 0,
                timestamp: tripLocationData.timestamp
            });

            // Log apenas a cada 10 atualizações para não poluir logs
            if (Math.random() < 0.1) {
                if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                    logStructured('debug', 'Localização da viagem atualizada', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        bookingId,
                        lat: lat.toFixed(6),
                        lng: lng.toFixed(6)
                    });
                }
            }

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização da viagem', {
                service: 'websocket',
                operation: 'updateLocation',
                bookingId: data.bookingId,
                error: error.message,
                stack: error.stack
            });
            // Não emitir erro para não interromper fluxo de atualizações
        }
    });
}

module.exports = registerSocketUpdateTripLocationHandler;
