import Logger from '../utils/Logger';
/**
 * 🔔 SERVIÇO DE NOTIFICAÇÃO PERSISTENTE DE CORRIDA
 * 
 * Cria e mantém uma notificação persistente (foreground) que fica sempre visível
 * durante a corrida, mostrando o status atual (como iFood e Uber fazem)
 * 
 * Funcionalidades:
 * - Notificação que não pode ser removida pelo usuário
 * - Atualização em tempo real do status da corrida
 * - Funciona mesmo com app em background
 * - Mostra informações relevantes (status, tempo, distância)
 */

import * as Notifications from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import fcmService from './FCMNotificationService';
import { requestExpoNotificationsPermissionWithDisclosure } from './AndroidPermissionDisclosure';
import runtimeConfigService from './RuntimeConfigService';

const RIDE_NOTIFICATION_STATE_KEY = '@leaf:persistentRideNotificationState';
const RIDE_NOTIFICATION_DEDUPE_TTL_MS = 30 * 1000;
const RIDE_NOTIFICATION_UPDATE_INTERVAL_MS = 10 * 1000;
const ANDROID_NATIVE_RIDE_NOTIFICATION_ID = 'leaf-ride-status-43001';

const getNativeRideNotificationModule = () => {
    if (Platform.OS !== 'android') return null;
    const nativeModule = NativeModules?.LeafRideNotification;
    return nativeModule && typeof nativeModule.showOrUpdate === 'function'
        ? nativeModule
        : null;
};

const toFiniteNumber = (value, fallback = null) => {
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    const normalized = typeof value === 'string' ? value.replace(',', '.').match(/-?\d+(\.\d+)?/)?.[0] : value;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeDurationMinutes = (value, fallback = null) => {
    const numeric = toFiniteNumber(value, fallback);
    if (!Number.isFinite(numeric)) return fallback;
    // Some route payloads still carry duration in seconds.
    return numeric > 180 ? Math.ceil(numeric / 60) : numeric;
};

const firstDurationMinutes = (...values) => {
    for (const value of values) {
        const duration = normalizeDurationMinutes(value, null);
        if (Number.isFinite(duration)) return duration;
    }
    return null;
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const formatMinutes = (value) => {
    const numeric = normalizeDurationMinutes(value, null);
    if (!Number.isFinite(numeric)) return null;
    if (numeric <= 0) return 'agora';
    const rounded = Math.max(1, Math.ceil(numeric));
    return `${rounded} min`;
};

const buildProgressText = (progressRatio) => {
    if (!Number.isFinite(progressRatio)) return null;
    const slots = 10;
    const filled = Math.max(0, Math.min(slots, Math.round(progressRatio * slots)));
    return `${'█'.repeat(filled)}${'░'.repeat(slots - filled)}`;
};

const parseTimestampMs = (value) => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getPhaseStartedAtMs = (rideData = {}) => {
    const candidates = [
        rideData.phaseStartedAt,
        rideData.statusStartedAt,
        rideData.acceptedAt,
        rideData.arrivedAt,
        rideData.startedAt,
        rideData.timestamp,
        rideData.updatedAt,
        rideData.createdAt,
    ];
    for (const candidate of candidates) {
        const parsed = parseTimestampMs(candidate);
        if (parsed) return parsed;
    }
    return Date.now();
};

const getLocationAddress = (location, fallback) => {
    if (typeof location === 'string') return location;
    return String(location?.address || location?.add || location?.name || fallback || '').trim();
};

const getStatusDurationMinutes = (rideData = {}) => {
    const status = String(rideData.status || '').toLowerCase();
    if (status === 'accepted') {
        return firstDurationMinutes(
            rideData.pickupEstimatedTime,
            rideData.pickupEtaMinutes,
            rideData.estimatedPickupTime,
            rideData.estimatedTime
        );
    }
    if (status === 'started') {
        return firstDurationMinutes(
            rideData.tripEstimatedTime,
            rideData.tripEstimatedMinutes,
            rideData.estimatedTripTime,
            rideData.tripEtaMinutes,
            rideData.durationMinutes,
            rideData.estimatedDuration,
            rideData.duration,
            rideData.estimatedTime
        );
    }
    return firstDurationMinutes(rideData.estimatedTime);
};

const getTripDurationMinutes = (rideData = {}) => firstDurationMinutes(
    rideData.tripEstimatedTime,
    rideData.tripEstimatedMinutes,
    rideData.estimatedTripTime,
    rideData.tripEtaMinutes,
    rideData.durationMinutes,
    rideData.estimatedDuration,
    rideData.duration
);

const buildTimelineDetails = (rideData = {}, nowMs = Date.now()) => {
    const durationMinutes = getStatusDurationMinutes(rideData);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return {
            remainingLabel: formatMinutes(rideData.estimatedTime),
            durationLabel: formatMinutes(durationMinutes),
            progressLine: null,
            progressPercent: null,
        };
    }

    const phaseStartedAtMs = getPhaseStartedAtMs(rideData);
    const elapsedMinutes = Math.max(0, (nowMs - phaseStartedAtMs) / 60000);
    const progressRatio = clamp(elapsedMinutes / durationMinutes, 0, 0.98);
    const remainingMinutes = Math.max(0, durationMinutes - elapsedMinutes);
    const progressText = buildProgressText(progressRatio);
    const progressPercent = Math.round(progressRatio * 100);

    return {
        remainingLabel: formatMinutes(remainingMinutes),
        durationLabel: formatMinutes(durationMinutes),
        progressLine: progressText ? `${progressText} ${progressPercent}%` : null,
        progressPercent,
    };
};

const compactLines = (...lines) => lines.filter(Boolean).join('\n');

const parseRideStatusPayload = (data = {}) => {
    const processedData = { ...data };
    if (typeof processedData.pickup === 'string') {
        try { processedData.pickup = JSON.parse(processedData.pickup); } catch (e) { }
    }
    if (typeof processedData.destination === 'string') {
        try { processedData.destination = JSON.parse(processedData.destination); } catch (e) { }
    }
    return processedData;
};

class PersistentRideNotificationService {
    constructor() {
        this.currentNotificationId = null;
        this.currentBookingId = null;
        this.updateInterval = null;
        this.isActive = false;
        this.isInitialized = false;
        this.initializePromise = null;
        this.hasRegisteredFcmHandler = false;
        this.lastRidePayloadFingerprint = null;
        this.lastRidePayloadHandledAt = 0;
    }

    /**
     * Inicializar o serviço
     */
    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        if (this.initializePromise) {
            return this.initializePromise;
        }

        this.initializePromise = (async () => {
        try {
            Logger.log('🔔 [PersistentRideNotification] Inicializando serviço...');

            // Configurar canal para Android (alta prioridade, persistente)
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync('ride_status', {
                    name: 'Status da Corrida',
                    description: 'Notificação persistente mostrando o status atual da corrida',
                    importance: Notifications.AndroidImportance.HIGH,
                    vibrationPattern: [0, 250, 250, 250],
                    lightColor: '#1A330E',
                    sound: 'default',
                    enableVibrate: true,
                    showBadge: true,
                });
            }

            // Register handler for FCM messages
            this.setupFCMHandler();

            this.isInitialized = true;
            Logger.log('✅ [PersistentRideNotification] Serviço inicializado');
            return true;
        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao inicializar:', error);
            this.isInitialized = false;
            return false;
        } finally {
            this.initializePromise = null;
        }
        })();

        return this.initializePromise;
    }

    /**
     * Solicitar permissões de notificação
     */
    async requestPermissions() {
        try {
            // Verificar se é dispositivo físico
            if (!Device.isDevice) {
                Logger.log('⚠️ [PersistentRideNotification] Não é um dispositivo físico, pulando permissões');
                return true;
            }

            // Verificar permissões existentes
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;

            // Se não tem permissão, solicitar
            if (existingStatus !== 'granted') {
                const { status } = await requestExpoNotificationsPermissionWithDisclosure(Notifications, {
                    ios: {
                        allowAlert: true,
                        allowBadge: true,
                        allowSound: true,
                        allowAnnouncements: false,
                    },
                });
                finalStatus = status;
            }

            if (finalStatus !== 'granted') {
                Logger.warn('⚠️ [PersistentRideNotification] Permissões de notificação negadas');
                return false;
            }

            Logger.log('✅ [PersistentRideNotification] Permissões concedidas');
            return true;
        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao solicitar permissões:', error);
            return false;
        }
    }

    /**
     * Configurar handler para notificações FCM
     */
    setupFCMHandler() {
        if (this.hasRegisteredFcmHandler) {
            return;
        }

        const handleRideStatusNotification = async (remoteMessage) => {
            Logger.log('📱 [PersistentRideNotification] Tratando evento FCM para notificação persistente:', remoteMessage);
            const { data } = remoteMessage;

            if (data && data.bookingId && data.status) {
                await this.handleRideStatusPayload(data);
            }
        };

        // Escutar por eventos que devam atualizar a notificação persistente
        fcmService.registerNotificationHandler('ride_status_update', handleRideStatusNotification);
        this.hasRegisteredFcmHandler = true;
    }

    async persistNotificationState() {
        if (!this.currentNotificationId || !this.currentBookingId) return;
        try {
            await AsyncStorage.setItem(
                RIDE_NOTIFICATION_STATE_KEY,
                JSON.stringify({
                    notificationId: this.currentNotificationId,
                    bookingId: this.currentBookingId,
                    payloadFingerprint: this.lastRidePayloadFingerprint,
                    payloadHandledAt: this.lastRidePayloadHandledAt,
                })
            );
        } catch (error) {
            Logger.warn('⚠️ [PersistentRideNotification] Falha ao persistir estado:', error?.message || error);
        }
    }

    async hydrateNotificationState() {
        if (this.currentNotificationId && this.currentBookingId) {
            return;
        }

        try {
            const raw = await AsyncStorage.getItem(RIDE_NOTIFICATION_STATE_KEY);
            if (!raw) return;
            const stored = JSON.parse(raw);
            if (stored?.notificationId && stored?.bookingId) {
                this.currentNotificationId = stored.notificationId;
                this.currentBookingId = stored.bookingId;
                this.lastRidePayloadFingerprint = stored.payloadFingerprint || null;
                this.lastRidePayloadHandledAt = Number(stored.payloadHandledAt || 0);
                this.isActive = true;
            }
        } catch (error) {
            Logger.warn('⚠️ [PersistentRideNotification] Falha ao hidratar estado:', error?.message || error);
        }
    }

    async clearNotificationState() {
        try {
            await AsyncStorage.removeItem(RIDE_NOTIFICATION_STATE_KEY);
        } catch (error) {
            Logger.warn('⚠️ [PersistentRideNotification] Falha ao limpar estado:', error?.message || error);
        }
    }

    getRidePayloadFingerprint(rideData = {}) {
        const pickupAddress = rideData?.pickup?.address || rideData?.pickupAddress || '';
        const destinationAddress = rideData?.destination?.address || rideData?.destinationAddress || '';
        return [
            rideData.bookingId || '',
            rideData.status || '',
            rideData.userType || '',
            rideData.estimatedTime || '',
            rideData.pickupEstimatedTime || '',
            rideData.tripEstimatedTime || '',
            rideData.phaseStartedAt || '',
            rideData.distance || '',
            rideData.fare || '',
            pickupAddress,
            destinationAddress,
            rideData.driverName || '',
            rideData.customerName || '',
        ].join('|');
    }

    shouldSuppressDuplicatePayload(rideData = {}) {
        const fingerprint = this.getRidePayloadFingerprint(rideData);
        const now = Date.now();
        const isDuplicate =
            fingerprint &&
            fingerprint === this.lastRidePayloadFingerprint &&
            now - this.lastRidePayloadHandledAt < RIDE_NOTIFICATION_DEDUPE_TTL_MS;

        if (isDuplicate) {
            Logger.log('ℹ️ [PersistentRideNotification] Status de corrida duplicado; mantendo notificação atual.');
            return true;
        }

        this.lastRidePayloadFingerprint = fingerprint;
        this.lastRidePayloadHandledAt = now;
        return false;
    }

    isPersistentRideNotificationAllowed() {
        const policy = runtimeConfigService.getNotificationPolicySync();
        return policy?.enabled !== false && policy?.persistentRideNotificationsEnabled !== false;
    }

    isNativeRideNotificationId(notificationId) {
        return Platform.OS === 'android' && String(notificationId || '') === ANDROID_NATIVE_RIDE_NOTIFICATION_ID;
    }

    async showOrUpdateNativeRideNotification(rideData = {}, title, body, options = {}) {
        const nativeModule = getNativeRideNotificationModule();
        if (!nativeModule) return null;

        try {
            const result = await nativeModule.showOrUpdate({
                channelId: 'ride_status',
                notificationId: ANDROID_NATIVE_RIDE_NOTIFICATION_ID,
                title,
                body,
                bookingId: String(rideData.bookingId || ''),
                status: String(rideData.status || ''),
                userType: String(rideData.userType || ''),
                notificationCategoryId: options.notificationCategoryId || '',
                notificationDataType: options.notificationDataType || 'ride_status',
            });

            if (result?.success === false) {
                Logger.warn('⚠️ [PersistentRideNotification] Módulo nativo recusou atualização:', result?.reason || result);
                return null;
            }

            return result?.notificationId || ANDROID_NATIVE_RIDE_NOTIFICATION_ID;
        } catch (error) {
            Logger.warn('⚠️ [PersistentRideNotification] Falha no módulo nativo Android; usando fallback Expo:', error?.message || error);
            return null;
        }
    }

    async dismissNativeRideNotification() {
        const nativeModule = getNativeRideNotificationModule();
        if (!nativeModule || typeof nativeModule.dismiss !== 'function') return false;

        try {
            await nativeModule.dismiss();
            return true;
        } catch (error) {
            Logger.warn('⚠️ [PersistentRideNotification] Falha ao remover notificação nativa:', error?.message || error);
            return false;
        }
    }

    async dismissNotificationById(notificationId) {
        if (!notificationId) return;
        if (this.isNativeRideNotificationId(notificationId)) {
            await this.dismissNativeRideNotification();
            return;
        }
        await Promise.allSettled([
            Notifications.cancelScheduledNotificationAsync(notificationId),
            typeof Notifications.dismissNotificationAsync === 'function'
                ? Notifications.dismissNotificationAsync(notificationId)
                : Promise.resolve(),
        ]);
    }

    async dismissPresentedRideNotificationsForBooking(bookingId) {
        if (!bookingId || typeof Notifications.getPresentedNotificationsAsync !== 'function') {
            return;
        }

        try {
            const presentedNotifications = await Notifications.getPresentedNotificationsAsync();
            const matchingNotifications = (presentedNotifications || []).filter((notification) => {
                const data =
                    notification?.request?.content?.data ||
                    notification?.content?.data ||
                    {};
                return data?.bookingId === bookingId || (
                    data?.type === 'ride_status' &&
                    this.currentBookingId === bookingId
                );
            });

            await Promise.allSettled(
                matchingNotifications
                    .map((notification) => notification?.identifier)
                    .filter(Boolean)
                    .map((notificationId) => this.dismissNotificationById(notificationId))
            );
        } catch (error) {
            Logger.warn('⚠️ [PersistentRideNotification] Falha ao limpar notificações apresentadas:', error?.message || error);
        }
    }

    async handleRideStatusPayload(data = {}) {
        const processedData = parseRideStatusPayload(data);
        if (!processedData.bookingId || !processedData.status) {
            return;
        }

        await this.hydrateNotificationState();

        const normalizedStatus = String(processedData.status || '').toLowerCase();
        if (normalizedStatus === 'completed' || normalizedStatus === 'cancelled' || normalizedStatus === 'canceled') {
            await this.dismissRideNotification(processedData.bookingId);
            return;
        }

        if (this.shouldSuppressDuplicatePayload(processedData)) {
            return;
        }

        await this.updateRideNotification(processedData);
    }

    /**
     * Mostrar notificação persistente de corrida
     * @param {Object} rideData - Dados da corrida
     * @param {string} rideData.bookingId - ID da corrida
     * @param {string} rideData.status - Status atual (searching, accepted, arrived, started, completed)
     * @param {string} rideData.userType - Tipo de usuário (driver ou customer)
     * @param {Object} rideData.pickup - Local de embarque
     * @param {Object} rideData.destination - Local de destino
     * @param {string} rideData.driverName - Nome do motorista (para customer)
     * @param {string} rideData.customerName - Nome do passageiro (para driver)
     * @param {number} rideData.estimatedTime - Tempo estimado em minutos
     * @param {number} rideData.distance - Distância em km
     * @param {string} rideData.fare - Valor da corrida
     */
    async showRideNotification(rideData) {
        try {
            if (!this.isPersistentRideNotificationAllowed()) {
                Logger.log('ℹ️ [PersistentRideNotification] Notificação persistida desabilitada por runtime policy.');
                await this.dismissRideNotification(rideData?.bookingId);
                return;
            }

            const {
                bookingId,
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare,
                customTitle,
                customBody,
                notificationCategoryId,
                notificationDataType
            } = rideData;

            if (!bookingId || !status) {
                Logger.warn('⚠️ [PersistentRideNotification] Dados incompletos para notificação');
                return;
            }

            this.currentBookingId = bookingId;
            this.isActive = true;
            this.stopPeriodicUpdate();

            // Gerar conteúdo da notificação baseado no status
            const { title, body } = this.generateNotificationContent({
                ...rideData,
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare
            });

            const resolvedTitle = customTitle || title;
            const resolvedBody = customBody || body;
            const nativeNotificationId = await this.showOrUpdateNativeRideNotification(
                { ...rideData, bookingId, status, userType },
                resolvedTitle,
                resolvedBody,
                { notificationCategoryId, notificationDataType }
            );

            if (nativeNotificationId) {
                this.currentNotificationId = nativeNotificationId;
                await this.persistNotificationState();
                Logger.log(`✅ [PersistentRideNotification] Notificação persistente nativa atualizada: ${nativeNotificationId}`);

                if (status === 'started' || status === 'accepted') {
                    this.startPeriodicUpdate(rideData);
                }
                return;
            }

            await this.dismissNotificationById(this.currentNotificationId);
            await this.dismissPresentedRideNotificationsForBooking(bookingId);

            // Criar nova notificação persistente
            const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                    title: resolvedTitle,
                    body: resolvedBody,
                    data: {
                        type: notificationDataType || 'ride_status',
                        bookingId,
                        status,
                        userType,
                        ...rideData
                    },
                    sound: false, // Sem som para atualizações
                    priority: Notifications.AndroidNotificationPriority.HIGH,
                    categoryIdentifier: notificationCategoryId || undefined,
                    sticky: Platform.OS === 'android',
                    autoDismiss: Platform.OS === 'android' ? false : undefined,
                },
                trigger: Platform.OS === 'android' ? { channelId: 'ride_status' } : null,
            });

            this.currentNotificationId = notificationId;
            await this.persistNotificationState();
            Logger.log(`✅ [PersistentRideNotification] Notificação persistente criada: ${notificationId}`);

            // Iniciar atualização periódica se necessário
            if (status === 'started' || status === 'accepted') {
                this.startPeriodicUpdate(rideData);
            }

        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao mostrar notificação:', error);
        }
    }

    /**
     * Atualizar notificação existente
     */
    async updateRideNotification(rideData) {
        try {
            if (!this.isPersistentRideNotificationAllowed()) {
                Logger.log('ℹ️ [PersistentRideNotification] Atualização persistida bloqueada por runtime policy.');
                await this.dismissRideNotification(rideData?.bookingId);
                return;
            }

            await this.hydrateNotificationState();
            if (!this.isActive || !this.currentNotificationId) {
                // Se não há notificação ativa, criar uma nova
                await this.showRideNotification(rideData);
                return;
            }

            // Atualizar usando o mesmo ID
            const {
                bookingId,
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare,
                customTitle,
                customBody,
                notificationCategoryId,
                notificationDataType
            } = rideData;

            const { title, body } = this.generateNotificationContent({
                ...rideData,
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare
            });

            const resolvedTitle = customTitle || title;
            const resolvedBody = customBody || body;
            const nativeNotificationId = await this.showOrUpdateNativeRideNotification(
                { ...rideData, bookingId, status, userType },
                resolvedTitle,
                resolvedBody,
                { notificationCategoryId, notificationDataType }
            );

            if (nativeNotificationId) {
                this.currentNotificationId = nativeNotificationId;
                this.currentBookingId = bookingId;
                this.isActive = true;
                await this.persistNotificationState();
                Logger.log(`🔄 [PersistentRideNotification] Notificação nativa atualizada no mesmo slot: ${nativeNotificationId}`);

                if (status === 'started' || status === 'accepted') {
                    this.startPeriodicUpdate(rideData);
                } else {
                    this.stopPeriodicUpdate();
                }
                return;
            }

            await this.dismissNotificationById(this.currentNotificationId);
            await this.dismissPresentedRideNotificationsForBooking(bookingId);

            const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                    title: resolvedTitle,
                    body: resolvedBody,
                    data: {
                        type: notificationDataType || 'ride_status',
                        bookingId,
                        status,
                        userType,
                        ...rideData
                    },
                    sound: false,
                    priority: Notifications.AndroidNotificationPriority.HIGH,
                    categoryIdentifier: notificationCategoryId || undefined,
                    sticky: Platform.OS === 'android',
                    autoDismiss: Platform.OS === 'android' ? false : undefined,
                },
                trigger: Platform.OS === 'android' ? { channelId: 'ride_status' } : null,
            });

            this.currentNotificationId = notificationId;
            this.currentBookingId = bookingId;
            this.isActive = true;
            await this.persistNotificationState();
            Logger.log(`🔄 [PersistentRideNotification] Notificação atualizada: ${notificationId}`);

            if (status === 'started' || status === 'accepted') {
                this.startPeriodicUpdate(rideData);
            } else {
                this.stopPeriodicUpdate();
            }

        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao atualizar notificação:', error);
        }
    }

    /**
     * Gerar conteúdo da notificação baseado no status
     */
    generateNotificationContent(rideData = {}) {
        const {
            status,
            userType,
            pickup,
            destination,
            driverName,
            customerName,
            estimatedTime,
            distance,
            fare
        } = rideData;
        let title = '';
        let body = '';
        const statusKey = String(status || '').toLowerCase();
        const timeline = buildTimelineDetails(rideData);
        const pickupAddress = getLocationAddress(pickup, 'local de embarque');
        const destinationAddress = getLocationAddress(destination, 'destino');
        const tripDurationLabel = formatMinutes(getTripDurationMinutes(rideData));
        const etaLabel = timeline.remainingLabel || formatMinutes(estimatedTime);
        const distanceLabel = distance ? `${distance} km` : null;

        if (userType === 'driver') {
            // Notificação para motorista
            switch (statusKey) {
                case 'searching':
                    title = 'Procurando corridas';
                    body = 'Aguardando solicitações de corrida';
                    break;
                case 'accepted':
                    title = `Busque ${customerName || 'o passageiro'}`;
                    body = compactLines(
                        etaLabel ? `Chegada ao embarque em ${etaLabel}` : 'Siga até o local de embarque',
                        timeline.progressLine,
                        `Partida: ${pickupAddress}`,
                        distanceLabel ? `Distância: ${distanceLabel}` : null
                    );
                    break;
                case 'arrived':
                    title = 'Chegada registrada';
                    body = compactLines(
                        `Aguardando ${customerName || 'passageiro'} para iniciar a viagem`,
                        `Embarque: ${pickupAddress}`
                    );
                    break;
                case 'started':
                    title = `A caminho de ${destinationAddress}`;
                    body = compactLines(
                        etaLabel ? `Chegada prevista em ${etaLabel}` : 'Viagem em andamento',
                        timeline.progressLine,
                        tripDurationLabel ? `Tempo estimado da viagem: ${tripDurationLabel}` : null,
                        customerName ? `Passageiro: ${customerName}` : null
                    );
                    break;
                case 'completed':
                    title = 'Corrida finalizada';
                    body = `Ganho: ${fare || 'R$ 0,00'}`;
                    break;
                default:
                    title = 'Corrida ativa';
                    body = 'Acompanhe o status da corrida';
            }
        } else {
            // Notificação para passageiro
            switch (statusKey) {
                case 'searching':
                    title = 'Procurando motorista';
                    body = 'Aguardando motorista disponível';
                    break;
                case 'accepted':
                    title = `${driverName || 'Motorista'} está a caminho`;
                    body = compactLines(
                        etaLabel ? `Chegada ao embarque em ${etaLabel}` : 'Acompanhe a chegada pelo app',
                        timeline.progressLine,
                        `Embarque: ${pickupAddress}`,
                        tripDurationLabel ? `Viagem estimada: ${tripDurationLabel}` : null
                    );
                    break;
                case 'arrived':
                    title = `${driverName || 'Motorista'} chegou`;
                    body = compactLines(
                        'Prossiga para o embarque',
                        `Local: ${pickupAddress}`
                    );
                    break;
                case 'started':
                    title = `A caminho de ${destinationAddress}`;
                    body = compactLines(
                        etaLabel ? `Chegada prevista em ${etaLabel}` : 'Viagem em andamento',
                        timeline.progressLine,
                        tripDurationLabel ? `Tempo estimado da viagem: ${tripDurationLabel}` : null,
                        driverName ? `Motorista: ${driverName}` : null
                    );
                    break;
                case 'completed':
                    title = 'Viagem finalizada';
                    body = `Valor: ${fare || 'R$ 0,00'}`;
                    break;
                default:
                    title = 'Corrida ativa';
                    body = 'Acompanhe o status da corrida';
            }
        }

        return { title, body };
    }

    /**
     * Iniciar atualização periódica da notificação
     */
    startPeriodicUpdate(rideData) {
        // Limpar intervalo anterior se existir
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        // Atualizar localmente durante a corrida; não dispara chamada externa.
        this.updateInterval = setInterval(async () => {
            if (!this.isActive) {
                this.stopPeriodicUpdate();
                return;
            }

            await this.updateRideNotification(rideData);
        }, RIDE_NOTIFICATION_UPDATE_INTERVAL_MS);

        Logger.log('🔄 [PersistentRideNotification] Atualização periódica iniciada');
    }

    /**
     * Parar atualização periódica
     */
    stopPeriodicUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            Logger.log('⏹️ [PersistentRideNotification] Atualização periódica parada');
        }
    }

    /**
     * Remover notificação persistente
     */
    async dismissRideNotification(bookingId = null) {
        try {
            await this.hydrateNotificationState();
            const targetBookingId = bookingId || this.currentBookingId;
            if (this.currentNotificationId) {
                await this.dismissNotificationById(this.currentNotificationId);
            }
            await this.dismissPresentedRideNotificationsForBooking(targetBookingId);
            this.currentNotificationId = null;
            this.currentBookingId = null;
            this.isActive = false;
            this.lastRidePayloadFingerprint = null;
            this.lastRidePayloadHandledAt = 0;
            this.stopPeriodicUpdate();
            await this.clearNotificationState();
            Logger.log('✅ [PersistentRideNotification] Notificação removida');
        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao remover notificação:', error);
        }
    }

    /**
     * Verificar se há notificação ativa
     */
    isNotificationActive() {
        return this.isActive && this.currentNotificationId !== null;
    }

    /**
     * Obter ID da notificação atual
     */
    getCurrentNotificationId() {
        return this.currentNotificationId;
    }

    /**
     * Obter ID da corrida atual
     */
    getCurrentBookingId() {
        return this.currentBookingId;
    }
}

// Exportar instância singleton
const persistentRideNotificationService = new PersistentRideNotificationService();
export default persistentRideNotificationService;
