function registerSocketLegacyNotificationHandlers({
    socket,
    logStructured,
    logError
}) {
    // NOTIFICAÇÕES FCM (Handlers agora registrados no topo da função connection)

    // Enviar notificação
    socket.on('sendNotification', async (data) => {
        try {
            logStructured('info', `Notificação enviada`, { service: 'sendNotification', userId: data.userId, userType: data.userType });

            const { userId, userType, notification, timestamp } = data;

            if (!notification) {
                socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                return;
            }

            // Simular envio de notificação
            const notificationData = {
                notificationId: `notif_${Date.now()}`,
                userId,
                userType,
                notification,
                timestamp: timestamp || new Date().toISOString(),
                status: 'sent'
            };

            // Emitir confirmação
            socket.emit('notificationSent', {
                success: true,
                notificationId: notificationData.notificationId,
                message: 'Notificação enviada com sucesso',
                data: notificationData
            });

            logStructured('info', `Notificação enviada`, { service: 'sendNotification', notificationId: notificationData.notificationId });

        } catch (error) {
            logError(error, 'Erro ao enviar notificação', { service: 'sendNotification' });
            socket.emit('notificationError', { error: 'Erro interno do servidor' });
        }
    });

    // Enviar notificação para usuário específico
    socket.on('sendNotificationToUser', async (data) => {
        try {
            logStructured('info', `Notificação para usuário`, { service: 'sendNotificationToUser', userId: data.userId });

            const { userId, notification, timestamp } = data;

            if (!userId || !notification) {
                socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                return;
            }

            // Simular envio de notificação para usuário específico
            const notificationData = {
                notificationId: `notif_user_${Date.now()}`,
                targetUserId: userId,
                notification,
                timestamp: timestamp || new Date().toISOString(),
                status: 'sent'
            };

            // Emitir confirmação
            socket.emit('notificationSentToUser', {
                success: true,
                notificationId: notificationData.notificationId,
                targetUserId: userId,
                message: 'Notificação enviada para usuário com sucesso',
                data: notificationData
            });

            logStructured('info', `Notificação enviada para usuário`, { service: 'sendNotificationToUser', userId, notificationId: notificationData.notificationId });

        } catch (error) {
            logError(error, 'Erro ao enviar notificação para usuário', { service: 'sendNotificationToUser', userId: data.userId });
            socket.emit('notificationError', { error: 'Erro interno do servidor' });
        }
    });

    // Enviar notificação para todos os usuários de um tipo
    socket.on('sendNotificationToUserType', async (data) => {
        try {
            logStructured('info', 'Notificação para tipo de usuário', {
                service: 'sendNotificationToUserType',
                userType: data.userType
            });

            const { userType, notification, timestamp } = data;

            if (!userType || !notification) {
                socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                return;
            }

            // Simular envio de notificação para tipo de usuário
            const notificationData = {
                notificationId: `notif_type_${Date.now()}`,
                targetUserType: userType,
                notification,
                timestamp: timestamp || new Date().toISOString(),
                status: 'sent'
            };

            // Emitir confirmação
            socket.emit('notificationSentToUserType', {
                success: true,
                notificationId: notificationData.notificationId,
                targetUserType: userType,
                message: 'Notificação enviada para tipo de usuário com sucesso',
                data: notificationData
            });

            logStructured('info', 'Notificação enviada para tipo de usuário', {
                service: 'sendNotificationToUserType',
                userType,
                notificationId: notificationData.notificationId
            });

        } catch (error) {
            logError(error, 'Erro ao enviar notificação para tipo de usuário', { service: 'sendNotificationToUserType', userType: data.userType });
            socket.emit('notificationError', { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketLegacyNotificationHandlers;
