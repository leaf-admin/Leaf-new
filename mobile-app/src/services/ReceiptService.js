import Logger from '../utils/Logger';
/**
 * 🧾 RECEIPT SERVICE - CLIENTE MOBILE
 * 
 * Serviço para buscar e gerenciar recibos de corridas
 */

import database from '@react-native-firebase/database';

const API_BASE_URL = String(
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    'https://api.147.182.204.181.sslip.io'
)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');


class ReceiptService {
    /**
     * Busca recibo do Firestore
     * @param {string} rideId - ID da corrida
     * @returns {Promise<Object>} - Recibo encontrado
     */
    async getReceiptByRideId(rideId) {
        try {
            // Tentar buscar do Realtime Database primeiro
            const receiptRef = database().ref(`receipts/${rideId}`);
            const snapshot = await receiptRef.once('value');
            
            if (snapshot.exists()) {
                return snapshot.val();
            }

            // Se não encontrou no Realtime Database, tentar buscar via API
            // (fallback para recibos antigos que podem estar apenas no backend)
            try {
                const response = await fetch(`${API_BASE_URL}/api/receipts/${rideId}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.receipt) {
                        return data.receipt;
                    }
                }
            } catch (apiError) {
                Logger.warn('Erro ao buscar recibo via API:', apiError);
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
