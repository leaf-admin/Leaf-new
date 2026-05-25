export function normalizeMeaningfulAddress(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  const lowered = normalized.toLowerCase();
  if (
    lowered === "sua localização atual" ||
    lowered === "origem atual" ||
    lowered === "destino"
  ) {
    return "";
  }

  return normalized;
}

export function resolveMeaningfulAddress(...values) {
  for (const value of values) {
    const normalized = normalizeMeaningfulAddress(value);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}
