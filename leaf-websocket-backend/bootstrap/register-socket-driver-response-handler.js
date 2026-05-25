function registerSocketDriverResponseHandler({ socket, io, logStructured }) {
    // Resposta do motorista
    socket.on('driverResponse', async (data) => {
        try {
            logStructured('info', 'Resposta do motorista recebida', {
                service: 'websocket',
                userId: socket.userId || socket.id,
                bookingId: data?.bookingId,
                accepted: data?.accepted,
                eventType: 'driverResponse'
            });

            const { bookingId, accepted, reason } = data;

            if (!bookingId || accepted === undefined) {
                socket.emit('driverResponseError', { error: 'Dados incompletos para resposta do motorista' });
                return;
            }

            if (accepted) {
                // Motorista aceitou
                socket.emit('rideAccepted', {
                    success: true,
                    bookingId,
                    message: 'Corrida aceita com sucesso',
                    driverId: socket.id
                });

                // Notificar cliente
                io.emit('rideAccepted', {
                    success: true,
                    bookingId,
                    message: 'Motorista aceitou sua corrida',
                    driverId: socket.id
                });

                logStructured('info', 'Motorista aceitou corrida', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: socket.userId,
                    bookingId
                });
            } else {
                // Motorista recusou
                socket.emit('rideRejected', {
                    success: true,
                    bookingId,
                    message: 'Corrida recusada',
                    reason: reason || 'Motorista não disponível'
                });

                logStructured('info', 'Motorista recusou corrida', {
                    service: 'websocket',
                    socketId: socket.id,
                    userId: socket.userId,
                    bookingId,
                    reason: reason || 'Motorista não disponível'
                });
            }

        } catch (error) {
            logStructured('error', 'Erro na resposta do motorista', {
                service: 'websocket',
                socketId: socket.id,
                userId: socket.userId,
                bookingId,
                error: error.message,
                stack: error.stack
            });
            socket.emit('driverResponseError', { error: 'Erro ao processar resposta' });
        }
    });
}

module.exports = registerSocketDriverResponseHandler;
