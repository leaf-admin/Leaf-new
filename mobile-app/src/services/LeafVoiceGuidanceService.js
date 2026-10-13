import { NativeModules } from 'react-native';

const bridge = () => NativeModules.LeafVoiceGuidance;

export function buildLeafVoiceCue(model) {
  if (!model?.hasSteps || model.isOffRoute || !model.currentInstruction || !model.navigationKey) return null;
  const distance = Number(model.maneuverDistanceMeters);
  if (!Number.isFinite(distance) || distance < 0) return null;
  const stage = distance > 150 ? 'early' : distance > 50 ? 'approach' : 'near';
  const distanceText = distance >= 1000 ? `${Math.round(distance / 100) / 10} quilômetros` : `${Math.max(1, Math.round(distance / 10) * 10)} metros`;
  return {
    key: [model.navigationKey, model.currentStepIndex, model.currentInstruction, stage].join(':'),
    text: distance <= 25 ? model.currentInstruction : `Em ${distanceText}, ${model.currentInstruction}`,
  };
}

export async function isLeafVoiceAvailable() {
  if (!bridge()?.isAvailable) return false;
  try { return Boolean(await bridge().isAvailable('pt-BR')); }
  catch { return false; }
}

export async function speakLeafNavigation(instruction, key) {
  const text = String(instruction || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!text || !bridge()?.speak) throw new Error('A voz de navegação não está disponível neste dispositivo.');
  return bridge().speak(text, 'pt-BR', String(key || 'leaf-navigation'));
}

export async function stopLeafNavigationVoice() {
  try { await bridge()?.stop?.(); } catch { /* Stopping speech must not interrupt a trip. */ }
}
