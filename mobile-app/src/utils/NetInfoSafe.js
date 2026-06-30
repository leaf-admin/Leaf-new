/**
 * Wrapper seguro para @react-native-community/netinfo
 * Trata erros quando o módulo nativo não está disponível
 */

import React from 'react';
import Logger from './Logger';

let NetInfo = null;
let isAvailable = false;

// Tentar importar o NetInfo
try {
  NetInfo = require('@react-native-community/netinfo');
  isAvailable = true;
} catch (error) {
  Logger.warn('⚠️ NetInfo não disponível, usando fallback:', error.message);
  isAvailable = false;
}

/**
 * Verifica se o NetInfo está disponível
 */
export const isNetInfoAvailable = () => isAvailable;

/**
 * Estado padrão quando NetInfo não está disponível
 */
const DEFAULT_STATE = {
  isConnected: true,
  isInternetReachable: true,
  type: 'unknown',
  details: null,
};

export const normalizeNetInfoState = (state = DEFAULT_STATE) => {
  const source = state && typeof state === 'object' ? state : DEFAULT_STATE;
  const isConnected = source.isConnected === false ? false : true;
  const isInternetReachable =
    source.isInternetReachable === false ? false : true;

  return {
    ...DEFAULT_STATE,
    ...source,
    isConnected,
    isInternetReachable,
  };
};

/**
 * Wrapper seguro para NetInfo.fetch()
 */
export const fetchNetInfo = async () => {
  if (!isAvailable || !NetInfo) {
    Logger.warn('⚠️ NetInfo não disponível, retornando estado padrão (online)');
    return DEFAULT_STATE;
  }

  try {
    return normalizeNetInfoState(await NetInfo.fetch());
  } catch (error) {
    Logger.error('❌ Erro ao buscar informações de rede:', error);
    return DEFAULT_STATE;
  }
};

/**
 * Wrapper seguro para NetInfo.addEventListener()
 */
export const addNetInfoListener = (callback) => {
  if (!isAvailable || !NetInfo) {
    Logger.warn('⚠️ NetInfo não disponível, listener não será registrado');
    // Retornar função de unsubscribe vazia
    return () => {};
  }

  try {
    return NetInfo.addEventListener((state) => {
      callback(normalizeNetInfoState(state));
    });
  } catch (error) {
    Logger.error('❌ Erro ao adicionar listener de rede:', error);
    return () => {};
  }
};

/**
 * Hook para usar NetInfo de forma segura
 */
export const useNetInfo = () => {
  const [netInfo, setNetInfo] = React.useState(DEFAULT_STATE);

  React.useEffect(() => {
    if (!isAvailable) {
      return;
    }

    // Buscar estado inicial
    fetchNetInfo().then(setNetInfo);

    // Adicionar listener
    const unsubscribe = addNetInfoListener(setNetInfo);

    return () => {
      unsubscribe();
    };
  }, []);

  return netInfo;
};

// Exportar o NetInfo original se disponível, caso alguém precise
export default NetInfo;
