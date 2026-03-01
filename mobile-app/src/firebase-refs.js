import Logger from './utils/Logger';
// Firebase References - Centralized database and storage references
// This file provides all Firebase references used throughout the app


// Import Firebase services directly (same as firebase.js)
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import database from '@react-native-firebase/database';
import messaging from '@react-native-firebase/messaging';
import storage from '@react-native-firebase/storage';

// Initialize Firebase services directly
const firebase = {
  auth: auth(),
  firestore: firestore(),
  database: database(),
  messaging: messaging(),
  storage: storage(),
  isInitialized: true
};

Logger.log('✅ Firebase refs initialized successfully');

// Helper function to safely get database reference
const getDatabaseRef = (path) => {
  if (!firebase.database) {
    Logger.error('Firebase database not available!');
    throw new Error('Firebase database not initialized');
  }
  Logger.log('🔍 Getting database ref for path:', path);
  return firebase.database.ref(path);
};

// Helper function to safely get storage reference
const getStorageRef = (path) => {
  if (!firebase.storage) {
    Logger.error('Firebase storage not available!');
    throw new Error('Firebase storage not initialized');
  }
  return firebase.storage.ref(path);
};

// Database references (async)
export const firebaseRefs = {
  // User references
  get usersRef() { return getDatabaseRef('users'); },
  singleUserRef: (uid) => getDatabaseRef("users/" + uid),
  get driversRef() {
    if (!firebase.database) return null;
    return firebase.database.ref("users").orderByChild("usertype").equalTo("driver");
  },
  referralIdRef: (referralId) => {
    if (!firebase.database) return null;
    return firebase.database.ref("users").orderByChild("referralId").equalTo(referralId);
  },
  
  // Booking references
  get bookingRef() { return getDatabaseRef('bookings'); },
  singleBookingRef: (bookingKey) => getDatabaseRef("bookings/" + bookingKey),
  requestedDriversRef: (bookingKey) => getDatabaseRef("bookings/" + bookingKey + "/requestedDrivers"),
  get tasksRef() {
    if (!firebase.database) return null;
    return firebase.database.ref('bookings').orderByChild('status').equalTo('NEW');
  },
  singleTaskRef: (uid, bookingId) => getDatabaseRef("bookings/" + bookingId + "/requestedDrivers/" + uid),
  bookingListRef: (uid, role) => {
    if (!firebase.database) return null;
    return role == 'customer' ? firebase.database.ref('bookings').orderByChild('customer').equalTo(uid) :
      (role == 'driver' ?
        firebase.database.ref('bookings').orderByChild('driver').equalTo(uid)
        :
        (role == 'fleetadmin' ?
          firebase.database.ref('bookings').orderByChild('fleetadmin').equalTo(uid)
          : firebase.database.ref('bookings')
        )
      );
  },
  
  // Chat references
  chatRef: (bookingId) => getDatabaseRef('chats/' + bookingId + '/messages'),
  
  // Settings and configuration
  get settingsRef() { return getDatabaseRef('settings'); },
  get cancelreasonRef() { return getDatabaseRef('cancel_reason'); },
  get smtpRef() { return getDatabaseRef("smtpdata"); },
  get smsRef() { return getDatabaseRef("smsConfig"); },
  get languagesRef() { return getDatabaseRef("languages"); },
  languagesEditRef: (id) => getDatabaseRef("languages/"+ id),
  langEditRef: (id) => getDatabaseRef(`languages/${id}/keyValuePairs/`),
  
  // Car types and vehicles
  get carTypesRef() { return getDatabaseRef('cartypes'); },
  carTypesEditRef: (id) => getDatabaseRef("cartypes/"+ id),
  get vehiclesRef() { return firebase.database ? firebase.database.ref('vehicles') : null; },
  get vehicleAddRef() { return getDatabaseRef('vehicles'); },
  vehicleEditRef: (id) => getDatabaseRef('vehicles/' + id),
  
  // Promotions and notifications
  get promoRef() { return getDatabaseRef('promos'); },
  promoEditRef: (id) => getDatabaseRef("promos/"+ id),
  get notifyRef() { return getDatabaseRef("notifications/"); },
  notifyEditRef: (id) => getDatabaseRef("notifications/"+ id),
  userNotificationsRef: (uid) => getDatabaseRef("userNotifications/"+ uid),
  
  // Address and location
  addressRef: (uid, id) => getDatabaseRef("savedAddresses/"+ uid + "/" + id),
  addressEditRef: (uid) => getDatabaseRef("savedAddresses/"+ uid),
  get allLocationsRef() { return getDatabaseRef("locations"); },
  userLocationRef: (uid) => getDatabaseRef("locations/"+ uid),
  trackingRef: (bookingId) => getDatabaseRef('tracking/' + bookingId),
  
  // Wallet and payments
  walletHistoryRef: (uid) => getDatabaseRef("walletHistory/" + uid),
  get withdrawRef() { return getDatabaseRef('withdraws/'); },
  get paymentSettingsRef() { return getDatabaseRef("payment_settings"); },
  get usedreferralRef() { return getDatabaseRef('usedreferral'); },
  
  // Ratings and support
  userRatingsRef: (uid) => getDatabaseRef("userRatings/"+ uid),
  get sosRef() { return getDatabaseRef('sos'); },
  editSosRef: (id) => getDatabaseRef("sos/" + id),
  get complainRef() { return getDatabaseRef('complain'); },
  editComplainRef: (id) => getDatabaseRef("complain/" + id),
};

// Storage references
export const firebaseStorageRefs = {
  // User storage
  profileImageRef: (uid) => getStorageRef(`users/${uid}/profileImage`),
  verifyIdImageRef: (uid) => getStorageRef(`users/${uid}/verifyIdImage`),
  driverDocsRef: (uid) => getStorageRef(`users/${uid}/license`),
  driverDocsRefBack: (uid) => getStorageRef(`users/${uid}/licenseBack`),
  
  // Booking storage
  bookingImageRef: (bookingId, imageType) => getStorageRef(`bookings/${bookingId}/${imageType}`),
  
  // Car types storage
  carDocImage: (id) => getStorageRef(`cartypes/${id}`),
  
  // Vehicle storage
  vehicleImage: (id) => getStorageRef(`vehicles/${id}`),
};

// Export Firebase instance for direct access
export { firebase };
export default firebase;
