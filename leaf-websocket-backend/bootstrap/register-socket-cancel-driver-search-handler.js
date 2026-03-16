function registerSocketCancelDriverSearchHandler({
    socket,
    logStructured
}) {
    socket.on('cancelDriverSearch', async (data) => {
        try {
            logStructured('info', 'Busca de motoristas cancelada', {
                service: 'server',
                userId: socket.userId || socket.id,
                bookingId: data?.bookingId,
                reason: data?.reason,
                eventType: 'cancelDriverSearch'
            });

            const { bookingId, reason } = data;

            // Emitir confirmação
            socket.emit('driverSearchCancelled', {
                success: true,
                bookingId,
                reason: reason || 'Cancelado pelo usuário',
                message: 'Busca cancelada com sucesso'
            });

            logStructured('info', 'Busca de motoristas cancelada para corrida', {
                service: 'websocket',
                operation: 'cancelSearch',
                bookingId
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
