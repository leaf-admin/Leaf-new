import Logger from '../utils/Logger';
import { createAxiosInstance, setupAxiosInterceptor } from '../utils/axiosInterceptor';
/**
 * 🧾 RECEIPT SERVICE - CLIENTE MOBILE
 * 
 * Serviço para buscar e gerenciar recibos de corridas
 */

import BACKEND_BASE_URL from '../config/backendBaseUrl';

const ENABLE_RTDATABASE_RECEIPT_FALLBACK =
    String(process.env.EXPO_PUBLIC_RECEIPT_RTDATABASE_FALLBACK || '')
        .trim()
        .toLowerCase() === 'true';

let databaseModule = null;

function getDatabaseModule() {
    if (!ENABLE_RTDATABASE_RECEIPT_FALLBACK) {
        return null;
    }

    if (!databaseModule) {
        // Legacy fallback only. The supported production path is the Leaf API.
        // eslint-disable-next-line global-require
        databaseModule = require('@react-native-firebase/database').default;
    }

    return databaseModule;
}

class ReceiptService {
    constructor() {
        this.axiosInstance = createAxiosInstance({ baseURL: `${BACKEND_BASE_URL}/api` });
        setupAxiosInterceptor(this.axiosInstance);
    }

    /**
     * Busca recibo do Firestore
     * @param {string} rideId - ID da corrida
     * @returns {Promise<Object>} - Recibo encontrado
     */
    async getReceiptByRideId(rideId) {
        try {
            try {
                const response = await this.axiosInstance.get(`/receipts/${encodeURIComponent(rideId)}`);
                const data = response?.data;
                if (data?.success && data.receipt) {
                    return data.receipt;
                }
            } catch (apiError) {
                Logger.warn('Erro ao buscar recibo via API:', apiError);
            }

            const database = getDatabaseModule();
            if (database) {
                try {
                    const receiptRef = database().ref(`receipts/${rideId}`);
                    const snapshot = await receiptRef.once('value');

                    if (snapshot.exists()) {
                        return snapshot.val();
                    }
                } catch (databaseError) {
                    Logger.warn('Fallback RTDB de recibo indisponível:', databaseError);
                }
            }

            throw new Error('Recibo não encontrado');

        } catch (error) {
            Logger.error('Erro ao buscar recibo:', error);
            throw error;
        }
    }

    /**
     * Formata data para exibição
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Formata distância para exibição
     */
    formatDistance(distance) {
        if (!distance) return '0 km';
        const km = distance / 1000;
        return `${km.toFixed(2)} km`;
    }

    /**
     * Gera texto para compartilhamento
     */
    generateShareText(receipt) {
        return `Reciba Leaf - ${receipt.title}\n\n` +
               `Origem: ${receipt.trip.pickup.address}\n` +
               `Destino: ${receipt.trip.dropoff.address}\n` +
               `Valor: ${receipt.financial.totalPaid.formatted}\n` +
               `Hash: ${receipt.hash}`;
    }
}

export default new ReceiptService();
