import base64 from 'react-native-base64';

import { FirebaseConfig } from '../../../config/FirebaseConfig';
import { store } from '../../state/appStore';
import Logger from '../../utils/Logger';
import AccessKey from './functionAccessKey';
import { firebase } from './sessionService';

export { default as countries } from './countries';

const EDIT_REFERRAL_ID = 'EDIT_REFERRAL_ID';

const getSafeConfig = () => {
  const { config } = firebase;
  return config || FirebaseConfig;
};

const getConfiguredHost = () => {
  const config = getSafeConfig();
  const settings = store.getState()?.settingsdata?.settings || {};
  const browserOrigin = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : null;

  if (browserOrigin && settings.CompanyWebsite === browserOrigin) {
    return browserOrigin;
  }

  return `https://${config.projectId}.web.app`;
};

export const validateReferer = async (referralId) => {
  const config = getSafeConfig();
  const response = await fetch(`https://${config.projectId}.web.app/validate_referrer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      referralId,
    }),
  });

  return response.json();
};

export const checkUserExists = async (data) => {
  const config = getSafeConfig();
  const response = await fetch(`${getConfiguredHost()}/check_user_exists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${base64.encode(`${config.projectId}:${AccessKey}`)}`,
    },
    body: JSON.stringify({
      email: data.email,
      mobile: data.mobile,
    }),
  });

  return response.json();
};

export const mainSignUp = async (regData) => {
  const config = getSafeConfig();
  const url = `https://${config.projectId}.web.app/user_signup`;
  Logger.log('=== INÍCIO DO PROCESSO DE CADASTRO ===');
  Logger.log('URL da API:', url);
  Logger.log('Dados sendo enviados:', { ...regData, password: '***' });

  try {
    Logger.log('Fazendo requisição para a API...');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ regData }),
    });

    Logger.log('Status da resposta:', response.status);
    Logger.log('Headers da resposta:', response.headers);

    const res = await response.json();
    Logger.log('Resposta completa da API:', res);

    if (res.error) {
      Logger.error('Erro retornado pela API:', res.error);
      throw new Error(res.error);
    }

    Logger.log('=== CADASTRO CONCLUÍDO COM SUCESSO ===');
    return res;
  } catch (error) {
    Logger.error('=== ERRO NO CADASTRO ===');
    Logger.error('Erro completo:', error);
    Logger.error('Mensagem do erro:', error.message);
    Logger.error('Stack do erro:', error.stack);
    throw error;
  }
};

export const editreferral = (users, method) => (dispatch) => {
  const { usedreferralRef } = firebase;

  dispatch({
    type: EDIT_REFERRAL_ID,
    payload: { method, users },
  });

  if (method === 'Add') {
    return usedreferralRef.push(users);
  }

  return null;
};
