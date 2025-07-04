import { WooviConfig } from '../../config/WooviConfig';
import axios from 'axios';

class WooviService {
    constructor() {
        this.api = axios.create({
            baseURL: WooviConfig.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${WooviConfig.apiKey}`
            }
        });
    }

    // Gerar QR Code PIX
    async generatePixQRCode(amount, description) {
        try {
            const response = await this.api.post('/pix/qrcode', {
                amount: amount * 100, // Converter para centavos
                description,
                pixKey: WooviConfig.pixKey,
                beneficiary: WooviConfig.beneficiary
            });
            return response.data;
        } catch (error) {
            console.error('Erro ao gerar QR Code PIX:', error);
            throw error;
        }
    }

    // Verificar status do pagamento
    async checkPaymentStatus(paymentId) {
        try {
            const response = await this.api.get(`/pix/payment/${paymentId}`);
            return response.data;
        } catch (error) {
            console.error('Erro ao verificar status do pagamento:', error);
            throw error;
        }
    }

    // Listar pagamentos
    async listPayments(page = 1, limit = 10) {
        try {
            const response = await this.api.get('/pix/payments', {
                params: { page, limit }
            });
            return response.data;
        } catch (error) {
            console.error('Erro ao listar pagamentos:', error);
            throw error;
        }
    }

    // Cancelar pagamento
    async cancelPayment(paymentId) {
        try {
            const response = await this.api.post(`/pix/payment/${paymentId}/cancel`);
            return response.data;
        } catch (error) {
            console.error('Erro ao cancelar pagamento:', error);
            throw error;
        }
    }
}

export default new WooviService(); 