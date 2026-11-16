import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import apiClient from '../../../services/httpClient';
import { showLeafChoiceSheet } from '../../../components/design-system/LeafChoiceSheet';

// Corrida com repasse em conferência: o backend pergunta ao passageiro se ele fez a corrida.
// Uma pergunta por vez, só na home do passageiro e fora de uma corrida ativa. Sem resposta, o
// backend libera o valor do motorista sozinho em 24 h; por isso fechar o aviso não faz nada.

const MIN_CHECK_GAP_MS = 60 * 1000;

function routeLabel(item = {}) {
  const pickup = String(item.pickupAddress || '').split(',')[0].trim();
  const destination = String(item.destinationAddress || '').split(',')[0].trim();
  if (pickup && destination) return `${pickup} → ${destination}`;
  return destination || pickup || '';
}

function timeLabel(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function buildRideConfirmationMessage(item = {}) {
  const route = routeLabel(item);
  const time = timeLabel(item.completedAt);
  const details = [route, time ? `encerrada às ${time}` : ''].filter(Boolean).join(', ');
  return details
    ? `Queremos confirmar a corrida ${details}. Você estava no carro?`
    : 'Queremos confirmar sua última corrida. Você estava no carro?';
}

export async function checkPendingRideConfirmations({ ask = showLeafChoiceSheet, client = apiClient } = {}) {
  const response = await client.get('/api/rides/confirmations/pending');
  const pending = Array.isArray(response?.data?.pending) ? response.data.pending : [];
  const item = pending[0];
  if (!item?.bookingId) return null;

  const key = await ask({
    title: 'Você fez esta corrida?',
    message: buildRideConfirmationMessage(item),
    options: [
      { key: 'took_ride', label: 'Sim, fiz a corrida' },
      { key: 'did_not_take_ride', label: 'Não fiz essa corrida', tone: 'secondary' },
    ],
    dismissible: true,
  });
  if (key !== 'took_ride' && key !== 'did_not_take_ride') return null;

  await client.post(`/api/rides/${encodeURIComponent(item.bookingId)}/confirmation`, {
    tookRide: key === 'took_ride',
  });
  return { bookingId: item.bookingId, answer: key };
}

export function usePassengerRideConfirmation({ enabled }) {
  const lastCheckAtRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const run = () => {
      const now = Date.now();
      if (cancelled || inFlightRef.current || now - lastCheckAtRef.current < MIN_CHECK_GAP_MS) return;
      inFlightRef.current = true;
      lastCheckAtRef.current = now;
      checkPendingRideConfirmations()
        .catch(() => null)
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, [enabled]);
}
