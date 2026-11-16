import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { showLeafChoiceSheet } from '../../../components/design-system/LeafChoiceSheet';
import { requestTripShareLink } from '../../../services/tripShareLinkService';
import {
  buildTrustedContactMessage,
  buildWhatsAppUrl,
  loadTrustedContacts,
} from '../../../services/trustedContactsStore';

// À noite, quando a viagem começa e o passageiro tem contatos de confiança salvos, o app
// oferece mandar o link para um deles. Quem envia é sempre o passageiro, pelo próprio WhatsApp;
// "Agora não" não pergunta de novo nesta corrida.

const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;
const askedBookings = new Set();

export function isNightHour(date = new Date()) {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

export async function offerNightTripShare({
  bookingId,
  destination,
  now = new Date(),
  ask = showLeafChoiceSheet,
  loadContacts = loadTrustedContacts,
  requestLink = requestTripShareLink,
  openUrl = (url) => Linking.openURL(url),
} = {}) {
  const id = String(bookingId || '').trim();
  if (!id || askedBookings.has(id) || !isNightHour(now)) return null;
  const contacts = await loadContacts();
  if (contacts.length === 0) return null;
  askedBookings.add(id);

  const key = await ask({
    title: 'Avisar alguém da sua viagem?',
    message: 'Mande o link para alguém acompanhar o carro até você chegar. Quem envia é você, pelo WhatsApp.',
    options: [
      ...contacts.map((contact) => ({ key: contact.phone, label: `Enviar para ${contact.name.split(' ')[0]}` })),
      { key: 'skip', label: 'Agora não', tone: 'secondary' },
    ],
    dismissible: true,
  });
  const contact = contacts.find((item) => item.phone === key);
  if (!contact) return null;

  const link = await requestLink(id);
  if (!link.ok) return { sent: false, code: link.code };
  const message = buildTrustedContactMessage({ contactName: contact.name, shareUrl: link.url, destination });
  await openUrl(buildWhatsAppUrl({ phone: contact.phone, message }));
  return { sent: true, phone: contact.phone };
}

export function resetNightTripShareReminderForTests() {
  askedBookings.clear();
}

export function useNightTripShareReminder({ bookingId, bookingStatus, destination }) {
  const destinationRef = useRef(destination);
  destinationRef.current = destination;

  useEffect(() => {
    const status = String(bookingStatus || '').trim().toLowerCase();
    if (!bookingId || (status !== 'started' && status !== 'in_progress')) return;
    offerNightTripShare({ bookingId, destination: destinationRef.current }).catch(() => null);
  }, [bookingId, bookingStatus]);
}
