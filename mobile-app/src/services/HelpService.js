import Logger from '../utils/Logger';
import { createAxiosInstance, setupAxiosInterceptor } from '../utils/axiosInterceptor';
import { getSelfHostedApiUrl } from '../config/ApiConfig';


class HelpService {
    constructor() {
        this.baseUrl = getSelfHostedApiUrl('/api/help');
        this.axiosInstance = createAxiosInstance({ baseURL: this.baseUrl });
        setupAxiosInterceptor(this.axiosInstance);
    }

    /**
     * Buscar conteúdo de ajuda por categoria
     * @param {string} category - Categoria da ajuda
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    async getHelpContent(category = null) {
        try {
            const url = category ? `/content?category=${category}` : '/content';
            const response = await this.axiosInstance.get(url);
            
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar conteúdo de ajuda:', error);
            // Retornar dados mockados em caso de erro
            return {
                success: true,
                data: this.getMockHelpData(category)
            };
        }
    }

    /**
     * Buscar FAQ por categoria
     * @param {string} category - Categoria do FAQ
     * @returns {Promise<{success: boolean, faqs?: Array, error?: string}>}
     */
    async getFAQ(category = null) {
        try {
            const url = category ? `/faq?category=${category}` : '/faq';
            const response = await this.axiosInstance.get(url);
            
            return {
                success: true,
                faqs: response.data.faqs || []
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar FAQ:', error);
            return {
                success: true,
                faqs: this.getMockFAQ(category)
            };
        }
    }

    /**
     * Buscar tutoriais
     * @param {string} category - Categoria dos tutoriais
     * @returns {Promise<{success: boolean, tutorials?: Array, error?: string}>}
     */
    async getTutorials(category = null) {
        try {
            const url = category ? `/tutorials?category=${category}` : '/tutorials';
            const response = await this.axiosInstance.get(url);
            
            return {
                success: true,
                tutorials: response.data.tutorials || []
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar tutoriais:', error);
            return { success: true, tutorials: [] };
        }
    }

    /**
     * Dados mockados para fallback
     */
    getMockHelpData(category) {
        const mockData = {
            categories: [
                { id: 'getting-started', label: 'Primeiros Passos', icon: 'play-circle-outline' },
                { id: 'trips', label: 'Viagens', icon: 'car-outline' },
                { id: 'payments', label: 'Pagamentos', icon: 'card-outline' },
                { id: 'account', label: 'Conta', icon: 'person-outline' },
                { id: 'safety', label: 'Segurança', icon: 'shield-checkmark-outline' },
                { id: 'troubleshooting', label: 'Problemas', icon: 'construct-outline' }
            ],
            tutorials: [],
            guides: [],
            emergencyContacts: []
        };

        return category ? { ...mockData, category } : mockData;
    }

    getMockFAQ(category) {
        const allFAQs = {
            'getting-started': [
                { question: 'Como criar uma conta?', answer: 'Para criar uma conta, baixe o app Leaf, abra e toque em "Criar conta". Informe seu número de telefone, nome completo e e-mail. Você receberá um código de verificação por SMS.' },
                { question: 'Como solicitar uma viagem?', answer: 'Abra o app, informe seu destino no mapa ou digite o endereço. Escolha o tipo de veículo e confirme. Um motorista próximo será notificado.' },
                { question: 'Como funciona o pagamento?', answer: 'O pagamento é feito via PIX antes da viagem começar. Você receberá um QR Code para pagar. Após a confirmação do pagamento, o motorista iniciará a viagem.' },
            ],
            'trips': [
                { question: 'Como cancelar uma viagem?', answer: 'Você pode cancelar uma viagem a qualquer momento antes do motorista iniciar a corrida. Toque na viagem ativa e selecione "Cancelar".' },
                { question: 'Como avaliar o motorista?', answer: 'Após a conclusão da viagem, você receberá uma solicitação para avaliar. Toque nas estrelas e deixe um comentário opcional.' },
            ],
            'payments': [
                { question: 'Quais formas de pagamento são aceitas?', answer: 'Atualmente aceitamos pagamento via PIX. Outras formas de pagamento podem ser adicionadas no futuro.' },
                { question: 'Como solicitar reembolso?', answer: 'Entre em contato com o suporte através do app ou e-mail. Forneça o número da viagem e o motivo do reembolso.' },
            ],
        };

        return category ? (allFAQs[category] || []) : Object.values(allFAQs).flat();
    }
}

export default new HelpService();

