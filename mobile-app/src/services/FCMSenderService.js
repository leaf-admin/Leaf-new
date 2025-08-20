import { store } from '../common-local/store';

class FCMSenderService {
    constructor() {
        this.baseUrl = 'https://fcm.googleapis.com/fcm/send';
        this.serverKey = null; // Será configurado via setServerKey
    }

    // Configurar chave do servidor FCM
    setServerKey(serverKey) {
        this.serverKey = serverKey;
        console.log('🔑 Chave do servidor FCM configurada');
    }

    // Verificar se o serviço está configurado
    isConfigured() {
        return !!this.serverKey;
    }

    // Enviar notificação para um usuário específico
    async sendToUser(userId, notification) {
        try {
            if (!this.isConfigured()) {
                throw new Error('Serviço FCM não configurado. Use setServerKey() primeiro.');
            }

            // Obter token FCM do usuário
            const fcmToken = await this.getUserFCMToken(userId);
            
            if (!fcmToken) {
                console.log(`⚠️ Usuário ${userId} não possui token FCM`);
                return { success: false, error: 'Token FCM não encontrado' };
            }

            // Enviar notificação
            const result = await this.sendToToken(fcmToken, notification);
            
            if (result.success) {
                console.log(`✅ Notificação enviada para usuário ${userId}`);
            }

            return result;

        } catch (error) {
            console.error('❌ Erro ao enviar notificação para usuário:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação para múltiplos usuários
    async sendToUsers(userIds, notification) {
        try {
            if (!this.isConfigured()) {
                throw new Error('Serviço FCM não configurado. Use setServerKey() primeiro.');
            }

            const results = [];
            
            for (const userId of userIds) {
                const result = await this.sendToUser(userId, notification);
                results.push({ userId, result });
            }

            const successCount = results.filter(r => r.result.success).length;
            console.log(`📤 Notificações enviadas: ${successCount}/${userIds.length} com sucesso`);

            return {
                success: true,
                results,
                summary: {
                    total: userIds.length,
                    success: successCount,
                    failed: userIds.length - successCount
                }
            };

        } catch (error) {
            console.error('❌ Erro ao enviar notificações para múltiplos usuários:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação para um token FCM específico
    async sendToToken(fcmToken, notification) {
        try {
            if (!this.isConfigured()) {
                throw new Error('Serviço FCM não configurado. Use setServerKey() primeiro.');
            }

            const message = {
                to: fcmToken,
                notification: {
                    title: notification.title,
                    body: notification.body,
                    sound: notification.sound || 'default',
                    badge: notification.badge || 1,
                    icon: notification.icon || 'ic_launcher',
                    color: notification.color || '#4CAF50',
                    click_action: notification.clickAction || 'FLUTTER_NOTIFICATION_CLICK'
                },
                data: {
                    ...notification.data,
                    timestamp: new Date().toISOString(),
                    type: notification.type || 'general'
                },
                priority: notification.priority || 'high',
                android: {
                    priority: 'high',
                    notification: {
                        sound: notification.sound || 'default',
                        channel_id: notification.channelId || 'default',
                        priority: 'high',
                        default_sound: true,
                        default_vibrate_timings: true,
                        default_light_settings: true
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: notification.sound || 'default',
                            badge: notification.badge || 1,
                            category: notification.category || 'general'
                        }
                    }
                }
            };

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `key=${this.serverKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(message)
            });

            const result = await response.json();

            if (response.ok && result.success === 1) {
                return { success: true, messageId: result.results?.[0]?.message_id };
            } else {
                throw new Error(result.results?.[0]?.error || 'Falha ao enviar notificação');
            }

        } catch (error) {
            console.error('❌ Erro ao enviar notificação para token:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação para um tópico
    async sendToTopic(topic, notification) {
        try {
            if (!this.isConfigured()) {
                throw new Error('Serviço FCM não configurado. Use setServerKey() primeiro.');
            }

            const message = {
                to: `/topics/${topic}`,
                notification: {
                    title: notification.title,
                    body: notification.body,
                    sound: notification.sound || 'default',
                    badge: notification.badge || 1,
                    icon: notification.icon || 'ic_launcher',
                    color: notification.color || '#4CAF50'
                },
                data: {
                    ...notification.data,
                    timestamp: new Date().toISOString(),
                    type: notification.type || 'general'
                },
                priority: notification.priority || 'high'
            };

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `key=${this.serverKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(message)
            });

            const result = await response.json();

            if (response.ok && result.success === 1) {
                console.log(`✅ Notificação enviada para tópico: ${topic}`);
                return { success: true, messageId: result.message_id };
            } else {
                throw new Error('Falha ao enviar notificação para tópico');
            }

        } catch (error) {
            console.error('❌ Erro ao enviar notificação para tópico:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação de viagem
    async sendTripNotification(userId, tripData, notificationType) {
        try {
            const notification = this.createTripNotification(tripData, notificationType);
            return await this.sendToUser(userId, notification);

        } catch (error) {
            console.error('❌ Erro ao enviar notificação de viagem:', error);
            return { success: false, error: error.message };
        }
    }

    // Criar notificação de viagem
    createTripNotification(tripData, notificationType) {
        const baseData = {
            tripId: tripData.id || tripData.tripId,
            type: 'trip_update',
            ...tripData
        };

        switch (notificationType) {
            case 'driver_found':
                return {
                    title: '🚗 Motorista encontrado!',
                    body: 'Seu motorista está a caminho. Prepare-se para a viagem.',
                    data: { ...baseData, action: 'driver_found' },
                    priority: 'high',
                    sound: 'default',
                    badge: 1
                };

            case 'driver_arrived':
                return {
                    title: '📍 Motorista chegou!',
                    body: 'Seu motorista chegou ao local de embarque.',
                    data: { ...baseData, action: 'driver_arrived' },
                    priority: 'high',
                    sound: 'default',
                    badge: 1
                };

            case 'trip_started':
                return {
                    title: '🚀 Viagem iniciada!',
                    body: 'Sua viagem começou. Aproveite o trajeto!',
                    data: { ...baseData, action: 'trip_started' },
                    priority: 'normal',
                    sound: 'default',
                    badge: 1
                };

            case 'trip_completed':
                return {
                    title: '✅ Viagem concluída!',
                    body: 'Sua viagem foi finalizada. Avalie sua experiência!',
                    data: { ...baseData, action: 'trip_completed' },
                    priority: 'normal',
                    sound: 'default',
                    badge: 1
                };

            case 'payment_confirmed':
                return {
                    title: '💳 Pagamento confirmado!',
                    body: 'Seu pagamento foi processado com sucesso.',
                    data: { ...baseData, action: 'payment_confirmed' },
                    priority: 'normal',
                    sound: 'default',
                    badge: 1
                };

            default:
                return {
                    title: '🚗 Atualização da viagem',
                    body: 'Você recebeu uma atualização sobre sua viagem.',
                    data: { ...baseData, action: notificationType },
                    priority: 'normal',
                    sound: 'default',
                    badge: 1
                };
        }
    }

    // Enviar notificação de avaliação
    async sendRatingNotification(userId, ratingData) {
        try {
            const notification = {
                title: '⭐ Nova avaliação recebida!',
                body: 'Alguém avaliou sua viagem. Veja os detalhes!',
                data: {
                    type: 'rating_received',
                    ratingId: ratingData.id,
                    tripId: ratingData.tripId,
                    rating: ratingData.rating,
                    comment: ratingData.comment,
                    timestamp: new Date().toISOString()
                },
                priority: 'normal',
                sound: 'default',
                badge: 1
            };

            return await this.sendToUser(userId, notification);

        } catch (error) {
            console.error('❌ Erro ao enviar notificação de avaliação:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação de pagamento
    async sendPaymentNotification(userId, paymentData) {
        try {
            const notification = {
                title: '💳 Atualização de pagamento',
                body: 'Você recebeu uma atualização sobre seu pagamento.',
                data: {
                    type: 'payment_update',
                    paymentId: paymentData.id,
                    amount: paymentData.amount,
                    status: paymentData.status,
                    timestamp: new Date().toISOString()
                },
                priority: 'high',
                sound: 'default',
                badge: 1
            };

            return await this.sendToUser(userId, notification);

        } catch (error) {
            console.error('❌ Erro ao enviar notificação de pagamento:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação de promoção
    async sendPromoNotification(userIds, promoData) {
        try {
            const notification = {
                title: '🎉 Nova promoção disponível!',
                body: promoData.description || 'Aproveite nossa nova oferta especial!',
                data: {
                    type: 'promo',
                    promoId: promoData.id,
                    code: promoData.code,
                    discount: promoData.discount,
                    validUntil: promoData.validUntil,
                    timestamp: new Date().toISOString()
                },
                priority: 'normal',
                sound: 'default',
                badge: 1
            };

            return await this.sendToUsers(userIds, notification);

        } catch (error) {
            console.error('❌ Erro ao enviar notificação de promoção:', error);
            return { success: false, error: error.message };
        }
    }

    // Enviar notificação de manutenção
    async sendMaintenanceNotification(userIds, maintenanceData) {
        try {
            const notification = {
                title: '🔧 Manutenção programada',
                body: maintenanceData.message || 'Estamos realizando manutenções para melhorar nosso serviço.',
                data: {
                    type: 'maintenance',
                    maintenanceId: maintenanceData.id,
                    startTime: maintenanceData.startTime,
                    endTime: maintenanceData.endTime,
                    affectedServices: maintenanceData.affectedServices,
                    timestamp: new Date().toISOString()
                },
                priority: 'high',
                sound: 'default',
                badge: 1
            };

            return await this.sendToUsers(userIds, notification);

        } catch (error) {
            console.error('❌ Erro ao enviar notificação de manutenção:', error);
            return { success: false, error: error.message };
        }
    }

    // Obter token FCM do usuário (implementar conforme sua estrutura de dados)
    async getUserFCMToken(userId) {
        try {
            // TODO: Implementar lógica para obter token FCM do usuário
            // Pode ser via Redux store, API, ou banco de dados
            
            // Exemplo usando Redux store:
            const state = store.getState();
            const user = state.users?.users?.find(u => u.id === userId);
            
            if (user && user.fcmToken) {
                return user.fcmToken;
            }

            // Fallback: buscar em localStorage ou API
            // const token = await api.getUserFCMToken(userId);
            // return token;

            return null;

        } catch (error) {
            console.error('❌ Erro ao obter token FCM do usuário:', error);
            return null;
        }
    }

    // Verificar status do serviço
    async checkServiceStatus() {
        try {
            if (!this.isConfigured()) {
                return { status: 'not_configured', message: 'Serviço não configurado' };
            }

            // Testar conexão com FCM
            const testMessage = {
                to: 'test_token',
                notification: {
                    title: 'Test',
                    body: 'Test message'
                }
            };

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `key=${this.serverKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testMessage)
            });

            if (response.ok) {
                return { status: 'operational', message: 'Serviço funcionando normalmente' };
            } else {
                return { status: 'error', message: 'Erro na comunicação com FCM' };
            }

        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }

    // Limpar configuração
    clearConfiguration() {
        this.serverKey = null;
        console.log('🔑 Configuração FCM limpa');
    }
}

// Exportar instância singleton
export default new FCMSenderService();
