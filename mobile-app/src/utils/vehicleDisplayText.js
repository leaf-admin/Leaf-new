// Registry data arrives in caps ("VW NOVA SAVEIRO RB MBVS"); show it the way
// ride apps do ("VW Nova Saveiro"): title case, short brand codes kept, trim codes dropped.
export function formatVehicleDisplayText(value, { maxWords = 3 } = {}) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words
    .map((word) => {
      if (word !== word.toUpperCase() || /\d/.test(word)) return word;
      if (word.length <= 3 && /^[A-ZÀ-Ý]+$/.test(word) && words.length > 1 && word === words[0]) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ');
}
