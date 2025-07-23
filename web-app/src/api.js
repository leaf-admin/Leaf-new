// Web-compatible API functions
// This replaces the common package imports for web-app

import React from 'react';
import { initializeApp } from 'firebase/app';
import { configureStore } from '@reduxjs/toolkit';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getDatabase, ref, set, get, push, update, remove, query, orderByChild, equalTo } from 'firebase/database';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
  // Your Firebase config here
  // This should match your Firebase project settings
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const firestore = getFirestore(app);

// API functions
export const api = {
  // Auth functions
  loginUser: async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  },

  registerUser: async (email, password) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  },

  logoutUser: async () => {
    try {
      await signOut(auth);
    } catch (error) {
      throw error;
    }
  },

  // Database functions
  setData: async (path, data) => {
    try {
      await set(ref(database, path), data);
    } catch (error) {
      throw error;
    }
  },

  getData: async (path) => {
    try {
      const snapshot = await get(ref(database, path));
      return snapshot.val();
    } catch (error) {
      throw error;
    }
  },

  pushData: async (path, data) => {
    try {
      const newRef = push(ref(database, path));
      await set(newRef, data);
      return newRef.key;
    } catch (error) {
      throw error;
    }
  },

  updateData: async (path, data) => {
    try {
      await update(ref(database, path), data);
    } catch (error) {
      throw error;
    }
  },

  removeData: async (path) => {
    try {
      await remove(ref(database, path));
    } catch (error) {
      throw error;
    }
  },

  // Firestore functions
  setFirestoreDoc: async (collection, docId, data) => {
    try {
      await setDoc(doc(firestore, collection, docId), data);
    } catch (error) {
      throw error;
    }
  },

  getFirestoreDoc: async (collection, docId) => {
    try {
      const docRef = doc(firestore, collection, docId);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
      throw error;
    }
  },

  addFirestoreDoc: async (collection, data) => {
    try {
      const docRef = await addDoc(collection(firestore, collection), data);
      return docRef.id;
    } catch (error) {
      throw error;
    }
  },

  updateFirestoreDoc: async (collection, docId, data) => {
    try {
      await updateDoc(doc(firestore, collection, docId), data);
    } catch (error) {
      throw error;
    }
  },

  deleteFirestoreDoc: async (collection, docId) => {
    try {
      await deleteDoc(doc(firestore, collection, docId));
    } catch (error) {
      throw error;
    }
  },

  // Utility functions
  formatDate: (date) => {
    return new Date(date).toLocaleDateString();
  },

  formatCurrency: (amount) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amount);
  },

  // Countries data
  countries: [
    { code: 'BR', name: 'Brazil' },
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    // Add more countries as needed
  ]
};

// Redux store
export const store = configureStore({
  reducer: {
    // Add your reducers here
  },
});

// Firebase context for React
export const FirebaseContext = React.createContext();

export const FirebaseProvider = ({ children }) => {
  return (
    <FirebaseContext.Provider value={{ auth, database, firestore }}>
      {children}
    </FirebaseContext.Provider>
  );
}; 
