const RideStateManager = require('../services/ride-state-manager');

function boolEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return ['true', '1', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function isLegacyDriverResponseAcceptEnabled() {
    if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
        return false;
    }
    return boolEnv('ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT', false);
}

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
                if (!isLegacyDriverResponseAcceptEnabled()) {
                    socket.emit('driverResponseError', {
                        code: 'LEGACY_DRIVER_RESPONSE_ACCEPT_DISABLED',
                        error: 'Aceite legado desabilitado; use o fluxo acceptRide',
                        bookingId
                    });
                    logStructured('warn', 'Aceite legado via driverResponse bloqueado', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: socket.userId,
                        bookingId,
                        eventType: 'driverResponse'
                    });
                    return;
                }

                const activeBooking = io.activeBookings?.get(bookingId) || null;
                const customerId =
                    activeBooking?.customerId ||
                    activeBooking?.customer ||
                    activeBooking?.passengerId ||
                    activeBooking?.passenger ||
                    null;
                const normalizedStatus = String(activeBooking?.status || '').trim().toUpperCase();
                const isTerminalBooking = RideStateManager.isTerminalStateValue(normalizedStatus);

                if (isTerminalBooking) {
                    socket.emit('driverResponseError', {
                        error: 'Corrida já encerrada',
                        bookingId
                    });
                    logStructured('warn', 'driverResponse bloqueado para corrida terminal', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: socket.userId,
                        bookingId,
                        status: normalizedStatus,
                        eventType: 'driverResponse'
                    });
                    return;
                }

                // Motorista aceitou
                socket.emit('rideAccepted', {
                    success: true,
                    bookingId,
                    message: 'Corrida aceita com sucesso',
                    driverId: socket.userId || socket.id
                });

                if (customerId) {
                    io.to(`customer_${customerId}`).emit('rideAccepted', {
                        success: true,
                        bookingId,
                        message: 'Motorista aceitou sua corrida',
                        driverId: socket.userId || socket.id
                    });
                } else {
                    logStructured('warn', 'rideAccepted legado sem customerId resolvido; fan-out global bloqueado', {
                        service: 'websocket',
                        socketId: socket.id,
                        userId: socket.userId,
                        bookingId,
                        eventType: 'driverResponse'
                    });
                }

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
module.exports.isLegacyDriverResponseAcceptEnabled = isLegacyDriverResponseAcceptEnabled;
