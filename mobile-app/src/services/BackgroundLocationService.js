import Logger from '../utils/Logger';
import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import {
    BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY,
    requestBackgroundLocationPermissionWithDisclosure,
    requestForegroundLocationPermissionWithDisclosure
} from './AndroidPermissionDisclosure';

// Nome da task de background
const LOCATION_TASK_NAME = 'background-location-task';
const BACKGROUND_LOCATION_TIME_INTERVAL_MS = Number.parseInt(process.env.EXPO_PUBLIC_BACKGROUND_LOCATION_INTERVAL_MS || '2000', 10);
const BACKGROUND_LOCATION_DISTANCE_INTERVAL_M = Number.parseInt(process.env.EXPO_PUBLIC_BACKGROUND_LOCATION_DISTANCE_M || '0', 10);
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
                            : Date.now(),
                        // Android marca a posição vinda de app de GPS simulado.
                        mocked: locationItem?.mocked === true
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

// O Logger serializa objetos por chaves enumeráveis, o que reduz um Error nativo
// a {"code": "..."} e descarta a mensagem real ("→ Caused by: ..."). Extrair aqui.
function describeTrackingError(error) {
    const code = typeof error?.code === 'string' && error.code ? error.code : null;
    const rawMessage = typeof error?.message === 'string' ? error.message : String(error ?? '');
    const message = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 600) || 'erro desconhecido';
    return { code, message };
}

class BackgroundLocationService {
    static instance = null;
    locationSubscription = null;
    isTracking = false;
    startInFlight = null;
    lastStartFailure = null;
    trackingStatusListeners = new Set();

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
            const { status: foregroundStatus } = await requestForegroundLocationPermissionWithDisclosure();
            
            if (foregroundStatus !== 'granted') {
                Logger.warn('⚠️ Permissão de foreground negada');
                return {
                    foreground: false,
                    background: false
                };
            }

            const { status: backgroundStatus } = await requestBackgroundLocationPermissionWithDisclosure();

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
     * Estado observável do tracking de background. Uma falha ao iniciar não é
     * engolida: fica disponível aqui (código + mensagem nativa real) para a UI
     * ou para diagnóstico, mesmo em release, onde o Logger não imprime.
     * @returns {{isTracking: boolean, lastStartFailure: (null|{code: (string|null), message: string, nativeTaskRegistered: (boolean|null), count: number, firstAt: number, lastAt: number})}}
     */
    getTrackingStatus() {
        return {
            isTracking: this.isTracking,
            lastStartFailure: this.lastStartFailure ? { ...this.lastStartFailure } : null
        };
    }

    /**
     * Observar mudanças do estado acima (início, falha ao iniciar, parada).
     * @param {Function} listener - recebe o mesmo objeto de getTrackingStatus()
     * @returns {Function} cancelar a inscrição
     */
    subscribeTrackingStatus(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        this.trackingStatusListeners.add(listener);
        return () => {
            this.trackingStatusListeners.delete(listener);
        };
    }

    notifyTrackingStatus() {
        const status = this.getTrackingStatus();
        this.trackingStatusListeners.forEach((listener) => {
            try {
                listener(status);
            } catch (listenerError) {
                Logger.warn('⚠️ Listener de status do tracking falhou:', listenerError?.message || listenerError);
            }
        });
    }

    /**
     * Iniciar tracking de localização em background.
     * Idempotente: já ativo é no-op e chamadas concorrentes compartilham a mesma tentativa.
     */
    async startBackgroundTracking() {
        if (this.isTracking) {
            Logger.log('📍 Tracking já está ativo');
            return;
        }
        if (this.startInFlight) {
            return this.startInFlight;
        }
        // Uma parada em andamento terminaria depois deste início e derrubaria o serviço
        // recém-criado (fim de corrida com o motorista ainda online).
        if (this.stopInFlight) {
            await this.stopInFlight.catch(() => {});
            if (this.isTracking) {
                return;
            }
            if (this.startInFlight) {
                return this.startInFlight;
            }
        }
        this.startInFlight = this.startBackgroundTrackingOnce().finally(() => {
            this.startInFlight = null;
        });
        return this.startInFlight;
    }

    async startBackgroundTrackingOnce() {
        try {
            // ✅ Verificar se app está em foreground antes de iniciar
            const appState = AppState.currentState;
            if (appState !== 'active') {
                Logger.warn('⚠️ App não está em foreground, aguardando para iniciar tracking...');
                // Aguardar app voltar ao foreground
                return;
            }

            if (Device.isDevice === false) {
                Logger.log('📍 Emulador detectado, pulando tracking nativo de background');
                this.isTracking = false;
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
                    notificationTitle: 'Leaf · Você está online',
                    notificationBody: 'Recebendo corridas perto de você. Toque para voltar ao app.',
                    notificationColor: '#003002'
                },
                pausesUpdatesAutomatically: false,
                showsBackgroundLocationIndicator: true
            });

            this.isTracking = true;
            if (this.lastStartFailure) {
                Logger.log(`✅ Tracking de background recuperado após ${this.lastStartFailure.count} falha(s)`);
            }
            this.lastStartFailure = null;
            Logger.log('✅ Tracking de background iniciado');
            this.notifyTrackingStatus();
        } catch (error) {
            // ✅ Não lançar erro (evitar quebrar o fluxo), mas registrar a condição
            this.isTracking = false;
            await this.recordStartFailure(error);
        }
    }

    /**
     * Uma falha persistente é UMA condição: console.error apenas quando ela aparece
     * ou muda; repetições idênticas viram log simples com contador.
     */
    async recordStartFailure(error) {
        const { code, message } = describeTrackingError(error);
        let nativeTaskRegistered = null;
        try {
            nativeTaskRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        } catch (statusError) {
            nativeTaskRegistered = null;
        }

        const signature = `${code || ''}|${message}`;
        const now = Date.now();
        const previous = this.lastStartFailure;
        if (previous && previous.signature === signature) {
            this.lastStartFailure = {
                ...previous,
                nativeTaskRegistered,
                count: previous.count + 1,
                lastAt: now
            };
            Logger.log(`📍 Tracking de background segue indisponível (mesma falha, tentativa ${previous.count + 1}): [${code || 'sem código'}]`);
            this.notifyTrackingStatus();
            return;
        }

        this.lastStartFailure = {
            signature,
            code,
            message,
            nativeTaskRegistered,
            count: 1,
            firstAt: now,
            lastAt: now
        };
        Logger.error(
            `❌ Erro ao iniciar tracking de background: [${code || 'sem código'}] ${message}`
            + ` (task nativa registrada: ${nativeTaskRegistered === null ? 'desconhecido' : nativeTaskRegistered})`
        );
        this.notifyTrackingStatus();
    }

    /**
     * Parar tracking de localização em background.
     * Consulta o estado nativo: uma task registrada sobrevive ao reinício do app,
     * enquanto `isTracking` (memória JS) volta a false.
     */
    // Várias partes do app pedem a parada ao mesmo tempo quando a corrida termina. Sem
    // isto, a segunda chamada encontrava a tarefa já removida e registrava um erro.
    async stopBackgroundTracking() {
        if (this.stopInFlight) {
            return this.stopInFlight;
        }
        if (this.startInFlight) {
            await this.startInFlight.catch(() => {});
            if (this.stopInFlight) {
                return this.stopInFlight;
            }
        }
        this.stopInFlight = this.stopBackgroundTrackingOnce().finally(() => {
            this.stopInFlight = null;
        });
        return this.stopInFlight;
    }

    async stopBackgroundTrackingOnce() {
        const wasTracking = this.isTracking;
        try {
            if (Device.isDevice === false) {
                this.isTracking = false;
                return;
            }

            const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (isRunning) {
                await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
            }

            this.isTracking = false;
            this.lastStartFailure = null;
            if (wasTracking || isRunning) {
                Logger.log('✅ Tracking de background parado');
            }
            this.notifyTrackingStatus();
        } catch (error) {
            this.isTracking = false;
            if (Device.isDevice === false) {
                return;
            }
            const { code, message } = describeTrackingError(error);
            // Parar o que já não está rodando não é erro: o sistema já encerrou a tarefa.
            if (/TaskNotFoundException|Task '.*' not found/i.test(String(message || ''))) {
                this.lastStartFailure = null;
                this.notifyTrackingStatus();
                return;
            }
            const report = `Erro ao parar tracking de background: [${code || 'sem código'}] ${message}`;
            if (wasTracking) {
                Logger.error(`❌ ${report}`);
            } else {
                // Nada foi iniciado por este contexto JS: a sondagem nativa falhou, não o tracking.
                Logger.log(`📍 ${report}`);
            }
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
export { BackgroundLocationService, BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY };
