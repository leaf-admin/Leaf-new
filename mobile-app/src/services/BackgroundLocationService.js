import Logger from '../utils/Logger';
import * as Location from 'expo-location';
import { Platform, Alert, Linking, AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Nome da task de background
const LOCATION_TASK_NAME = 'background-location-task';
const BACKGROUND_LOCATION_TIME_INTERVAL_MS = Number.parseInt(process.env.EXPO_PUBLIC_BACKGROUND_LOCATION_INTERVAL_MS || '2000', 10);
const BACKGROUND_LOCATION_DISTANCE_INTERVAL_M = Number.parseInt(process.env.EXPO_PUBLIC_BACKGROUND_LOCATION_DISTANCE_M || '0', 10);
const BACKGROUND_DISCLOSURE_ACCEPTED_KEY = 'has_shown_background_location_modal';

// ✅ Registrar task de background (se ainda não estiver registrada)
if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
    TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
        if (error) {
            Logger.warn('⚠️ Erro na task de background:', error?.message || error);
            return;
        }
        if (data) {
            const { locations } = data;
            if (!Array.isArray(locations) || locations.length === 0) {
                return;
            }

            try {
                const locationBufferService = require('./LocationBufferService').default;
                const prototypeDriverTripAssistantService = require('./PrototypeDriverTripAssistantService').default;
                for (const locationItem of locations) {
                    const coords = locationItem?.coords || {};
                    const lat = Number(coords.latitude);
                    const lng = Number(coords.longitude);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                        continue;
                    }

                    await locationBufferService.addDriverLocationFromBackground({
                        lat,
                        lng,
                        accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
                        heading: Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
                        speed: Number.isFinite(Number(coords.speed)) ? Number(coords.speed) : null,
                        timestamp: Number.isFinite(Number(locationItem?.timestamp))
                            ? Number(locationItem.timestamp)
                            : Date.now()
                    });

                    await prototypeDriverTripAssistantService.handleBackgroundLocationUpdate({
                        lat,
                        lng
                    });
                }
            } catch (taskError) {
                Logger.warn('⚠️ Falha ao bufferizar localização em background task:', taskError?.message || taskError);
            }
        }
    });
}

class BackgroundLocationService {
    static instance = null;
    locationSubscription = null;
    isTracking = false;

    static getInstance() {
        if (!BackgroundLocationService.instance) {
            BackgroundLocationService.instance = new BackgroundLocationService();
        }
        return BackgroundLocationService.instance;
    }

    /**
     * Solicitar permissões de localização (foreground e background)
     * @returns {Promise<{foreground: boolean, background: boolean}>}
     */
    async requestPermissions() {
        try {
            // Solicitar permissão de foreground primeiro
            const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
            
            if (foregroundStatus !== 'granted') {
                Logger.warn('⚠️ Permissão de foreground negada');
                return {
                    foreground: false,
                    background: false
                };
            }

            // Solicitar permissão de background apenas após disclosure explícito no app
            let backgroundStatus = 'denied';
            const hasAcceptedDisclosure =
                (await AsyncStorage.getItem(BACKGROUND_DISCLOSURE_ACCEPTED_KEY)) === 'true';

            if (!hasAcceptedDisclosure) {
                Logger.warn('⚠️ Background location bloqueada até disclosure explícito do usuário');
                return {
                    foreground: foregroundStatus === 'granted',
                    background: false
                };
            }

            if (Platform.OS === 'android') {
                const { status } = await Location.requestBackgroundPermissionsAsync();
                backgroundStatus = status;
            } else {
                // iOS requer configuração adicional no app.json
                const { status } = await Location.requestBackgroundPermissionsAsync();
                backgroundStatus = status;
            }

            return {
                foreground: foregroundStatus === 'granted',
                background: backgroundStatus === 'granted'
            };
        } catch (error) {
            // ✅ CRÍTICO: Nunca crashar, sempre retornar objeto válido
            Logger.error('❌ Erro ao solicitar permissões:', error);
            return {
                foreground: false,
                background: false
            };
        }
    }

    /**
     * Verificar status das permissões
     * @returns {Promise<{foreground: boolean, background: boolean}>}
     */
    async checkPermissions() {
        try {
            const foregroundStatus = await Location.getForegroundPermissionsAsync();
            const backgroundStatus = await Location.getBackgroundPermissionsAsync();

            return {
                foreground: foregroundStatus.status === 'granted',
                background: backgroundStatus.status === 'granted'
            };
        } catch (error) {
            Logger.error('❌ Erro ao verificar permissões:', error);
            return {
                foreground: false,
                background: false
            };
        }
    }

    /**
     * Iniciar tracking de localização em background
     */
    async startBackgroundTracking() {
        try {
            if (this.isTracking) {
                Logger.log('📍 Tracking já está ativo');
                return;
            }

            // ✅ Verificar se app está em foreground antes de iniciar
            const appState = AppState.currentState;
            if (appState !== 'active') {
                Logger.warn('⚠️ App não está em foreground, aguardando para iniciar tracking...');
                // Aguardar app voltar ao foreground
                return;
            }

            const permissions = await this.checkPermissions();
            if (!permissions.foreground) {
                throw new Error('Permissão de foreground não concedida');
            }

            // Verificar se background permission está disponível
            if (Platform.OS === 'android' && !permissions.background) {
                Logger.warn('⚠️ Permissão de background não concedida. Usando foreground tracking.');
            }

            // Iniciar tracking de localização
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: BACKGROUND_LOCATION_TIME_INTERVAL_MS,
                distanceInterval: BACKGROUND_LOCATION_DISTANCE_INTERVAL_M,
                foregroundService: {
                    notificationTitle: 'Leaf App',
                    notificationBody: 'Rastreando sua localização',
                    notificationColor: '#003002'
                },
                pausesUpdatesAutomatically: false,
                showsBackgroundLocationIndicator: true
            });

            this.isTracking = true;
            Logger.log('✅ Tracking de background iniciado');
        } catch (error) {
            // ✅ Não lançar erro, apenas logar (evitar quebrar o fluxo)
            Logger.error('❌ Erro ao iniciar tracking de background:', error);
            // Se o erro for sobre foreground service, apenas logar e continuar
            if (error.message && error.message.includes('foreground service')) {
                Logger.warn('⚠️ Não foi possível iniciar foreground service (app pode estar em background). Tentando novamente quando app voltar ao foreground.');
                this.isTracking = false; // Resetar flag para tentar novamente depois
            }
        }
    }

    /**
     * Parar tracking de localização em background
     */
    async stopBackgroundTracking() {
        try {
            if (!this.isTracking) {
                return;
            }

            if (Device.isDevice === false) {
                this.isTracking = false;
                return;
            }

            const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (isRunning) {
                await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
            }

            this.isTracking = false;
            Logger.log('✅ Tracking de background parado');
        } catch (error) {
            this.isTracking = false;
            if (Device.isDevice === false) {
                return;
            }
            Logger.error('❌ Erro ao parar tracking de background:', error);
        }
    }

    /**
     * Obter localização atual
     * @param {Object} options - Opções de precisão
     * @returns {Promise<Location.LocationObject>}
     */
    async getCurrentLocation(options = {}) {
        try {
            const permissions = await this.checkPermissions();
            if (!permissions.foreground) {
                throw new Error('Permissão de localização não concedida');
            }

            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
                maximumAge: 10000,
                timeout: 15000,
                ...options
            });

            return location;
        } catch (error) {
            Logger.error('❌ Erro ao obter localização atual:', error);
            throw error;
        }
    }

    /**
     * Watch de localização (foreground)
     * @param {Function} callback - Callback para receber atualizações
     * @param {Object} options - Opções de precisão
     * @returns {Promise<Location.LocationSubscription>}
     */
    async watchLocation(callback, options = {}) {
        try {
            const permissions = await this.checkPermissions();
            if (!permissions.foreground) {
                throw new Error('Permissão de localização não concedida');
            }

            const subscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 5000,
                    distanceInterval: 10,
                    ...options
                },
                callback
            );

            this.locationSubscription = subscription;
            return subscription;
        } catch (error) {
            Logger.error('❌ Erro ao iniciar watch de localização:', error);
            throw error;
        }
    }

    /**
     * Parar watch de localização
     */
    stopWatchingLocation() {
        if (this.locationSubscription) {
            this.locationSubscription.remove();
            this.locationSubscription = null;
            Logger.log('✅ Watch de localização parado');
        }
    }

    /**
     * Verificar se o tracking está ativo
     * @returns {Promise<boolean>}
     */
    async isTrackingActive() {
        try {
            return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        } catch (error) {
            Logger.error('❌ Erro ao verificar status do tracking:', error);
            return false;
        }
    }
}

// Exportar tanto a classe quanto a instância
const instance = BackgroundLocationService.getInstance();
export default instance;
export { BackgroundLocationService };
