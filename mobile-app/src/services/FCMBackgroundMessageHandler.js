import messaging from '@react-native-firebase/messaging';
import Logger from '../utils/Logger';
import { saveBackgroundNotification } from './BackgroundNotificationQueue';

let hasRegisteredBackgroundMessageHandler = false;

export const registerFCMBackgroundMessageHandler = () => {
    if (hasRegisteredBackgroundMessageHandler) {
        return false;
    }

    try {
        messaging().setBackgroundMessageHandler(async (remoteMessage) => {
            try {
                Logger.log('📱 Mensagem recebida em background:', remoteMessage);
                if (remoteMessage?.data?.type === 'ride_status_update') {
                    const PersistentRideNotificationService = require('./PersistentRideNotificationService').default;
                    await PersistentRideNotificationService.handleRideStatusPayload(remoteMessage.data);
                    return;
                }
                await saveBackgroundNotification(remoteMessage, { logger: Logger });
            } catch (error) {
                Logger.error('❌ Erro ao salvar mensagem FCM em background:', error);
            }
        });
    } catch (error) {
        Logger.warn?.('⚠️ Handler FCM background indisponível:', error?.message || error);
        return false;
    }

    hasRegisteredBackgroundMessageHandler = true;
    return true;
};

export const resetFCMBackgroundMessageHandlerForTests = () => {
    if (__DEV__) {
        hasRegisteredBackgroundMessageHandler = false;
    }
};

export default registerFCMBackgroundMessageHandler;
