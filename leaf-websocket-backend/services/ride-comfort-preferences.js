// Conforto que o passageiro escolhe (temperatura do ar e som) e o motorista vê
// depois de aceitar. Só informa: não entra no despacho nem no preço.
// Os rótulos saem daqui, para o app do motorista não exibir texto do passageiro.

const RIDE_TEMPERATURE_OPTIONS = Object.freeze({
  cool: 'Ar mais fresco',
  mild: 'Ar ameno',
  any: null
});

const RIDE_SOUND_OPTIONS = Object.freeze({
  quiet: 'Prefere silêncio',
  music: 'Pode ter música',
  any: null
});

function pickOption(options, value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(options, key) ? key : null;
}

function normalizeRideTemperature(value) {
  return pickOption(RIDE_TEMPERATURE_OPTIONS, value);
}

function normalizeRideSound(value) {
  return pickOption(RIDE_SOUND_OPTIONS, value);
}

// Aceita { temperature, sound } com o valor puro ou { value }; devolve o formato
// que vai na corrida ({ temperature: { value, label }, sound: { value, label } }),
// sem as escolhas "tanto faz". null quando não sobra nada para mostrar.
function buildRideComfort(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const temperature = normalizeRideTemperature(input.temperature?.value ?? input.temperature);
  const sound = normalizeRideSound(input.sound?.value ?? input.sound);
  const comfort = {};
  if (temperature && RIDE_TEMPERATURE_OPTIONS[temperature]) {
    comfort.temperature = { value: temperature, label: RIDE_TEMPERATURE_OPTIONS[temperature] };
  }
  if (sound && RIDE_SOUND_OPTIONS[sound]) {
    comfort.sound = { value: sound, label: RIDE_SOUND_OPTIONS[sound] };
  }
  return Object.keys(comfort).length ? comfort : null;
}

// Preferências da corrida vindas do app: o conforto é refeito aqui, o resto segue.
function sanitizeRidePreferences(preferences = {}) {
  const next = preferences && typeof preferences === 'object' ? { ...preferences } : {};
  const comfort = buildRideComfort(next.comfort);
  if (comfort) next.comfort = comfort;
  else delete next.comfort;
  return next;
}

module.exports = {
  RIDE_SOUND_OPTIONS,
  RIDE_TEMPERATURE_OPTIONS,
  buildRideComfort,
  normalizeRideSound,
  normalizeRideTemperature,
  sanitizeRidePreferences
};
