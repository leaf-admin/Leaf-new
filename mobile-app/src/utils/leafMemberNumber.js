// Número de membro exibido no cartão Leaf: 12 dígitos estáveis derivados do uid
// (11 do hash FNV-1a + 1 dígito verificador Luhn). Não é segredo nem credencial.
// Antes de usar para validar cadastro ou benefícios, o backend deve calcular e
// guardar o mesmo valor; o app só exibe.

function fnv1a32(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function luhnCheckDigit(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let value = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 0) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return String((10 - (sum % 10)) % 10);
}

export function resolveLeafMemberNumber(uid) {
  const text = String(uid || '').trim();
  if (!text) return '';
  const high = fnv1a32(text, 0x811c9dc5) % 100000;
  const low = fnv1a32(text, 0x050c5d1f) % 1000000;
  const body = `${String(high).padStart(5, '0')}${String(low).padStart(6, '0')}`;
  return `${body}${luhnCheckDigit(body)}`;
}

export function isValidLeafMemberNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && luhnCheckDigit(digits.slice(0, 11)) === digits[11];
}

export function formatLeafMemberNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}
