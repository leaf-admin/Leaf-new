export const LEAF_ACTIVE_CITIES = [
  { value: 'rio-de-janeiro-rj', label: 'Rio de Janeiro - RJ' },
  { value: 'niteroi-rj', label: 'Niterói - RJ' },
  { value: 'sao-paulo-sp', label: 'São Paulo - SP' },
  { value: 'campinas-sp', label: 'Campinas - SP' }
];

export function resolveCityLabel(cityValue) {
  if (!cityValue) {
    return '';
  }

  const match = LEAF_ACTIVE_CITIES.find(city => city.value === cityValue);
  return match?.label || cityValue;
}

export function isLeafActiveCity(cityValue) {
  return LEAF_ACTIVE_CITIES.some(city => city.value === cityValue);
}
