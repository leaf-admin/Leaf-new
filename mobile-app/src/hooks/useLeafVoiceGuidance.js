import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { buildLeafVoiceCue, speakLeafNavigation, stopLeafNavigationVoice } from '../services/LeafVoiceGuidanceService';
import Logger from '../utils/Logger';

// Route steps come from the existing runtime. This hook never fetches directions.
export default function useLeafVoiceGuidance({ uid, enabled, focused, navigationModel }) {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const spoken = useRef(new Set());
  const routeKey = useRef('');
  const model = navigationModel;
  const cue = buildLeafVoiceCue(model);
  const key = cue?.key || '';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setActive(next === 'active'));
    return () => { subscription?.remove(); stopLeafNavigationVoice(); };
  }, []);

  useEffect(() => {
    const currentRoute = [uid, model?.navigationKey || ''].join(':');
    if (routeKey.current !== currentRoute) { spoken.current.clear(); routeKey.current = currentRoute; }
    if (!uid || !enabled || !focused || !active || !key) {
      spoken.current.clear();
      stopLeafNavigationVoice();
      return;
    }
    if (spoken.current.has(key)) return;
    spoken.current.add(key);
    if (spoken.current.size > 100) spoken.current.delete(spoken.current.values().next().value);
    let cancelled = false;
    speakLeafNavigation(cue.text, key).catch(error => {
      if (!cancelled) Logger.warn('Voz de navegação indisponível:', error.message);
    });
    return () => { cancelled = true; stopLeafNavigationVoice(); };
  }, [uid, enabled, focused, active, key, model?.hasSteps, model?.isOffRoute]);
}
