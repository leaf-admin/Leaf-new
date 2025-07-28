import { useEffect, useState, useCallback } from 'react';
import auth from '@react-native-firebase/auth';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    }, (err) => {
      setError(err);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Função para login com email/senha
  const signIn = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      await auth().signInWithEmailAndPassword(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Função para logout
  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await auth().signOut();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Função para login com telefone (OTP)
  const signInWithPhone = useCallback(async (phoneNumber) => {
    setLoading(true);
    setError(null);
    try {
      const confirmation = await auth().signInWithPhoneNumber(phoneNumber);
      return confirmation;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    user,
    loading,
    error,
    signIn,
    signOut,
    signInWithPhone,
  };
} 