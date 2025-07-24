// Firebase configuration for Web environment only
// This file uses Firebase Web SDK

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

let firebase = {
    app: null,
    database: null,
    auth: null,
    storage: null,
}

// Define createFullStructure function
const createFullStructure = (app, db, auth, storage, config) => {
    return {
        app: app,
        config: config,
        database: db,
        auth: auth,
        storage: storage,
        authRef: auth,
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
        usersRef: db.ref('users'),
        bookingRef: db.ref('bookings'),
        cancelreasonRef: db.ref('cancel_reason'),
        settingsRef: db.ref('settings'),
        smtpRef: db.ref("smtpdata"),
        smsRef: db.ref("smsConfig"),
        carTypesRef: db.ref('cartypes'),
        carTypesEditRef: (id) => db.ref("cartypes/"+ id),
        carDocImage: (id) => storage.ref(`cartypes/${id}`),
        promoRef: db.ref('promos'),
        promoEditRef: (id) => db.ref("promos/"+ id),
        notifyRef: db.ref("notifications/"),
        notifyEditRef: (id) => db.ref("notifications/"+ id),
        addressRef: (uid, id) => db.ref("savedAddresses/"+ uid + "/" + id),
        addressEditRef: (uid) => db.ref("savedAddresses/"+ uid),
        singleUserRef: (uid) => db.ref("users/" + uid),
        profileImageRef: (uid) => storage.ref(`users/${uid}/profileImage`),
        verifyIdImageRef: (uid) => storage.ref(`users/${uid}/verifyIdImage`),
        bookingImageRef: (bookingId, imageType) => storage.ref(`bookings/${bookingId}/${imageType}`),
        driversRef: db.ref("users").orderByChild("usertype").equalTo("driver"),
        driverDocsRef: (uid) => storage.ref(`users/${uid}/license`),
        driverDocsRefBack: (uid) => storage.ref(`users/${uid}/licenseBack`),
        singleBookingRef: (bookingKey) => db.ref("bookings/" + bookingKey),
        requestedDriversRef: (bookingKey) => db.ref("bookings/" + bookingKey + "/requestedDrivers"),
        referralIdRef: (referralId) => db.ref("users").orderByChild("referralId").equalTo(referralId),
        trackingRef: (bookingId) => db.ref('tracking/' + bookingId),
        tasksRef: () => db.ref('bookings').orderByChild('status').equalTo('NEW'),
        singleTaskRef: (uid, bookingId) => db.ref("bookings/" + bookingId + "/requestedDrivers/" + uid),
        bookingListRef: (uid, role) => 
            role == 'customer' ? db.ref('bookings').orderByChild('customer').equalTo(uid) :
                (role == 'driver' ? 
                    db.ref('bookings').orderByChild('driver').equalTo(uid)
                    :
                    (role == 'fleetadmin' ? 
                        db.ref('bookings').orderByChild('fleetadmin').equalTo(uid)
                        : db.ref('bookings')
                    )
                ),
        chatRef: (bookingId) => db.ref('chats/' + bookingId + '/messages'),
        withdrawRef: db.ref('withdraws/'),
        languagesRef: db.ref("languages"),
        languagesEditRef: (id) => db.ref("languages/"+ id),
        langEditRef: (id) => db.ref(`languages/${id}/keyValuePairs/`),
        walletHistoryRef: (uid) => db.ref("walletHistory/" + uid),
        userNotificationsRef: (uid) => db.ref("userNotifications/"+ uid),
        userRatingsRef: (uid) => db.ref("userRatings/"+ uid),
        carsRef: (uid, role) => role == 'driver' ? 
            db.ref('cars').orderByChild('driver').equalTo(uid)
            : (role == 'fleetadmin' ? 
                db.ref('cars').orderByChild('fleetadmin').equalTo(uid)
                : db.ref('cars')
            ),
        carAddRef: db.ref("cars"),
        carEditRef: (id) => db.ref("cars/"+ id),
        carImage: (id) => storage.ref(`cars/${id}`),
        allLocationsRef: db.ref("locations"),
        userLocationRef: (uid) => db.ref("locations/"+ uid),
        sosRef: db.ref('sos'),
        editSosRef: (id) => db.ref("sos/" + id),
        complainRef: db.ref('complain'),
        editComplainRef: (id) => db.ref("complain/" + id),
        paymentSettingsRef: db.ref("payment_settings"),
        usedreferralRef: db.ref('usedreferral'),
    }
}

// Initialize Firebase for Web environment
try {
    // Default config for web
    const defaultConfig = {
        projectId: "leaf-reactnative",
        appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
        databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
        storageBucket: "leaf-reactnative.firebasestorage.app",
        apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
        authDomain: "leaf-reactnative.firebaseapp.com",
        messagingSenderId: "106504629884",
        measurementId: "G-22368DBCY9"
    };

    const app = initializeApp(defaultConfig);
    const auth = getAuth(app);
    const database = getDatabase(app);
    const storage = getStorage(app);

    firebase = createFullStructure(app, database, auth, storage, defaultConfig);
} catch (error) {
    console.error('Failed to initialize Web Firebase:', error);
}

export {
    firebase
} 
