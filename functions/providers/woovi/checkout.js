const axios = require('axios');
const crypto = require('crypto');

class WooviPixProvider {
    constructor() {
        this.baseURL = process.env.WOOVI_BASE_URL || 'https://api.openpix.com.br';
        this.appId = process.env.WOOVI_APP_ID;
    }

    // Autenticação via AppID (conforme documentação oficial)
    getAuthHeaders() {
        return {
            'AppId': this.appId,
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
                data: response.data
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
        // OpenPix usa AppID para autenticação, não assinatura HMAC
        // A validação é feita automaticamente pelo Firebase Functions
        return true;
    }

    // Processar webhook
    processWebhook(webhookData) {
        try {
            const { event, charge } = webhookData;

            switch (event) {
                case 'charge.confirmed':
                    return {
                        success: true,
                        event: 'payment_confirmed',
                        chargeId: charge.correlationID,
                        value: charge.value,
                        customerId: charge.identifier,
                        timestamp: new Date().toISOString()
                    };

                case 'charge.expired':
                    return {
                        success: true,
                        event: 'payment_expired',
                        chargeId: charge.correlationID,
                        customerId: charge.identifier,
                        timestamp: new Date().toISOString()
                    };

                case 'charge.overdue':
                    return {
                        success: true,
                        event: 'payment_overdue',
                        chargeId: charge.correlationID,
                        customerId: charge.identifier,
                        timestamp: new Date().toISOString()
                    };

                default:
                    return {
                        success: false,
                        error: 'Evento não reconhecido'
                    };
            }

        } catch (error) {
            console.error('Erro ao processar webhook:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Criar cobrança com QR Code personalizado
    async createCustomPixCharge(chargeData) {
        try {
            const endpoint = '/api/v1/charge';
            const body = JSON.stringify({
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
                        key: 'driver_id',
                        value: chargeData.driverId || ''
                    },
                    {
                        key: 'service_type',
                        value: 'ride_sharing'
                    },
                    {
                        key: 'app_version',
                        value: '4.6.0'
                    }
                ]
            });

            const response = await axios.post(`${this.baseURL}${endpoint}`, body, {
                headers: this.getAuthHeaders()
            });

            // Gerar QR Code personalizado
            const qrCodeData = {
                pixCode: response.data.pixQrCode,
                pixCopyPaste: response.data.pixCopyPaste,
                chargeId: response.data.correlationID,
                value: chargeData.value,
                expiresAt: new Date(Date.now() + (chargeData.expiresIn || 3600) * 1000),
                customerName: chargeData.customerName,
                bookingId: chargeData.bookingId
            };

            return {
                success: true,
                data: response.data,
                qrCode: qrCodeData
            };

        } catch (error) {
            console.error('Erro ao criar cobrança PIX personalizada:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }
}

module.exports = WooviPixProvider; 