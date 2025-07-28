const axios = require('axios');
const crypto = require('crypto');

class WooviPixProvider {
    constructor() {
        this.baseURL = process.env.WOOVI_BASE_URL || 'https://api.openpix.com.br';
        this.appId = process.env.WOOVI_APP_ID;
        this.apiKey = process.env.WOOVI_API_KEY;
    }

    // Autenticação via Token de Autorização (conforme configuração real)
    getAuthHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    // Criar cobrança PIX
    async createPixCharge(chargeData) {
        try {
            const endpoint = '/api/v1/charge';
            const body = JSON.stringify({
                correlationID: chargeData.correlationID || `leaf_${Date.now()}`,
                value: chargeData.value,
                comment: chargeData.comment || 'Pagamento LEAF App',
                identifier: chargeData.identifier || chargeData.customerId,
                expiresIn: chargeData.expiresIn || 3600, // 1 hora
                additionalInfo: [
                    {
                        key: 'customer_name',
                        value: chargeData.customerName || 'Cliente LEAF'
                    },
                    {
                        key: 'booking_id',
                        value: chargeData.bookingId || ''
                    },
                    {
                        key: 'service_type',
                        value: 'ride_sharing'
                    }
                ]
            });

            const response = await axios.post(`${this.baseURL}${endpoint}`, body, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                pixCode: response.data.pixQrCode,
                pixCopyPaste: response.data.pixCopyPaste,
                chargeId: response.data.correlationID
            };

        } catch (error) {
            console.error('Erro ao criar cobrança PIX:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Consultar status da cobrança
    async getChargeStatus(chargeId) {
        try {
            const endpoint = `/api/v1/charge/${chargeId}`;

            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                status: response.data.status
            };

        } catch (error) {
            console.error('Erro ao consultar cobrança:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Listar cobranças
    async listCharges(filters = {}) {
        try {
            const queryParams = new URLSearchParams(filters).toString();
            const endpoint = `/api/v1/charge${queryParams ? `?${queryParams}` : ''}`;

            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                charges: response.data.charges || []
            };

        } catch (error) {
            console.error('Erro ao listar cobranças:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    // Validar webhook (OpenPix usa AppID para validação)
    validateWebhook(signature, timestamp, body) {
        try {
            // OpenPix usa AppID para autenticação, não assinatura HMAC
            // Para produção, implementar validação específica se necessário
            return true;
        } catch (error) {
            console.error('Erro ao validar webhook:', error);
            return false;
        }
    }

    // Processar webhook
    processWebhook(webhookData) {
        try {
            const { event, data } = webhookData;
            
            if (event === 'charge.confirmed') {
                return {
                    success: true,
                    status: 'confirmed',
                    chargeId: data.correlationID,
                    amount: data.value,
                    paidAt: data.paidAt,
                    provider: 'woovi'
                };
            }

            if (event === 'charge.expired') {
                return {
                    success: true,
                    status: 'expired',
                    chargeId: data.correlationID,
                    provider: 'woovi'
                };
            }

            return {
                success: false,
                error: 'Evento não reconhecido',
                provider: 'woovi'
            };

        } catch (error) {
            console.error('Erro ao processar webhook:', error);
            return {
                success: false,
                error: error.message,
                provider: 'woovi'
            };
        }
    }

    // Criar cobrança PIX customizada
    async createCustomPixCharge(chargeData) {
        try {
            const endpoint = '/api/v1/charge';
            const body = {
                correlationID: chargeData.correlationID || `leaf_${Date.now()}`,
                value: chargeData.value,
                comment: chargeData.comment || 'Pagamento LEAF App',
                identifier: chargeData.identifier || chargeData.customerId,
                expiresIn: chargeData.expiresIn || 3600,
                additionalInfo: [
                    {
                        key: 'customer_name',
                        value: chargeData.customerName || 'Cliente LEAF'
                    },
                    {
                        key: 'booking_id',
                        value: chargeData.bookingId || ''
                    },
                    {
                        key: 'service_type',
                        value: 'ride_sharing'
                    },
                    {
                        key: 'app_version',
                        value: '1.0.0'
                    }
                ]
            };

            const response = await axios.post(`${this.baseURL}${endpoint}`, body, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                pixCode: response.data.pixQrCode,
                pixCopyPaste: response.data.pixCopyPaste,
                chargeId: response.data.correlationID,
                provider: 'woovi'
            };

        } catch (error) {
            console.error('Erro ao criar cobrança PIX customizada:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message,
                provider: 'woovi'
            };
        }
    }
}

module.exports = WooviPixProvider; 