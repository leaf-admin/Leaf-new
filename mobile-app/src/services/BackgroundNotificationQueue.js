import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKGROUND_NOTIFICATIONS_STORAGE_KEY = 'backgroundNotifications';
export const MAX_BACKGROUND_NOTIFICATIONS = 50;

const safeStringify = (value) => {
    try {
        return JSON.stringify(value || {});
    } catch (error) {
        return '';
    }
};

export const getBackgroundNotificationKey = (remoteMessage = {}) => {
    const data = remoteMessage.data || {};
    const notification = remoteMessage.notification || {};

    return (
        remoteMessage.messageId ||
        remoteMessage.message_id ||
        data.messageId ||
        data.message_id ||
        data.notificationId ||
        data.notification_id ||
        data.id ||
        [
            data.type || 'general',
            data.tripId || data.bookingId || data.rideId || '',
            remoteMessage.sentTime || data.timestamp || '',
            notification.title || '',
            notification.body || '',
            safeStringify(data)
        ].join(':')
    );
};

export const getBackgroundNotifications = async () => {
    const notifications = await AsyncStorage.getItem(BACKGROUND_NOTIFICATIONS_STORAGE_KEY);
    if (!notifications) {
        return [];
    }

    try {
        const parsed = JSON.parse(notifications);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        await AsyncStorage.removeItem(BACKGROUND_NOTIFICATIONS_STORAGE_KEY);
        return [];
    }
};

export const saveBackgroundNotification = async (remoteMessage, { logger } = {}) => {
    const notifications = await getBackgroundNotifications();
    const backgroundQueueKey = getBackgroundNotificationKey(remoteMessage);
    const alreadyQueued = notifications.some((notification) => (
        notification.backgroundQueueKey === backgroundQueueKey ||
        getBackgroundNotificationKey(notification) === backgroundQueueKey
    ));

    if (alreadyQueued) {
        logger?.log?.('ℹ️ Notificação de background já estava na fila; ignorando duplicidade.');
        return { saved: false, notifications };
    }

    notifications.push({
        ...remoteMessage,
        backgroundQueueKey,
        timestamp: new Date().toISOString(),
        processed: false
    });

    if (notifications.length > MAX_BACKGROUND_NOTIFICATIONS) {
        notifications.splice(0, notifications.length - MAX_BACKGROUND_NOTIFICATIONS);
    }

    await AsyncStorage.setItem(BACKGROUND_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
    return { saved: true, notifications };
};

export const persistBackgroundNotifications = async (notifications) => {
    const safeNotifications = Array.isArray(notifications) ? notifications : [];
    await AsyncStorage.setItem(
        BACKGROUND_NOTIFICATIONS_STORAGE_KEY,
        JSON.stringify(safeNotifications.slice(-MAX_BACKGROUND_NOTIFICATIONS))
    );
};
