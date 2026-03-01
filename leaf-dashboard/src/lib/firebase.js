// Firebase Configuration
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getDatabase, connectDatabaseEmulator } from 'firebase/database'

// Firebase config - usando as mesmas credenciais do projeto Leaf
const firebaseConfig = {
  apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
  authDomain: "leaf-reactnative.firebaseapp.com",
  projectId: "leaf-reactnative",
  storageBucket: "leaf-reactnative.firebasestorage.app",
  messagingSenderId: "106504629884",
  appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
  databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
  measurementId: "G-22368DBCY9"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Initialize Firebase Auth
export const auth = getAuth(app)

// Initialize Firestore
export const db = getFirestore(app)

// Initialize Realtime Database
export const database = getDatabase(app)

// Connect to emulators in development (opcional)
if (process.env.NODE_ENV === 'development') {
  // Uncomment these lines if you want to use Firebase emulators
  // connectAuthEmulator(auth, "http://localhost:9099")
  // connectFirestoreEmulator(db, 'localhost', 8080)
  // connectDatabaseEmulator(database, 'localhost', 9000)
}

export default app


