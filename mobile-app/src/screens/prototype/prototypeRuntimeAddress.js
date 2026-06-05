export function normalizeRuntimeAddressText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRuntimeAddressCompareText(value = "") {
  return normalizeRuntimeAddressText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isGenericRuntimeAddress(value = "") {
  const normalized = normalizeRuntimeAddressCompareText(value);
  return (
    !normalized ||
    normalized === "local atual" ||
    normalized === "minha localizacao" ||
    normalized === "sua localizacao atual" ||
    normalized === "localizacao atual" ||
    normalized === "origem atual"
  );
}
