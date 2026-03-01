import Logger from './utils/Logger';
// Firebase configuration - React Native Firebase NATIVO
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import database from '@react-native-firebase/database';
import messaging from '@react-native-firebase/messaging';
import storage from '@react-native-firebase/storage';
import { FirebaseConfig } from '../config/FirebaseConfig';


// React Native Firebase initializes automatically from google-services.json
Logger.log('🔥 Firebase NATIVO inicializando...');

// Export Firebase services
export const firebase = {
  auth: auth(),
  firestore: firestore(),
  database: database(),
  messaging: messaging(),
  storage: storage(),
  config: FirebaseConfig,
  isInitialized: true
};

Logger.log('✅ Firebase NATIVO inicializado com sucesso!');
export default firebase;