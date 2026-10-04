import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSelector } from 'react-redux';
import MobilePreferencesService, { DEFAULT_MOBILE_PREFERENCES, getCachedMobilePreferences } from '../services/MobilePreferencesService';

const PreferencesContext = createContext({
  preferences: DEFAULT_MOBILE_PREFERENCES,
  ready: false,
  loading: false,
  saving: false,
  error: '',
  refresh: async () => {},
  update: async () => { throw new Error('Entre na sua conta para alterar as configurações.'); },
});

export function MobilePreferencesProvider({ children }) {
  const uid = useSelector(state => state?.auth?.uid || state?.auth?.profile?.uid || null);
  const owner = useRef(uid);
  owner.current = uid;
  const request = useRef(null);
  const mutation = useRef(null);
  const [state, setState] = useState({ uid, preferences: getCachedMobilePreferences(uid) || DEFAULT_MOBILE_PREFERENCES, ready: false, loading: false, saving: false, error: '' });

  const refresh = useCallback(async ({ forceRefresh = false } = {}) => {
    if (!uid || request.current?.uid === uid) return;
    const task = { uid, cancelled: false };
    request.current = task;
    setState(current => ({ ...current, uid, loading: true, error: '' }));
    try {
      const preferences = await MobilePreferencesService.getPreferences({ uid, forceRefresh });
      if (!task.cancelled && owner.current === uid) {
        setState(current => ({ ...current, uid, preferences, ready: true, loading: false, error: '' }));
      }
    } catch (error) {
      if (!task.cancelled && owner.current === uid) setState(current => ({ ...current, loading: false, error: error.message }));
    } finally { if (request.current === task) request.current = null; }
  }, [uid]);

  const update = useCallback(async patch => {
    if (!uid || owner.current !== uid) throw new Error('A sessão mudou. Abra novamente suas configurações.');
    if (mutation.current?.uid === uid) throw new Error('Aguarde a configuração ser salva.');
    const task = { uid };
    mutation.current = task;
    setState(current => ({ ...current, saving: true, error: '' }));
    try {
      const preferences = await MobilePreferencesService.updatePreferences(patch, { uid });
      if (owner.current !== uid) throw new Error('A sessão mudou. Abra novamente suas configurações.');
      setState(current => ({ ...current, uid, preferences, ready: true, saving: false }));
      return preferences;
    } catch (error) {
      if (owner.current === uid) setState(current => ({ ...current, saving: false, error: error.message }));
      throw error;
    } finally { if (mutation.current === task) mutation.current = null; }
  }, [uid]);

  useEffect(() => {
    const cached = getCachedMobilePreferences(uid);
    setState({ uid, preferences: cached || DEFAULT_MOBILE_PREFERENCES, ready: Boolean(uid && cached), loading: Boolean(uid), saving: false, error: '' });
    refresh();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') refresh({ forceRefresh: true });
    });
    return () => {
      if (request.current) request.current.cancelled = true;
      request.current = null;
      subscription?.remove();
    };
  }, [uid, refresh]);

  const visible = state.uid === uid ? state : { preferences: DEFAULT_MOBILE_PREFERENCES, ready: false, loading: Boolean(uid), saving: false, error: '' };
  return <PreferencesContext.Provider value={{ ...visible, uid, refresh, update }}>{children}</PreferencesContext.Provider>;
}

export const useMobilePreferences = () => useContext(PreferencesContext);
