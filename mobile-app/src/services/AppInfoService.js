import Logger from '../utils/Logger';
import { createAxiosInstance, setupAxiosInterceptor } from '../utils/axiosInterceptor';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import Constants from 'expo-constants';


class AppInfoService {
    constructor() {
        this.baseUrl = getSelfHostedApiUrl('/api/app');
        this.axiosInstance = createAxiosInstance({ baseURL: this.baseUrl });
        setupAxiosInterceptor(this.axiosInstance);
    }

    /**
     * Buscar informações do app
     * @returns {Promise<{success: boolean, appInfo?: object, error?: string}>}
     */
    async getAppInfo() {
        try {
            const response = await this.axiosInstance.get('/info');
            return {
                success: true,
                appInfo: response.data
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar informações do app:', error);
            // Retornar informações locais em caso de erro
            return {
                success: true,
                appInfo: this.getLocalAppInfo()
            };
        }
    }

    /**
     * Buscar informações locais do app
     * @returns {object}
     */
    getLocalAppInfo() {
        const appVersion = Constants.expoConfig?.version || '1.0.0';
        const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1';

        return {
            version: appVersion,
            buildNumber: buildNumber,
            lastUpdate: new Date().toISOString().split('T')[0],
            features: [
                { icon: 'card-outline', title: 'Pagamento PIX', description: 'Pagamento instantâneo e seguro via PIX' },
                { icon: 'shield-checkmark-outline', title: 'Segurança Total', description: 'Motoristas verificados e viagens monitoradas' },
                { icon: 'location-outline', title: 'Rastreamento em Tempo Real', description: 'Acompanhe sua viagem em tempo real' },
                { icon: 'chatbubbles-outline', title: 'Suporte 24/7', description: 'Suporte ao cliente disponível 24 horas' },
            ],
            team: [],
            changelog: [
                {
                    version: '1.0.0',
                    date: new Date().toISOString().split('T')[0],
                    title: 'Lançamento Inicial',
                    description: '• Integração completa com Woovi PIX\n• Sistema de busca de motoristas\n• Rastreamento em tempo real\n• Chat integrado\n• Dashboard para motoristas\n• Conta Leaf BaaS'
                }
            ]
        };
    }

    /**
     * Buscar estatísticas do app
     * @returns {Promise<{success: boolean, stats?: object, error?: string}>}
     */
    async getAppStats() {
        try {
            const response = await this.axiosInstance.get('/stats');
            return {
                success: true,
                stats: response.data
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar estatísticas:', error);
            return {
                success: true,
                stats: {
                    activeUsers: '50K+',
                    totalTrips: '100K+',
                    averageRating: '4.8'
                }
            };
        }
    }
}

export default new AppInfoService();

