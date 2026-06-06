// Firebase configuration for React Native environment only
// This file now uses the centralized Firebase references

import Logger from '../../utils/Logger';
import { firebase, firebaseRefs, firebaseStorageRefs } from '../../firebase-refs';
import { FirebaseConfig } from '../../../config/FirebaseConfig';

// Create the firebase object with all references
const firebaseConfig = {
    app: firebase.app,
    config: FirebaseConfig,
    database: firebase.database,
    auth: firebase.auth,
    storage: firebase.storage,
    authRef: firebase.auth,
    isInitialized: firebase.isInitialized,
    
    // Auth providers (to be implemented as needed)
    googleProvider: null,
    appleProvider: null,
    phoneProvider: null,
    RecaptchaVerifier: null,
    signInWithPhoneNumber: null,
    updatePhoneNumber: null,
    unlink: null,
    googleCredential: null,
    linkWithPhoneNumber: null,
    mobileAuthCredential: null,
    
    // Database references
    ...firebaseRefs,
    
    // Storage references
    ...firebaseStorageRefs,
};

Logger.log('✅ Firebase configured successfully using centralized references');

export {
    firebaseConfig as firebase
}








