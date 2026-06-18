import Logger from '../utils/Logger';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { createAxiosInstance } from '../utils/axiosInterceptor';


class WooviService {
    constructor() {
        // ✅ API do backend Leaf com headers compatíveis com CORS
        // ✅ CORREÇÃO: Usar getSelfHostedApiUrl diretamente para garantir URL correta
        const apiBaseUrl = getSelfHostedApiUrl('');
        Logger.log('🔧 [WooviService] Base URL configurada:', apiBaseUrl);
        Logger.log('🔧 [WooviService] URL completa para pagamento:', `${apiBaseUrl}/api/payment/advance`);
        
        this.backendApi = createAxiosInstance({
            baseURL: apiBaseUrl, // Usa a configuração do ApiConfig
            timeout: 30000
        });
    }

    // NOVO SISTEMA: Processar pagamento antecipado
    async processAdvancePayment(paymentData) {
        try {
            const timestamp = new Date().toISOString();
            const comment = `Corrida Leaf - ${timestamp}`;
            Logger.log('📝 [Woovi] Comentário gerado:', comment);
            
            // ✅ Log da URL completa que será chamada
            const fullUrl = `${this.backendApi.defaults.baseURL}/api/payment/advance`;
            Logger.log('🌐 [Woovi] Fazendo requisição para:', fullUrl);
            Logger.log('📦 [Woovi] Payload:', JSON.stringify(paymentData, null, 2));

            const response = await this.backendApi.post('/api/payment/advance', {
                passengerId: paymentData.passengerId,
                passengerPhone: paymentData.passengerPhone,
                phone: paymentData.phone,
                phoneNumber: paymentData.phoneNumber,
                amount: paymentData.amount,
                grossAmountInCents: paymentData.grossAmountInCents,
                grossAmount: paymentData.grossAmount,
                discountBenefit: paymentData.discountBenefit || null,
                rideId: paymentData.rideId,
                rideDetails: paymentData.rideDetails,
                passengerName: paymentData.passengerName,
                passengerEmail: paymentData.passengerEmail,
                driverId: paymentData.driverId,
                driverPixKey: paymentData.driverPixKey,
                driverSubaccountPixKey: paymentData.driverSubaccountPixKey,
                wooviSubaccountPixKey: paymentData.wooviSubaccountPixKey,
                subaccountPixKey: paymentData.subaccountPixKey,
                tollFee: paymentData.tollFee,
                tollFeeCents: paymentData.tollFeeCents,
                comment
            });
            
            Logger.log('✅ [Woovi] Resposta recebida:', response.status, response.statusText);
            return response.data;
        } catch (error) {
            Logger.error('❌ [Woovi] Erro ao processar pagamento antecipado:', error);
            Logger.error('❌ [Woovi] Detalhes do erro:', {
                message: error.message,
                code: error.code,
                response: error.response?.data,
                status: error.response?.status,
                url: error.config?.url,
                baseURL: error.config?.baseURL,
                fullUrl: error.config ? `${error.config.baseURL}${error.config.url}` : 'N/A',
                method: error.config?.method
            });
            
            // ✅ Melhorar mensagem de erro
            if (error.code === 'ECONNABORTED') {
                error.message = 'Tempo de espera esgotado. Verifique sua conexão.';
            } else if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
                const serverUrl = this.backendApi.defaults.baseURL;
                error.message = `Erro de conexão. Verifique se o servidor está rodando em ${serverUrl}`;
                Logger.error(`❌ [Woovi] Não foi possível conectar ao servidor: ${serverUrl}`);
                Logger.error('❌ [Woovi] Verifique:');
                Logger.error('   1. Servidor está rodando?');
                Logger.error('   2. IP está correto?');
                Logger.error('   3. Dispositivo está na mesma rede?');
                Logger.error('   4. Firewall não está bloqueando?');
            } else if (error.response) {
                error.message = error.response.data?.error || error.response.data?.message || error.message;
            }
            
            throw error;
        }
    }

    // NOVO SISTEMA: Confirmar pagamento
    async confirmPayment(chargeId, rideId) {
        try {
            const response = await this.backendApi.post('/api/payment/confirm', {
                chargeId,
                rideId
            });
            return response.data;
        } catch (error) {
            Logger.error('Erro ao confirmar pagamento:', error);
            throw error;
        }
    }

    // NOVO SISTEMA: Verificar status do pagamento via chargeId
    async getPaymentStatus(chargeId) {
        try {
            const response = await this.backendApi.get(`/api/payment/status/${chargeId}`);
            return response.data;
        } catch (error) {
            Logger.error('Erro ao verificar status do pagamento:', error);
            throw error;
        }
    }

    async simulateTestWebhook({
        chargeId,
        paymentIntentId,
        rideId,
        passengerId,
        amountInCents,
        paymentType = 'advance_payment'
    }) {
        try {
            if (!paymentIntentId) {
                throw new Error('paymentIntentId é obrigatório para simular webhook sandbox');
            }

            const paidAt = new Date().toISOString();
            const payload = {
                event: 'OPENPIX:CHARGE_COMPLETED',
                charge: {
                    identifier: chargeId,
                    transactionID: chargeId,
                    correlationID: rideId || chargeId,
                    status: 'COMPLETED',
                    value: Number(amountInCents || 0),
                    paidAt,
                    additionalInfo: [
                        { key: 'passenger_id', value: passengerId || '' },
                        { key: 'ride_id', value: rideId || '' },
                        { key: 'payment_type', value: paymentType },
                        { key: 'payment_intent_id', value: paymentIntentId },
                        { key: 'service', value: 'ride_sharing' }
                    ]
                },
                pix: {
                    status: 'COMPLETED'
                }
            };

            const response = await this.backendApi.post('/api/woovi/test-webhook', payload);
            return response.data;
        } catch (error) {
            Logger.error('Erro ao simular webhook de pagamento:', error);
            throw error;
        }
    }

    // NOVO SISTEMA: Calcular valor líquido
    async calculateNetAmount(amount) {
        try {
            const response = await this.backendApi.get(`/api/payment/calculate-net?amount=${amount}`);
            return response.data;
        } catch (error) {
            Logger.error('Erro ao calcular valor líquido:', error);
            throw error;
        }
    }

    // COMPATIBILIDADE: Gerar QR Code PIX (método antigo)
    async generatePixQRCode(amount, description) {
        try {
            // Usar novo sistema de pagamento antecipado
            const paymentData = {
                passengerId: 'temp_user', // Será substituído pelo ID real
                amount: amount * 100,
                rideId: `temp_ride_${Date.now()}`,
                rideDetails: {
                    origin: 'Origem',
                    destination: 'Destino'
                },
                passengerName: 'Usuário',
                passengerEmail: 'user@leaf.com'
            };

            const result = await this.processAdvancePayment(paymentData);
            
            return {
                qrCode: result.qrCode,
                paymentId: result.chargeId,
                paymentLink: result.paymentLink
            };
        } catch (error) {
            Logger.error('Erro ao gerar QR Code PIX:', error);
            throw error;
        }
    }

    // COMPATIBILIDADE: Verificar status do pagamento (método antigo)
    async checkPaymentStatus(paymentId) {
        try {
            // Usar novo sistema de status
            const result = await this.getPaymentStatus(paymentId);
            return {
                status: result.status,
                amount: result.amount
            };
        } catch (error) {
            Logger.error('Erro ao verificar status do pagamento:', error);
            throw error;
        }
    }

    // COMPATIBILIDADE: Listar pagamentos
    async listPayments(page = 1, limit = 10) {
        try {
            const response = await this.backendApi.get('/api/woovi/list-charges', { params: { page, limit } });
            return response.data;
        } catch (error) {
            Logger.error('Erro ao listar pagamentos:', error);
            throw error;
        }
    }

    // COMPATIBILIDADE: Cancelar pagamento
    async cancelPayment(paymentId) {
        try {
            if (String(paymentId || '').startsWith('mock_review_')) {
                return { success: true, mock: true, message: 'Cobrança mock cancelada localmente' };
            }
            const response = await this.backendApi.post(`/api/woovi/cancel-charge/${paymentId}`);
            return response.data || { success: true };
        } catch (error) {
            const status = Number(error?.response?.status || 0);
            const payload = error?.response?.data || {};
            const providerStatus = Number(payload?.status || 0);
            const providerError = String(payload?.error || '').toLowerCase();

            // A Woovi pode retornar 404 para cobranças já liquidadas/expiradas.
            // Tratamos como cancelamento idempotente para evitar erro falso no app.
            if ((status === 400 || status === 404) && (providerStatus === 404 || providerError.includes('not found'))) {
                Logger.warn('⚠️ [Woovi] cancelPayment retornou Not Found; tratando como já finalizada/cancelada.', {
                    paymentId,
                    status,
                    providerStatus,
                    payload
                });
                return {
                    success: true,
                    alreadyFinalized: true,
                    message: 'Cobrança já finalizada ou indisponível para cancelamento'
                };
            }

            Logger.error('Erro ao cancelar pagamento:', error);
            return { success: false, error: payload || error.message };
        }
    }
}

export default new WooviService();
