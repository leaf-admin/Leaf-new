/**
 * CONNECTION VALIDATOR
 * 
 * Utilitário para validar conexão antes de ações críticas
 * Exibe alertas apropriados quando offline
 */

import { Alert } from 'react-native';
import { fetchNetInfo } from './NetInfoSafe';
import Logger from './Logger';

class ConnectionValidator {
    /**
     * Verificar se há conexão disponível
     * @returns {Promise<boolean>} true se conectado
     */
    static async isConnected() {
        try {
            const netInfo = await fetchNetInfo();
            const connected = netInfo.isConnected && netInfo.isInternetReachable;
            
            Logger.log(`📱 [ConnectionValidator] Estado de conexão: ${connected ? 'ONLINE' : 'OFFLINE'}`);
            
            return connected;
        } catch (error) {
            Logger.error('❌ [ConnectionValidator] Erro ao verificar conexão:', error);
            // Em caso de erro, assumir que está online (não bloquear)
            return true;
        }
    }

    /**
     * Validar conexão antes de ação crítica
     * @param {string} actionName - Nome da ação (para mensagem)
     * @param {Object} options - Opções
     * @param {boolean} options.showAlert - Mostrar alerta se offline (padrão: true)
     * @param {string} options.customMessage - Mensagem customizada
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeAction(actionName, options = {}) {
        const {
            showAlert = true,
            customMessage = null
        } = options;

        const isConnected = await this.isConnected();

        if (!isConnected) {
            const message = customMessage || 
                `Você precisa de conexão com a internet para ${actionName}. Verifique sua conexão e tente novamente.`;

            if (showAlert) {
                Alert.alert(
                    '📱 Sem Conexão',
                    message,
                    [{ text: 'OK' }]
                );
            }

            Logger.warn(`⚠️ [ConnectionValidator] Ação bloqueada por falta de conexão: ${actionName}`);

            return {
                valid: false,
                error: 'NO_CONNECTION',
                message: message
            };
        }

        return {
            valid: true
        };
    }

    /**
     * Validar conexão antes de criar booking
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeCreateBooking() {
        return await this.validateBeforeAction('solicitar uma corrida', {
            customMessage: 'Você precisa de conexão com a internet para solicitar uma corrida. Verifique sua conexão e tente novamente.'
        });
    }

    /**
     * Validar conexão antes de aceitar corrida
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeAcceptRide() {
        return await this.validateBeforeAction('aceitar uma corrida', {
            customMessage: 'Você precisa de conexão com a internet para aceitar esta corrida. Verifique sua conexão e tente novamente.'
        });
    }

    /**
     * Validar conexão antes de iniciar viagem
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeStartTrip() {
        return await this.validateBeforeAction('iniciar a viagem', {
            customMessage: 'Você precisa de conexão com a internet para iniciar a viagem. Verifique sua conexão e tente novamente.'
        });
    }

    /**
     * Validar conexão antes de finalizar viagem
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeCompleteTrip() {
        return await this.validateBeforeAction('finalizar a viagem', {
            customMessage: 'Você precisa de conexão com a internet para finalizar a viagem. Verifique sua conexão e tente novamente.'
        });
    }

    /**
     * Validar conexão antes de cancelar corrida
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeCancelRide() {
        return await this.validateBeforeAction('cancelar a corrida', {
            customMessage: 'Você precisa de conexão com a internet para cancelar a corrida. Verifique sua conexão e tente novamente.'
        });
    }

    /**
     * Validar conexão antes de enviar mensagem
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    static async validateBeforeSendMessage() {
        return await this.validateBeforeAction('enviar uma mensagem', {
            customMessage: 'Você precisa de conexão com a internet para enviar mensagens. Verifique sua conexão e tente novamente.'
        });
    }

    /**
     * Validar conexão durante corrida ativa (modo degradado)
     * @param {string} currentStatus - Status atual da corrida
     * @returns {Promise<{valid: boolean, error?: string, degraded?: boolean}>}
     */
    static async validateDuringActiveRide(currentStatus) {
        const isConnected = await this.isConnected();

        // Durante corrida ativa, permitir continuar mesmo offline (modo degradado)
        // Mas avisar o usuário
        if (!isConnected && (currentStatus === 'started' || currentStatus === 'inProgress' || currentStatus === 'accepted')) {
            Logger.warn(`⚠️ [ConnectionValidator] Corrida ativa sem conexão - modo degradado ativado`);
            
            return {
                valid: true, // Permitir continuar
                degraded: true, // Mas em modo degradado
                error: 'NO_CONNECTION',
                message: 'Você está sem conexão. Algumas funcionalidades podem estar limitadas.'
            };
        }

        return {
            valid: isConnected,
            degraded: false
        };
    }
}

export default ConnectionValidator;

