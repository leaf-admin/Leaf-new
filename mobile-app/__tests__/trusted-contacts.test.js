import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addTrustedContact,
  buildTrustedContactMessage,
  buildWhatsAppUrl,
  formatBrazilPhone,
  loadTrustedContacts,
  normalizeBrazilPhone,
  removeTrustedContact,
} from '../src/services/trustedContactsStore';
import {
  isNightHour,
  offerNightTripShare,
  resetNightTripShareReminderForTests,
} from '../src/screens/prototype/home/nightTripShareReminder';

jest.mock('../src/components/design-system/LeafChoiceSheet', () => ({ showLeafChoiceSheet: jest.fn() }));
jest.mock('../src/services/tripShareLinkService', () => ({ requestTripShareLink: jest.fn() }));

describe('trusted contacts store', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('normalizes Brazilian mobile numbers and rejects the rest', () => {
    expect(normalizeBrazilPhone('(21) 98888-7777')).toBe('5521988887777');
    expect(normalizeBrazilPhone('+55 21 98888-7777')).toBe('5521988887777');
    expect(normalizeBrazilPhone('2133334444')).toBe('552133334444');
    expect(normalizeBrazilPhone('98888-7777')).toBeNull();
    expect(normalizeBrazilPhone('021988887777')).toBeNull();
    expect(formatBrazilPhone('5521988887777')).toBe('(21) 98888-7777');
  });

  it('keeps up to 3 contacts on the device, without duplicates', async () => {
    expect((await addTrustedContact({ name: 'Ana', phone: '21988887777' })).ok).toBe(true);
    expect(await addTrustedContact({ name: 'Ana de novo', phone: '(21) 98888-7777' })).toEqual({
      ok: false, error: 'Esse número já está na sua lista.',
    });
    expect((await addTrustedContact({ name: '', phone: '21977776666' })).ok).toBe(false);
    await addTrustedContact({ name: 'Bia', phone: '21977776666' });
    await addTrustedContact({ name: 'Caio', phone: '21966665555' });
    const fourth = await addTrustedContact({ name: 'Duda', phone: '21955554444' });
    expect(fourth.ok).toBe(false);
    expect((await loadTrustedContacts()).map((contact) => contact.name)).toEqual(['Ana', 'Bia', 'Caio']);

    await removeTrustedContact('5521977776666');
    expect((await loadTrustedContacts()).map((contact) => contact.name)).toEqual(['Ana', 'Caio']);
  });

  it('survives a corrupted storage value', async () => {
    await AsyncStorage.setItem('@leaf/trusted_contacts/v1', '{not json');
    await expect(loadTrustedContacts()).resolves.toEqual([]);
  });

  it('builds a WhatsApp link with the trip link in the message', () => {
    const message = buildTrustedContactMessage({ contactName: 'Ana Paula', shareUrl: 'https://leaf.app.br/viagem/t', destination: 'Ipanema' });
    expect(message).toBe('Oi, Ana! Estou numa viagem Leaf indo para Ipanema. Você pode acompanhar o carro em tempo real por este link: https://leaf.app.br/viagem/t');
    expect(buildWhatsAppUrl({ phone: '5521988887777', message: 'a b' })).toBe('https://wa.me/5521988887777?text=a%20b');
  });
});

describe('night trip share reminder', () => {
  const contacts = [{ name: 'Ana Paula', phone: '5521988887777' }];
  const night = new Date(2026, 10, 16, 23, 10);
  const day = new Date(2026, 10, 16, 15, 0);

  beforeEach(() => resetNightTripShareReminderForTests());

  it('only counts 21h to 6h as night', () => {
    expect(isNightHour(night)).toBe(true);
    expect(isNightHour(new Date(2026, 10, 17, 5, 59))).toBe(true);
    expect(isNightHour(new Date(2026, 10, 17, 6, 0))).toBe(false);
    expect(isNightHour(day)).toBe(false);
  });

  it('does not ask during the day or without contacts', async () => {
    const ask = jest.fn();
    await offerNightTripShare({ bookingId: 'b1', now: day, ask, loadContacts: async () => contacts });
    await offerNightTripShare({ bookingId: 'b2', now: night, ask, loadContacts: async () => [] });
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks once per ride and opens WhatsApp for the chosen contact', async () => {
    const ask = jest.fn().mockResolvedValue('5521988887777');
    const openUrl = jest.fn();
    const requestLink = jest.fn().mockResolvedValue({ ok: true, url: 'https://leaf.app.br/viagem/t' });

    const result = await offerNightTripShare({
      bookingId: 'b1', destination: 'Leblon', now: night, ask, openUrl, requestLink, loadContacts: async () => contacts,
    });
    expect(result).toEqual({ sent: true, phone: '5521988887777' });
    expect(ask.mock.calls[0][0].options.map((option) => option.label)).toEqual(['Enviar para Ana', 'Agora não']);
    expect(openUrl.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/5521988887777\?text=/);

    await offerNightTripShare({ bookingId: 'b1', now: night, ask, openUrl, requestLink, loadContacts: async () => contacts });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on "Agora não"', async () => {
    const openUrl = jest.fn();
    await offerNightTripShare({
      bookingId: 'b3', now: night, ask: async () => 'skip', openUrl, requestLink: jest.fn(), loadContacts: async () => contacts,
    });
    expect(openUrl).not.toHaveBeenCalled();
  });
});
