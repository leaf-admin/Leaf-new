import messaging from '@react-native-firebase/messaging';
import Logger from '../utils/Logger';
import { saveBackgroundNotification } from './BackgroundNotificationQueue';
import rideOverlay, { buildOfferCardState } from './LeafRideOverlay';

// Oferta com o Leaf em segundo plano: o socket pode não entregar a oferta ao estado do app
// (visto no QA de 2026-10-22), então o card por cima do Waze/Maps sai direto do push.
export function buildOfferCardFromPush(data = {}, fallbackText = '') {
    const net = Number(data.netAmount);
    const tripKm = Number(data.tripKm);
    const tripMin = Number(data.tripMinutes);
    const pickupMinutes = Number(data.pickupMinutes);
    const toll = Number(data.tollFee);
    const money = (value) => `R$ ${value.toFixed(2).replace('.', ',')}`;
    // Pedágio é repasse, não ganho: fora do R$/km (igual ao card do app).
    const earned = net - (toll > 0 ? toll : 0);
    const perKm = earned > 0 && tripKm >= 0.5 ? earned / tripKm : NaN;
    const expiresAtMs = Date.parse(data.expiresAt) || 0;
    const issuedMs = Date.parse(data.timestamp) || 0;
    const state = buildOfferCardState({
        bookingId: data.bookingId,
        fareLabel: net > 0 ? money(net) : '',
        pickupEtaLabel: pickupMinutes > 0 ? `${Math.round(pickupMinutes)} min` : '',
        distanceLabel: tripKm > 0 ? `${tripKm.toFixed(1).replace('.', ',')} km` : '',
        durationLabel: tripMin > 0 ? `${Math.round(tripMin)} min` : '',
        perKmLabel: Number.isFinite(perKm) ? `${money(perKm)}/km` : '',
        tollLabel: toll > 0 ? `Inclui ${money(toll)} de pedágio` : '',
        pickupLabel: String(data.pickup || ''),
        dropoffLabel: String(data.dropoff || ''),
        expiresAtMs,
        totalMs: expiresAtMs > issuedMs && issuedMs > 0 ? expiresAtMs - issuedMs : 20000,
    });
    // Push de servidor antigo (sem os campos acima): usa o texto da notificação.
    if (!state.fareLabel && !state.tripLine && fallbackText) state.tripLine = String(fallbackText);
    return state;
}

let hasRegisteredBackgroundMessageHandler = false;

export const registerFCMBackgroundMessageHandler = () => {
    if (hasRegisteredBackgroundMessageHandler) {
        return false;
    }

    try {
        messaging().setBackgroundMessageHandler(async (remoteMessage) => {
            try {
                Logger.log('📱 Mensagem recebida em background:', remoteMessage);
                const data = remoteMessage?.data || {};
                if (data.type === 'ride_offer' && data.bookingId && (Date.parse(data.expiresAt) || 0) > Date.now()) {
                    rideOverlay.showOffer(buildOfferCardFromPush(data, remoteMessage?.notification?.body)).catch(() => {});
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
