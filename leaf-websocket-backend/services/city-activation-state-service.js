const firebaseConfig = require('../firebase-config');
const { logger } = require('../utils/logger');

const FIRESTORE_COLLECTION = 'operational_configs';
const FIRESTORE_DOC_ID = 'city_activation';
const LEGACY_CONFIG_PATH = 'operations/geography/cityActivation';

class CityActivationStateService {
  constructor() {
    this.firestore = null;
  }

  getFirestore() {
    if (!this.firestore && firebaseConfig?.getFirestore) {
      this.firestore = firebaseConfig.getFirestore();
    }
    return this.firestore;
  }

  configDoc() {
    const firestore = this.getFirestore();
    if (!firestore) {
      return null;
    }
    return firestore.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID);
  }

  async getConfig() {
    const firestoreDoc = this.configDoc();
    if (firestoreDoc) {
      try {
        const snapshot = await firestoreDoc.get();
        if (snapshot.exists) {
          return snapshot.data() || null;
        }
      } catch (error) {
        logger.warn('Falha ao carregar city activation do Firestore', {
          error: error?.message || error
        });
      }
    }

    if (!firebaseConfig?.getFromRealtimeDB) {
      return null;
    }

    try {
      const legacyConfig = (await firebaseConfig.getFromRealtimeDB(LEGACY_CONFIG_PATH)) || null;

      if (legacyConfig && firestoreDoc) {
        try {
          await firestoreDoc.set(
            {
              ...legacyConfig,
              source: 'legacy_rtdb_import',
              importedAt: new Date().toISOString()
            },
            { merge: true }
          );
        } catch (mirrorError) {
          logger.warn('Falha ao espelhar city activation legada no Firestore', {
            error: mirrorError?.message || mirrorError
          });
        }
      }

      return legacyConfig;
    } catch (error) {
      logger.warn('Nao foi possivel carregar configuracao de cidades para waitlist', {
        error: error?.message || error
      });
      return null;
    }
  }
}

module.exports = new CityActivationStateService();
