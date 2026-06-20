function registerSocketCancelDriverSearchHandler({
    socket,
    logStructured
}) {
    socket.on('cancelDriverSearch', async (data) => {
        try {
            logStructured('warn', 'cancelDriverSearch rejeitado: cancelamento canônico exige cancelRide', {
                service: 'server',
                userId: socket.userId || socket.id,
                bookingId: data?.bookingId,
                reason: data?.reason,
                eventType: 'cancelDriverSearch'
            });

            const { bookingId, reason } = data;

            if (!bookingId) {
                socket.emit('driverSearchCancelled', {
                    success: false,
                    code: 'BOOKING_ID_REQUIRED',
                    error: 'ID da corrida obrigatório'
                });
                return;
            }

            socket.emit('driverSearchCancelled', {
                success: false,
                bookingId,
                reason: reason || 'Cancelado pelo usuário',
                code: 'CANONICAL_CANCEL_REQUIRED',
                error: 'Use cancelRide para encerrar a busca e reconciliar pagamento e estado'
            });

        } catch (error) {
            logStructured('error', 'Erro ao cancelar busca', {
                service: 'websocket',
                operation: 'cancelSearch',
                bookingId: data.bookingId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('driverSearchError', { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketCancelDriverSearchHandler;
