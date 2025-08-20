import AsyncStorage from '@react-native-async-storage/async-storage';
import WebSocketManager from './WebSocketManager';
import { store } from '../common-local/store';

class RatingService {
    constructor() {
        this.webSocketManager = WebSocketManager.getInstance();
    }

    // Enviar avaliação via WebSocket
    async submitRating(ratingData) {
        try {
            console.log('⭐ Enviando avaliação:', ratingData);
            
            // Conectar ao WebSocket se necessário
            if (!this.webSocketManager.isConnected()) {
                await this.webSocketManager.connect();
            }
            
            // Enviar avaliação via WebSocket
            const result = await this.webSocketManager.submitRating(ratingData);
            
            if (result.success) {
                console.log('✅ Avaliação enviada com sucesso');
                
                // Salvar localmente
                await this.saveRatingLocally(ratingData);
                
                // Atualizar Redux store
                this.updateRatingInStore(ratingData);
                
                return result;
            } else {
                throw new Error(result.error || 'Falha ao enviar avaliação');
            }
            
        } catch (error) {
            console.error('❌ Erro ao enviar avaliação:', error);
            
            // Salvar localmente para envio posterior
            await this.saveRatingLocally(ratingData);
            
            throw error;
        }
    }

    // Salvar avaliação localmente
    async saveRatingLocally(ratingData) {
        try {
            const ratings = await this.getLocalRatings();
            ratings.push({
                ...ratingData,
                id: Date.now().toString(),
                status: 'pending' // Para envio posterior
            });
            
            await AsyncStorage.setItem('localRatings', JSON.stringify(ratings));
            console.log('💾 Avaliação salva localmente');
            
        } catch (error) {
            console.error('❌ Erro ao salvar avaliação localmente:', error);
        }
    }

    // Obter avaliações locais
    async getLocalRatings() {
        try {
            const ratings = await AsyncStorage.getItem('localRatings');
            return ratings ? JSON.parse(ratings) : [];
        } catch (error) {
            console.error('❌ Erro ao obter avaliações locais:', error);
            return [];
        }
    }

    // Enviar avaliações pendentes
    async sendPendingRatings() {
        try {
            const ratings = await this.getLocalRatings();
            const pendingRatings = ratings.filter(r => r.status === 'pending');
            
            if (pendingRatings.length === 0) return;
            
            console.log(`📤 Enviando ${pendingRatings.length} avaliações pendentes...`);
            
            for (const rating of pendingRatings) {
                try {
                    await this.submitRating(rating);
                    
                    // Marcar como enviada
                    rating.status = 'sent';
                    await this.saveLocalRatings(ratings);
                    
                } catch (error) {
                    console.error(`❌ Erro ao enviar avaliação pendente:`, error);
                }
            }
            
        } catch (error) {
            console.error('❌ Erro ao enviar avaliações pendentes:', error);
        }
    }

    // Salvar avaliações locais
    async saveLocalRatings(ratings) {
        try {
            await AsyncStorage.setItem('localRatings', JSON.stringify(ratings));
        } catch (error) {
            console.error('❌ Erro ao salvar avaliações locais:', error);
        }
    }

    // Atualizar Redux store
    updateRatingInStore(ratingData) {
        try {
            const { dispatch } = store;
            
            // Importar actions
            const { addRating } = require('../common-local/actions/ratingactions');
            
            // Adicionar avaliação ao store
            dispatch(addRating(ratingData));
            
        } catch (error) {
            console.error('❌ Erro ao atualizar Redux store:', error);
        }
    }

    // Obter avaliações de uma viagem específica
    async getTripRatings(tripId) {
        try {
            // Primeiro tentar obter via WebSocket
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected()) {
                const result = await webSocketManager.getTripRatings(tripId);
                if (result.success) {
                    return result.ratings;
                }
            }
            
            // Fallback: tentar obter do Redux store
            const state = store.getState();
            const ratings = state.ratings?.ratings || [];
            
            const tripRatings = ratings.filter(r => r.tripId === tripId);
            
            if (tripRatings.length > 0) {
                return tripRatings;
            }
            
            // Fallback: tentar obter localmente
            const localRatings = await this.getLocalRatings();
            return localRatings.filter(r => r.tripId === tripId);
            
        } catch (error) {
            console.error('❌ Erro ao obter avaliações da viagem:', error);
            
            // Fallback para dados locais
            try {
                const localRatings = await this.getLocalRatings();
                return localRatings.filter(r => r.tripId === tripId);
            } catch (localError) {
                console.error('❌ Erro ao obter avaliações locais:', localError);
                return [];
            }
        }
    }

    // Obter estatísticas de avaliação
    getRatingStats(ratings) {
        if (!ratings || ratings.length === 0) {
            return {
                average: 0,
                total: 0,
                distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
            };
        }
        
        const total = ratings.length;
        const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
        const average = sum / total;
        
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratings.forEach(r => {
            distribution[r.rating] = (distribution[r.rating] || 0) + 1;
        });
        
        return {
            average: Math.round(average * 10) / 10,
            total,
            distribution
        };
    }

    // Verificar se usuário já avaliou uma viagem
    async hasUserRatedTrip(tripId, userType) {
        try {
            // Primeiro tentar obter via WebSocket
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected()) {
                const result = await webSocketManager.hasUserRatedTrip(tripId, userType);
                if (result.success) {
                    return result.hasRated;
                }
            }
            
            // Fallback: verificar localmente
            const ratings = await this.getTripRatings(tripId);
            return ratings.some(r => r.userType === userType);
        } catch (error) {
            console.error('❌ Erro ao verificar se usuário já avaliou:', error);
            return false;
        }
    }

    // Obter avaliações de um usuário específico
    async getUserRatings(targetUserId, userType) {
        try {
            // Primeiro tentar obter via WebSocket
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected()) {
                const result = await webSocketManager.getUserRatings(targetUserId, userType);
                if (result.success) {
                    return result;
                }
            }
            
            // Fallback: tentar obter localmente
            const localRatings = await this.getLocalRatings();
            const userRatings = localRatings.filter(r => r.userId === targetUserId && r.userType !== userType);
            
            // Calcular estatísticas básicas
            const totalRatings = userRatings.length;
            const averageRating = totalRatings > 0 
                ? Math.round((userRatings.reduce((sum, r) => sum + r.rating, 0) / totalRatings) * 10) / 10
                : 0;
            
            const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            userRatings.forEach(r => {
                ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + 1;
            });
            
            return {
                ratings: userRatings,
                total: totalRatings,
                average: averageRating,
                distribution: ratingDistribution
            };
            
        } catch (error) {
            console.error('❌ Erro ao obter avaliações do usuário:', error);
            return {
                ratings: [],
                total: 0,
                average: 0,
                distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
            };
        }
    }

    // Obter avaliações pendentes
    async getPendingRatings() {
        try {
            const ratings = await this.getLocalRatings();
            return ratings.filter(r => r.status === 'pending');
        } catch (error) {
            console.error('❌ Erro ao obter avaliações pendentes:', error);
            return [];
        }
    }

    // Limpar avaliações antigas (mais de 30 dias)
    async cleanupOldRatings() {
        try {
            const ratings = await this.getLocalRatings();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const recentRatings = ratings.filter(r => {
                const ratingDate = new Date(r.timestamp);
                return ratingDate > thirtyDaysAgo;
            });
            
            if (recentRatings.length !== ratings.length) {
                await this.saveLocalRatings(recentRatings);
                console.log(`🧹 Limpeza: ${ratings.length - recentRatings.length} avaliações antigas removidas`);
            }
            
        } catch (error) {
            console.error('❌ Erro ao limpar avaliações antigas:', error);
        }
    }
}

export default new RatingService();
