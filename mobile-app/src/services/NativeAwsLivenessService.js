import { NativeModules, Platform } from 'react-native';

const nativeModule = NativeModules.LeafAwsLiveness || null;

function normalizeCredentialPayload(credentials = {}) {
  return {
    accessKeyId: credentials.accessKeyId || credentials.AccessKeyId || '',
    secretAccessKey: credentials.secretAccessKey || credentials.SecretAccessKey || '',
    sessionToken: credentials.sessionToken || credentials.SessionToken || '',
    expiration: credentials.expiration || credentials.Expiration || null,
  };
}

class NativeAwsLivenessService {
  isAvailable() {
    return Boolean(
      nativeModule
      && typeof nativeModule.start === 'function'
      && (Platform.OS === 'ios' || Platform.OS === 'android')
    );
  }

  async start({ sessionId, region, credentials }) {
    if (!this.isAvailable()) {
      const error = new Error('Módulo nativo de liveness AWS indisponível nesta build.');
      error.code = 'AWS_LIVENESS_NATIVE_UNAVAILABLE';
      throw error;
    }

    if (!sessionId || !region) {
      const error = new Error('Sessão de liveness AWS inválida.');
      error.code = 'AWS_LIVENESS_SESSION_INVALID';
      throw error;
    }

    const normalizedCredentials = normalizeCredentialPayload(credentials);
    if (
      !normalizedCredentials.accessKeyId
      || !normalizedCredentials.secretAccessKey
      || !normalizedCredentials.sessionToken
    ) {
      const error = new Error('Credenciais temporárias AWS inválidas.');
      error.code = 'AWS_LIVENESS_CREDENTIALS_INVALID';
      throw error;
    }

    return nativeModule.start({
      sessionId,
      region,
      credentials: normalizedCredentials,
    });
  }

  async cancel() {
    if (
      !nativeModule
      || typeof nativeModule.cancel !== 'function'
      || (Platform.OS !== 'ios' && Platform.OS !== 'android')
    ) {
      return {
        success: true,
        cancelled: false,
        supported: false,
      };
    }

    const result = await nativeModule.cancel();
    return {
      success: result?.success !== false,
      cancelled: result?.cancelled === true,
      supported: true,
    };
  }
}

export const nativeAwsLivenessService = new NativeAwsLivenessService();

export default nativeAwsLivenessService;
