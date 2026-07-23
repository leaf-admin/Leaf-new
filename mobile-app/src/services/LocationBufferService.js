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
        this.activeTripContextKey = '@location_buffer_active_trip';
        this.maxBufferSize = 1000; // Máximo de 1000 localizações
        this.syncInterval = null;
        this.isOnline = true;
        this.activeTripContextCache = null;
    }

    buildEventId() {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    async addLocation(bookingId, location, userType = 'driver', options = {}) {
        try {
            const lat = Number(location?.lat);
            const lng = Number(location?.lng);
            if (!bookingId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                return;
            }

            const locationData = {
                eventId: location.eventId || this.buildEventId(),
                bookingId,
                userType,
                lat,
                lng,
                timestamp: location.timestamp || Date.now(),
                accuracy: location.accuracy || null,
                heading: location.heading || null,
                speed: location.speed || null,
                tripStatus: location.tripStatus || null,
                isInTrip: location.isInTrip === true,
                tripId: location.tripId || bookingId,
                driverId: location.driverId || options.driverId || null,
                seq: Number.isFinite(Number(location.seq)) ? Number(location.seq) : null,
                capturedAt: location.capturedAt || location.timestamp || Date.now(),
                source: location.source || 'foreground'
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
            const attemptImmediateSend = options.attemptImmediateSend !== false;
            if (this.isOnline && attemptImmediateSend) {
                const sent = await this.sendLocation(locationData);
                if (sent) {
                    await this.removeBufferedEventById(locationData.eventId);
                }
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

    async removeBufferedEventById(eventId) {
        if (!eventId) {
            return;
        }
        const buffer = await this.getBuffer();
        const filtered = buffer.filter((item) => item.eventId !== eventId);
        await AsyncStorage.setItem(this.bufferKey, JSON.stringify(filtered));
    }

    async setActiveTripContext(context = {}) {
        if (!context.bookingId) {
            return;
        }
        const existing = await this.getActiveTripContext();
        const lastSeqFromContext = Number.isInteger(Number(context.lastSeq))
            ? Number(context.lastSeq)
            : (Number.isInteger(Number(existing?.lastSeq)) ? Number(existing.lastSeq) : 0);

        const payload = {
            bookingId: String(context.bookingId),
            tripId: String(context.tripId || context.bookingId),
            driverId: context.driverId ? String(context.driverId) : null,
            tripStatus: context.tripStatus || 'accepted',
            lastSeq: lastSeqFromContext,
            updatedAt: Date.now()
        };
        this.activeTripContextCache = payload;
        await AsyncStorage.setItem(this.activeTripContextKey, JSON.stringify(payload));
    }

    async updateActiveTripStatus(tripStatus) {
        const context = await this.getActiveTripContext();
        if (!context || !tripStatus) {
            return;
        }
        context.tripStatus = tripStatus;
        context.updatedAt = Date.now();
        this.activeTripContextCache = context;
        await AsyncStorage.setItem(this.activeTripContextKey, JSON.stringify(context));
    }

    async getActiveTripContext() {
        if (this.activeTripContextCache) {
            return this.activeTripContextCache;
        }
        try {
            const raw = await AsyncStorage.getItem(this.activeTripContextKey);
            this.activeTripContextCache = raw ? JSON.parse(raw) : null;
            return this.activeTripContextCache;
        } catch (error) {
            Logger.error('❌ Erro ao ler contexto de corrida ativa:', error);
            return null;
        }
    }

    async clearActiveTripContext(expectedBookingId = null) {
        const context = await this.getActiveTripContext();
        if (!context) {
            return;
        }
        if (expectedBookingId && String(context.bookingId) !== String(expectedBookingId)) {
            return;
        }
        this.activeTripContextCache = null;
        await AsyncStorage.removeItem(this.activeTripContextKey);
    }

    async reserveNextSeq(bookingId) {
        const context = await this.getActiveTripContext();
        if (!context || String(context.bookingId) !== String(bookingId)) {
            return null;
        }
        const nextSeq = Number.isInteger(Number(context.lastSeq)) ? Number(context.lastSeq) + 1 : 1;
        context.lastSeq = nextSeq;
        context.updatedAt = Date.now();
        this.activeTripContextCache = context;
        await AsyncStorage.setItem(this.activeTripContextKey, JSON.stringify(context));
        return nextSeq;
    }

    async syncSeqContext(bookingId, seq) {
        if (!Number.isInteger(Number(seq))) {
            return;
        }
        const context = await this.getActiveTripContext();
        if (!context || String(context.bookingId) !== String(bookingId)) {
            return;
        }
        const numericSeq = Number(seq);
        const currentSeq = Number.isInteger(Number(context.lastSeq)) ? Number(context.lastSeq) : 0;
        if (numericSeq > currentSeq) {
            context.lastSeq = numericSeq;
            context.updatedAt = Date.now();
            this.activeTripContextCache = context;
            await AsyncStorage.setItem(this.activeTripContextKey, JSON.stringify(context));
        }
    }

    async addDriverLocationFromBackground(location = {}) {
        const context = await this.getActiveTripContext();
        if (!context?.bookingId) {
            return { buffered: false, reason: 'no_active_trip' };
        }

        const seq = await this.reserveNextSeq(context.bookingId);
        await this.addLocation(context.bookingId, {
            lat: location.lat,
            lng: location.lng,
            timestamp: location.timestamp || Date.now(),
            accuracy: location.accuracy || null,
            heading: location.heading || null,
            speed: location.speed || null,
            tripStatus: context.tripStatus || 'started',
            isInTrip: true,
            tripId: context.tripId || context.bookingId,
            seq,
            capturedAt: location.timestamp || Date.now(),
            source: 'background_task'
        }, 'driver', { attemptImmediateSend: false });

        return {
            buffered: true,
            bookingId: context.bookingId,
            seq
        };
    }

    /**
     * Enviar localização (tentativa)
     * @param {Object} locationData - Dados da localização
     */
    async sendLocation(locationData) {
        try {
            const WebSocketManager = require('./WebSocketManager').default;
            const webSocketManager = WebSocketManager.getInstance();
            const status = webSocketManager.getConnectionStatus();

            if (!webSocketManager.isConnected() || !status?.authenticated) {
                // Não está conectado - manter no buffer
                return false;
            }

            // Enviar via WebSocket
            if (locationData.userType === 'driver') {
                webSocketManager.emitToServer('updateLocation', {
                    lat: locationData.lat,
                    lng: locationData.lng,
                    bookingId: locationData.bookingId,
                    accuracy: locationData.accuracy,
                    heading: locationData.heading,
                    speed: locationData.speed,
                    timestamp: locationData.timestamp,
                    tripStatus: locationData.tripStatus,
                    isInTrip: locationData.isInTrip,
                    tripId: locationData.tripId,
                    seq: locationData.seq,
                    capturedAt: locationData.capturedAt,
                    source: locationData.source || 'foreground'
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

    async sendDriverLocationBatch(locations = []) {
        if (!Array.isArray(locations) || locations.length === 0) {
            return false;
        }

        try {
            const WebSocketManager = require('./WebSocketManager').default;
            const webSocketManager = WebSocketManager.getInstance();
            const status = webSocketManager.getConnectionStatus();

            if (!webSocketManager.isConnected() || !status?.authenticated) {
                return false;
            }

            if (typeof webSocketManager.updateLocationBatch !== 'function') {
                for (const locationData of locations) {
                    const sent = await this.sendLocation(locationData);
                    if (!sent) return false;
                }
                return true;
            }

            const first = locations[0];
            const context = await this.getActiveTripContext();
            const contextMatchesBooking =
                context?.bookingId && String(context.bookingId) === String(first.bookingId);
            const tripStatus = first.tripStatus || (contextMatchesBooking ? context.tripStatus : null) || 'started';
            const terminalTripStatuses = new Set(['completed', 'cancelled', 'canceled', 'failed']);
            const isInTrip = first.isInTrip === true || (contextMatchesBooking && !terminalTripStatuses.has(String(tripStatus)));
            const driverId =
                first.driverId ||
                context?.driverId ||
                webSocketManager.authenticatedUserId ||
                null;
            const normalizedLocations = locations.map((locationData) => ({
                ...locationData,
                driverId: locationData.driverId || driverId,
                tripId: locationData.tripId || first.tripId || first.bookingId,
                tripStatus: locationData.tripStatus || tripStatus,
                isInTrip: locationData.isInTrip === true || isInTrip,
            }));
            await webSocketManager.updateLocationBatch({
                driverId,
                bookingId: first.bookingId,
                tripId: first.tripId || first.bookingId,
                tripStatus,
                isInTrip,
                source: 'location_buffer_batch',
                locations: normalizedLocations,
            });
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao enviar lote de localizações:', error);
            return false;
        }
    }

    groupDriverLocationsForBatch(buffer = []) {
        const groups = new Map();
        buffer
            .filter((locationData) => locationData?.userType === 'driver')
            .forEach((locationData) => {
                const key = [
                    locationData.bookingId || '',
                    locationData.tripId || locationData.bookingId || '',
                    locationData.driverId || '',
                ].join(':');
                const current = groups.get(key) || [];
                current.push(locationData);
                groups.set(key, current);
            });

        return Array.from(groups.values())
            .map((items) =>
                [...items].sort((left, right) => {
                    const leftSeq = Number(left.seq);
                    const rightSeq = Number(right.seq);
                    if (Number.isInteger(leftSeq) && Number.isInteger(rightSeq)) {
                        return leftSeq - rightSeq;
                    }
                    return Number(left.capturedAt || left.timestamp || 0) - Number(right.capturedAt || right.timestamp || 0);
                })
            );
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
            const processedEventIds = new Set();

            const driverBatches = this.groupDriverLocationsForBatch(buffer);
            for (const batch of driverBatches) {
                const success = await this.sendDriverLocationBatch(batch);
                if (success) {
                    batch.forEach((locationData) => {
                        synced.push(locationData);
                        processedEventIds.add(locationData.eventId);
                    });
                }
            }

            for (const locationData of buffer) {
                if (processedEventIds.has(locationData.eventId)) {
                    continue;
                }
                if (locationData.userType === 'driver') {
                    failed.push(locationData);
                    continue;
                }
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
