/**
 * LOCATION BUFFER SERVICE
 * 
 * Serviço para persistir localizações durante offline
 * Envia localizações acumuladas quando volta online
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';
import { fetchNetInfo } from '../utils/NetInfoSafe';

class LocationBufferService {
    constructor() {
        this.bufferKey = '@location_buffer';
        this.maxBufferSize = 1000; // Máximo de 1000 localizações
        this.syncInterval = null;
        this.isOnline = true;
    }

    /**
     * Inicializar serviço
     */
    async initialize() {
        try {
            // Verificar estado inicial de conexão
            const netInfo = await fetchNetInfo();
            this.isOnline = netInfo.isConnected && netInfo.isInternetReachable;

            // Configurar listener de conectividade
            const { addNetInfoListener } = require('../utils/NetInfoSafe');
            addNetInfoListener((state) => {
                const wasOnline = this.isOnline;
                this.isOnline = state.isConnected && state.isInternetReachable;

                if (!wasOnline && this.isOnline) {
                    // Voltou online - sincronizar localizações
                    this.syncBufferedLocations();
                }
            });

            // Sincronização periódica quando online
            this.syncInterval = setInterval(() => {
                if (this.isOnline) {
                    this.syncBufferedLocations();
                }
            }, 30000); // A cada 30 segundos

            Logger.log('✅ LocationBufferService inicializado');
        } catch (error) {
            Logger.error('❌ Erro ao inicializar LocationBufferService:', error);
        }
    }

    /**
     * Adicionar localização ao buffer
     * @param {string} bookingId - ID da corrida
     * @param {Object} location - { lat, lng, timestamp }
     * @param {string} userType - 'driver' ou 'customer'
     */
    async addLocation(bookingId, location, userType = 'driver') {
        try {
            if (!bookingId || !location || !location.lat || !location.lng) {
                return;
            }

            const locationData = {
                bookingId,
                userType,
                lat: location.lat,
                lng: location.lng,
                timestamp: location.timestamp || Date.now(),
                accuracy: location.accuracy || null,
                heading: location.heading || null,
                speed: location.speed || null
            };

            // Carregar buffer atual
            const buffer = await this.getBuffer();

            // Adicionar localização
            buffer.push(locationData);

            // Limitar tamanho do buffer
            if (buffer.length > this.maxBufferSize) {
                buffer.shift(); // Remover localização mais antiga
            }

            // Salvar buffer
            await AsyncStorage.setItem(this.bufferKey, JSON.stringify(buffer));

            Logger.log(`📍 [LocationBuffer] Localização adicionada ao buffer (${buffer.length} total)`);

            // Se estiver online, tentar enviar imediatamente
            if (this.isOnline) {
                await this.sendLocation(locationData);
            }

        } catch (error) {
            Logger.error('❌ Erro ao adicionar localização ao buffer:', error);
        }
    }

    /**
     * Obter buffer de localizações
     * @returns {Promise<Array>}
     */
    async getBuffer() {
        try {
            const bufferData = await AsyncStorage.getItem(this.bufferKey);
            return bufferData ? JSON.parse(bufferData) : [];
        } catch (error) {
            Logger.error('❌ Erro ao obter buffer:', error);
            return [];
        }
    }

    /**
     * Enviar localização (tentativa)
     * @param {Object} locationData - Dados da localização
     */
    async sendLocation(locationData) {
        try {
            const WebSocketManager = require('./WebSocketManager').default;
            const webSocketManager = WebSocketManager.getInstance();

            if (!webSocketManager.isConnected()) {
                // Não está conectado - manter no buffer
                return false;
            }

            // Enviar via WebSocket
            if (locationData.userType === 'driver') {
                webSocketManager.emitToServer('updateLocation', {
                    lat: locationData.lat,
                    lng: locationData.lng,
                    accuracy: locationData.accuracy,
                    heading: locationData.heading,
                    speed: locationData.speed,
                    timestamp: locationData.timestamp
                });
            } else {
                // Customer - enviar localização do passageiro
                webSocketManager.emitToServer('updatePassengerLocation', {
                    bookingId: locationData.bookingId,
                    lat: locationData.lat,
                    lng: locationData.lng,
                    timestamp: locationData.timestamp
                });
            }

            return true;
        } catch (error) {
            Logger.error('❌ Erro ao enviar localização:', error);
            return false;
        }
    }

    /**
     * Sincronizar localizações do buffer
     */
    async syncBufferedLocations() {
        if (!this.isOnline) {
            return;
        }

        try {
            const buffer = await this.getBuffer();
            
            if (buffer.length === 0) {
                return;
            }

            Logger.log(`🔄 [LocationBuffer] Sincronizando ${buffer.length} localizações...`);

            const synced = [];
            const failed = [];

            for (const locationData of buffer) {
                const success = await this.sendLocation(locationData);
                
                if (success) {
                    synced.push(locationData);
                } else {
                    failed.push(locationData);
                }
            }

            // Atualizar buffer (manter apenas as que falharam)
            await AsyncStorage.setItem(this.bufferKey, JSON.stringify(failed));

            Logger.log(`✅ [LocationBuffer] ${synced.length} localizações sincronizadas, ${failed.length} mantidas no buffer`);

        } catch (error) {
            Logger.error('❌ Erro ao sincronizar localizações:', error);
        }
    }

    /**
     * Limpar buffer de uma corrida específica
     * @param {string} bookingId - ID da corrida
     */
    async clearBufferForBooking(bookingId) {
        try {
            const buffer = await this.getBuffer();
            const filtered = buffer.filter(loc => loc.bookingId !== bookingId);
            await AsyncStorage.setItem(this.bufferKey, JSON.stringify(filtered));
            Logger.log(`🗑️ [LocationBuffer] Buffer limpo para corrida ${bookingId}`);
        } catch (error) {
            Logger.error('❌ Erro ao limpar buffer:', error);
        }
    }

    /**
     * Obter estatísticas do buffer
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const buffer = await this.getBuffer();
            return {
                totalLocations: buffer.length,
                oldestLocation: buffer.length > 0 ? buffer[0].timestamp : null,
                newestLocation: buffer.length > 0 ? buffer[buffer.length - 1].timestamp : null,
                bookings: [...new Set(buffer.map(loc => loc.bookingId))]
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas:', error);
            return {
                totalLocations: 0,
                oldestLocation: null,
                newestLocation: null,
                bookings: []
            };
        }
    }

    /**
     * Limpar recursos
     */
    cleanup() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
}

// Exportar instância singleton
const locationBufferService = new LocationBufferService();
export default locationBufferService;

