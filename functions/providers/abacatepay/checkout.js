const axios = require('axios');
const crypto = require('crypto');

class AbacatePayPixProvider {
    constructor() {
        this.baseURL = process.env.ABACATEPAY_BASE_URL || 'https://api.abacatepay.com.br';
        this.apiKey = process.env.ABACATEPAY_API_KEY;
        this.secretKey = process.env.ABACATEPAY_SECRET_KEY;
    }

    // Autenticação via API Key
    getAuthHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-Secret-Key': this.secretKey
        };
    }

    // Criar cobrança PIX
    async createPixCharge(chargeData) {
        try {
            const endpoint = '/v1/pix/charge';
            const body = {
                external_id: chargeData.correlationID || `leaf_abacate_${Date.now()}`,
                amount: chargeData.value,
                description: chargeData.comment || 'Pagamento LEAF App - AbacatePay',
                customer: {
                    name: chargeData.customerName || 'Cliente LEAF',
                    email: chargeData.customerEmail || 'cliente@leaf.app',
                    tax_id: chargeData.customerTaxId || ''
                },
                expires_in: chargeData.expiresIn || 3600, // 1 hora
                metadata: {
                    booking_id: chargeData.bookingId || '',
                    service_type: 'ride_sharing',
                    provider: 'abacatepay'
                }
            };

            const response = await axios.post(`${this.baseURL}${endpoint}`, body, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                pixCode: response.data.qr_code,
                pixCopyPaste: response.data.qr_code_text,
                chargeId: response.data.external_id,
                provider: 'abacatepay'
            };

        } catch (error) {
            console.error('Erro ao criar cobrança PIX AbacatePay:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message,
                provider: 'abacatepay'
            };
        }
    }

    // Consultar status da cobrança
    async getChargeStatus(chargeId) {
        try {
            const endpoint = `/v1/pix/charge/${chargeId}`;

            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                headers: this.getAuthHeaders()
            });

            return {
                success: true,
                data: response.data,
                status: response.data.status,
                provider: 'abacatepay'
            };

        } catch (error) {
            console.error('Erro ao consultar cobrança AbacatePay:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message,
                provider: 'abacatepay'
            };
        }
    }

    // Validar webhook
    validateWebhook(signature, timestamp, body) {
        try {
            const expectedSignature = crypto
                .createHmac('sha256', this.secretKey)
                .update(timestamp + JSON.stringify(body))
                .digest('hex');

            return signature === expectedSignature;
        } catch (error) {
            console.error('Erro ao validar webhook AbacatePay:', error);
            return false;
        }
    }

    // Processar webhook
    processWebhook(webhookData) {
        try {
            const { event, data } = webhookData;
            
            if (event === 'pix.paid') {
                return {
                    success: true,
                    status: 'paid',
                    chargeId: data.external_id,
                    amount: data.amount,
                    paidAt: data.paid_at,
                    provider: 'abacatepay'
                };
            }

            return {
                success: false,
                error: 'Evento não reconhecido',
                provider: 'abacatepay'
            };

        } catch (error) {
            console.error('Erro ao processar webhook AbacatePay:', error);
            return {
                success: false,
                error: error.message,
                provider: 'abacatepay'
            };
        }
    }
}

module.exports = AbacatePayPixProvider; 