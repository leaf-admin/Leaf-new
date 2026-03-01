import Logger from '../utils/Logger';
import PersistentRideNotificationService from './PersistentRideNotificationService';
import BackgroundLocationService from './BackgroundLocationService';

/**
 * 🚗 GERENCIADOR DE CORRIDAS COM LOCALIZAÇÃO E NOTIFICAÇÕES
 *
 * Este serviço gerencia o ciclo completo de uma corrida:
 * - Notificações persistentes (só durante corridas)
 * - Tracking de localização (só durante corridas)
 * - Coordenação entre ambos os serviços
 *
 * Google Play Store Compliance:
 * ✅ Foreground Service só durante atividades ativas
 * ✅ Notificação só quando necessário
 * ✅ Para automaticamente quando corrida termina
 */

class RideLocationManager {
    constructor() {
        this.currentRideId = null;
        this.currentUserType = null; // 'driver' ou 'customer'
        this.rideStatus = null; // 'searching', 'accepted', 'arrived', 'started', 'completed'
        this.isRideActive = false;
    }

    /**
     * 🔔 INICIAR CORRIDA (ativa notificação + localização)
     * @param {Object} rideData - Dados da corrida
     */
    async startRide(rideData) {
        try {
            const { bookingId, userType, status, ...otherData } = rideData;

            if (!bookingId || !userType) {
                throw new Error('Dados da corrida incompletos');
            }

            this.currentRideId = bookingId;
            this.currentUserType = userType;
            this.rideStatus = status;
            this.isRideActive = true;

            Logger.log(`🚀 [RideLocationManager] Iniciando corrida: ${bookingId} (${userType})`);

            // ✅ 1. MOSTRAR NOTIFICAÇÃO PERSISTENTE
            await PersistentRideNotificationService.showRideNotification({
                bookingId,
                status,
                userType,
                ...otherData
            });

            // ✅ 2. INICIAR TRACKING DE LOCALIZAÇÃO (só para motorista)
            if (userType === 'driver') {
                await this.startLocationTracking();
            }

            Logger.log(`✅ [RideLocationManager] Corrida iniciada com sucesso`);

        } catch (error) {
            Logger.error('❌ [RideLocationManager] Erro ao iniciar corrida:', error);
            // Se falhar, tentar limpar estado
            await this.endRide();
            throw error;
        }
    }

    /**
     * 🔄 ATUALIZAR STATUS DA CORRIDA
     * @param {Object} rideData - Dados atualizados da corrida
     */
    async updateRideStatus(rideData) {
        try {
            if (!this.isRideActive) {
                Logger.warn('⚠️ [RideLocationManager] Tentando atualizar corrida inativa');
                return;
            }

            const { status, ...otherData } = rideData;
            this.rideStatus = status;

            Logger.log(`🔄 [RideLocationManager] Atualizando status: ${status}`);

            // ✅ ATUALIZAR NOTIFICAÇÃO
            await PersistentRideNotificationService.updateRideNotification({
                bookingId: this.currentRideId,
                status,
                userType: this.currentUserType,
                ...otherData
            });

            // ✅ GERENCIAR TRACKING BASEADO NO STATUS
            if (this.currentUserType === 'driver') {
                if (status === 'started' || status === 'accepted') {
                    // Garantir que tracking está ativo durante corrida
                    await this.startLocationTracking();
                } else if (status === 'completed' || status === 'cancelled') {
                    // Parar tracking quando corrida terminar
                    await this.stopLocationTracking();
                }
            }

        } catch (error) {
            Logger.error('❌ [RideLocationManager] Erro ao atualizar status:', error);
        }
    }

    /**
     * 🛑 FINALIZAR CORRIDA (remove notificação + para localização)
     */
    async endRide() {
        try {
            if (!this.isRideActive) {
                return;
            }

            Logger.log(`🛑 [RideLocationManager] Finalizando corrida: ${this.currentRideId}`);

            // ✅ 1. PARAR TRACKING DE LOCALIZAÇÃO
            await this.stopLocationTracking();

            // ✅ 2. REMOVER NOTIFICAÇÃO PERSISTENTE
            await PersistentRideNotificationService.dismissRideNotification();

            // ✅ 3. LIMPAR ESTADO
            this.currentRideId = null;
            this.currentUserType = null;
            this.rideStatus = null;
            this.isRideActive = false;

            Logger.log(`✅ [RideLocationManager] Corrida finalizada`);

        } catch (error) {
            Logger.error('❌ [RideLocationManager] Erro ao finalizar corrida:', error);
        }
    }

    /**
     * 📍 INICIAR TRACKING DE LOCALIZAÇÃO
     * (só para motoristas durante corridas ativas)
     */
    async startLocationTracking() {
        try {
            if (this.currentUserType !== 'driver') {
                return; // Só motoristas fazem tracking
            }

            Logger.log('📍 [RideLocationManager] Iniciando tracking de localização...');

            const permissions = await BackgroundLocationService.requestPermissions();

            if (permissions.background) {
                await BackgroundLocationService.startBackgroundTracking();
                Logger.log('✅ [RideLocationManager] Tracking de localização iniciado');
            } else {
                Logger.warn('⚠️ [RideLocationManager] Permissões de localização insuficientes');
            }

        } catch (error) {
            Logger.error('❌ [RideLocationManager] Erro ao iniciar tracking:', error);
        }
    }

    /**
     * 🛑 PARAR TRACKING DE LOCALIZAÇÃO
     */
    async stopLocationTracking() {
        try {
            Logger.log('🛑 [RideLocationManager] Parando tracking de localização...');
            await BackgroundLocationService.stopBackgroundTracking();
            Logger.log('✅ [RideLocationManager] Tracking de localização parado');
        } catch (error) {
            Logger.error('❌ [RideLocationManager] Erro ao parar tracking:', error);
        }
    }

    /**
     * 🔍 VERIFICAR SE HÁ CORRIDA ATIVA
     */
    isRideActive() {
        return this.isRideActive && this.currentRideId !== null;
    }

    /**
     * 📊 OBTER STATUS ATUAL
     */
    getCurrentStatus() {
        return {
            isActive: this.isRideActive,
            rideId: this.currentRideId,
            userType: this.currentUserType,
            status: this.rideStatus
        };
    }

    /**
     * 🧹 LIMPAR TUDO (usar em emergências)
     */
    async forceCleanup() {
        try {
            Logger.log('🧹 [RideLocationManager] Forçando limpeza completa...');

            await this.stopLocationTracking();
            await PersistentRideNotificationService.dismissRideNotification();

            this.currentRideId = null;
            this.currentUserType = null;
            this.rideStatus = null;
            this.isRideActive = false;

            Logger.log('✅ [RideLocationManager] Limpeza completa realizada');
        } catch (error) {
            Logger.error('❌ [RideLocationManager] Erro na limpeza forçada:', error);
        }
    }
}

// Exportar instância singleton
const rideLocationManager = new RideLocationManager();
export default rideLocationManager;



















