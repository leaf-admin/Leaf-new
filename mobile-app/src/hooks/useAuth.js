import { useEffect, useState, useCallback } from 'react';
import auth from '@react-native-firebase/auth';
import apiClient from '../services/httpClient';

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
      const response = await apiClient.post('/api/custom-otp/request-otp', {
        phone: phoneNumber
      });
      const data = response?.data || {};
      if (!data.success || !data.verificationId) {
        throw new Error(data.error || 'Não foi possível enviar o código pelo WhatsApp.');
      }

      return {
        verificationId: data.verificationId,
        isCustomOtp: true,
        channel: data.channel || 'whatsapp',
        expiresIn: data.expiresIn || 300,
        confirm: async (code) => {
          const verificationResponse = await apiClient.post('/api/custom-otp/verify-otp', {
            phone: phoneNumber,
            verificationId: data.verificationId,
            otp: code
          });
          const verificationData = verificationResponse?.data || {};
          if (!verificationData.success || !verificationData.customToken) {
            throw new Error(verificationData.error || 'Código inválido.');
          }
          return auth().signInWithCustomToken(verificationData.customToken);
        }
      };
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
