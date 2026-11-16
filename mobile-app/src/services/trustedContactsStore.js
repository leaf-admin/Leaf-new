import AsyncStorage from '@react-native-async-storage/async-storage';

// Contatos de confiança do passageiro: até 3 pessoas para quem ele manda o link da viagem com
// um toque, pelo próprio WhatsApp. Ficam só neste aparelho (telefone de terceiro não vai para o
// servidor da Leaf) e quem envia é sempre o passageiro.

const STORAGE_KEY = '@leaf/trusted_contacts/v1';
export const MAX_TRUSTED_CONTACTS = 3;

// Celular brasileiro com DDD: 10 ou 11 dígitos, com ou sem 55 na frente.
export function normalizeBrazilPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (digits.startsWith('0')) return null;
  return `55${digits}`;
}

export function formatBrazilPhone(e164) {
  const digits = String(e164 || '').replace(/\D/g, '').replace(/^55/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const phone = normalizeBrazilPhone(item?.phone);
    const name = String(item?.name || '').trim().slice(0, 40);
    if (!phone || !name || seen.has(phone)) continue;
    seen.add(phone);
    result.push({ name, phone });
    if (result.length >= MAX_TRUSTED_CONTACTS) break;
  }
  return result;
}

export async function loadTrustedContacts(storage = AsyncStorage) {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : []);
  } catch (_error) {
    return [];
  }
}

async function save(list, storage) {
  const clean = sanitize(list);
  await storage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

/** Adiciona um contato. Erros com motivo legível: telefone inválido, nome vazio, limite. */
export async function addTrustedContact({ name, phone }, storage = AsyncStorage) {
  const current = await loadTrustedContacts(storage);
  const normalizedPhone = normalizeBrazilPhone(phone);
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return { ok: false, error: 'Digite o nome do contato.' };
  if (!normalizedPhone) return { ok: false, error: 'Digite um celular com DDD, por exemplo (21) 99999-9999.' };
  if (current.some((contact) => contact.phone === normalizedPhone)) {
    return { ok: false, error: 'Esse número já está na sua lista.' };
  }
  if (current.length >= MAX_TRUSTED_CONTACTS) {
    return { ok: false, error: `Você pode ter até ${MAX_TRUSTED_CONTACTS} contatos de confiança.` };
  }
  const contacts = await save([...current, { name: trimmedName, phone: normalizedPhone }], storage);
  return { ok: true, contacts };
}

export async function removeTrustedContact(phone, storage = AsyncStorage) {
  const current = await loadTrustedContacts(storage);
  return save(current.filter((contact) => contact.phone !== phone), storage);
}

export function buildTrustedContactMessage({ contactName, shareUrl, destination }) {
  const greeting = contactName ? `Oi, ${String(contactName).split(' ')[0]}! ` : '';
  const destinationLine = destination ? ` indo para ${destination}` : '';
  return `${greeting}Estou numa viagem Leaf${destinationLine}. Você pode acompanhar o carro em tempo real por este link: ${shareUrl}`;
}

// wa.me abre a conversa com o número mesmo sem ele estar salvo na agenda.
export function buildWhatsAppUrl({ phone, message }) {
  return `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}
