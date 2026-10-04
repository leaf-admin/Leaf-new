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

export function formatTripDateLabel(value) {
  const raw = value?.toDate ? value.toDate() : value?.seconds ? value.seconds * 1000 : typeof value === 'number' && value < 1000000000000 ? value * 1000 : value;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return typeof value === 'string' && value.trim() ? value : 'Data indisponível';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
