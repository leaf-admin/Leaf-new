import Logger from '../../utils/Logger';
import { firebase } from '../../firebase-refs';

const getPaymentMethodsRef = (uid) => {
  if (!uid) {
    throw new Error('UID é obrigatório para acessar métodos de pagamento.');
  }

  return firebase.database.ref(`payment_methods/${uid}`);
};

const normalizePaymentMethods = (rawValue) => {
  if (!rawValue) return [];

  if (Array.isArray(rawValue)) {
    return rawValue
      .filter(Boolean)
      .map((method, index) => ({
        id: method.id || String(index),
        ...method
      }));
  }

  return Object.entries(rawValue).map(([id, method]) => ({
    id,
    ...method
  }));
};

export const getPaymentMethods = async (uid, options = {}) => {
  try {
    const snapshot = await getPaymentMethodsRef(uid).once('value');
    return normalizePaymentMethods(snapshot.val()).sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  } catch (error) {
    if (!options?.suppressErrorLog) {
      Logger.error('Erro ao carregar métodos de pagamento:', error);
    }
    throw error;
  }
};

export const addPaymentMethod = async (uid, method) => {
  try {
    const ref = getPaymentMethodsRef(uid).push();
    const payload = {
      ...method,
      createdAt: method?.createdAt || new Date().toISOString()
    };

    await ref.set(payload);
    return { id: ref.key, ...payload };
  } catch (error) {
    Logger.error('Erro ao adicionar método de pagamento:', error);
    throw error;
  }
};

export const removePaymentMethod = async (uid, methodId) => {
  try {
    if (!methodId) {
      throw new Error('ID do método de pagamento é obrigatório.');
    }

    await getPaymentMethodsRef(uid).child(methodId).remove();
    return true;
  } catch (error) {
    Logger.error('Erro ao remover método de pagamento:', error);
    throw error;
  }
};
