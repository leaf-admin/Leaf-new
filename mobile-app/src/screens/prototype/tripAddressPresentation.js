// Presentation only: accepts the location shapes already returned by Leaf.
// No geocoding, provider request, or alteration of the stored trip.

export function resolveTripAddressLabel(...candidates) {
  const text = (value, depth = 0) => {
    if (typeof value === 'string') {
      const label = value.replace(/&#(?:47|x2f);/gi, '/').trim();
      return label && label !== '[object Object]' ? label : '';
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth >= 3) return '';
    for (const key of ['add', 'address', 'formattedAddress', 'label', 'name']) {
      const label = text(value[key], depth + 1);
      if (label) return label;
    }
    return '';
  };
  for (const candidate of candidates) {
    const label = text(candidate);
    if (label) return label;
  }
  return '';
}

// "Av. Atlântica, 1702 - Copacabana, Rio de Janeiro - RJ, Brasil" ->
// "Av. Atlântica, 1702 - Copacabana": keep street/number/neighbourhood only.
export function shortTripAddressLabel(value) {
  const label = String(value || '').trim();
  const parts = label.split(', ');
  if (parts.length < 2) return label;
  const kept = [];
  for (const part of parts) {
    kept.push(part);
    if (part.includes(' - ')) break;
  }
  return (kept.length === parts.length && !kept.some(part => part.includes(' - ')) ? parts.slice(0, 2) : kept).join(', ');
}

export function formatTripDateLabel(value, { compact = false } = {}) {
  const raw = value?.toDate ? value.toDate() : value?.seconds ? value.seconds * 1000 : typeof value === 'number' && value < 1000000000000 ? value * 1000 : value;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return typeof value === 'string' && value.trim() ? value : 'Data indisponível';
  // Compact (lists): omit the year for trips from the current year.
  const sameYear = compact && date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}
