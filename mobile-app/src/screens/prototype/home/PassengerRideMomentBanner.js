import React, { useCallback, useEffect, useRef, useState } from 'react';
import LeafActionBanner from '../../../components/design-system/LeafActionBanner';

// Banner com ação no passageiro (estudo 5.3): um aviso por momento da corrida, uma vez
// por corrida. Informação e sucesso somem em 5 s; ação necessária fica até a pessoa agir.
export const PASSENGER_MOMENT_AUTO_HIDE_MS = 5000;
export const PASSENGER_ON_MY_WAY_MESSAGE = 'Estou indo';

const shownMoments = new Set();

export function resetPassengerRideMomentMemory() {
  shownMoments.clear();
}

export function resolvePassengerRideMoment(status, context = {}) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'accepted') {
    const vehicle = [context.vehicleModel, context.vehiclePlate].filter(Boolean).join(' · ');
    return {
      tone: 'success',
      icon: 'car-outline',
      title: 'Motorista a caminho',
      message: [context.driverName, vehicle].filter(Boolean).join(' · ') || null,
    };
  }
  if (normalized === 'arrived') {
    return {
      tone: 'action',
      icon: 'location-outline',
      title: 'Motorista chegou',
      message: 'Ele espera 2 min no embarque',
      actionLabel: PASSENGER_ON_MY_WAY_MESSAGE,
      sticky: true,
    };
  }
  if (normalized === 'started') {
    return {
      tone: 'info',
      icon: 'navigate-outline',
      title: 'Viagem iniciada',
      message: context.arrivalText || null,
    };
  }
  return null;
}

export default function PassengerRideMomentBanner({
  bookingId,
  status,
  driverName,
  vehicleModel,
  vehiclePlate,
  arrivalText,
  top = 0,
  onOnMyWay,
}) {
  const [moment, setMoment] = useState(null);
  const contextRef = useRef({});
  contextRef.current = { driverName, vehicleModel, vehiclePlate, arrivalText };
  const rideKey = String(bookingId || '').trim();
  const normalizedStatus = String(status || '').trim().toLowerCase();

  useEffect(() => {
    if (!rideKey) {
      setMoment(null);
      return;
    }
    const next = resolvePassengerRideMoment(normalizedStatus, contextRef.current);
    const momentKey = `${rideKey}:${normalizedStatus}`;
    if (!next || shownMoments.has(momentKey)) {
      // The moment that was on screen belongs to a status the ride already left.
      setMoment((current) => (current && current.key !== momentKey ? null : current));
      return;
    }
    shownMoments.add(momentKey);
    setMoment({ ...next, key: momentKey });
  }, [normalizedStatus, rideKey]);

  useEffect(() => {
    if (!moment || moment.sticky) {
      return undefined;
    }
    const timer = setTimeout(() => setMoment(null), PASSENGER_MOMENT_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [moment]);

  const handleOnMyWay = useCallback(async () => {
    setMoment(null);
    try {
      await onOnMyWay?.();
      setMoment({
        key: `${rideKey}:on-my-way`,
        tone: 'success',
        icon: 'checkmark',
        title: 'Avisamos o motorista',
        message: 'Ele sabe que você está indo',
      });
    } catch (_error) {
      setMoment({
        key: `${rideKey}:on-my-way-failed`,
        tone: 'warning',
        title: 'Não deu para avisar',
        message: 'Use o chat do card para falar com ele',
      });
    }
  }, [onOnMyWay, rideKey]);

  if (!moment) {
    return null;
  }

  return (
    <LeafActionBanner
      key={moment.key}
      tone={moment.tone}
      icon={moment.icon}
      top={top}
      title={moment.title}
      message={moment.message}
      actionLabel={moment.actionLabel}
      onAction={moment.actionLabel && onOnMyWay ? handleOnMyWay : undefined}
      onPress={() => setMoment(null)}
      testID="passenger-ride-moment-banner"
    />
  );
}
