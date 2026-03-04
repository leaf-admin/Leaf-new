import Logger from '../utils/Logger';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useAuth } from '../hooks/useAuth';
import { FETCH_USER_SUCCESS } from '../common-local/types';
import database from '@react-native-firebase/database';
import interactiveNotificationService from '../services/InteractiveNotificationService';
import persistentRideNotificationService from '../services/PersistentRideNotificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';


const AuthProvider = ({ children }) => {
  const { user, loading } = useAuth();
  const dispatch = useDispatch();
  const [isSyncing, setIsSyncing] = useState(false);
  const hasSynced = useRef(false);

  // ✅ Otimização: Memoizar função para evitar recriações desnecessárias
  const syncUserData = useCallback(async (firebaseUser) => {
    if (isSyncing || hasSynced.current) return; // Evitar múltiplas sincronizações

    setIsSyncing(true);
    try {
      Logger.log('🔄 Sincronizando dados do usuário no Realtime Database...');

      // 🚀 BYPASS PARA USUÁRIO DE TESTE - Permitir acesso total
      if (firebaseUser.uid && firebaseUser.uid.includes('test-user-dev')) {
        Logger.log('🧪 BYPASS: Usuário de teste detectado - permitindo acesso total ao database');

        // Verificar se é customer de teste
        const isTestCustomer = firebaseUser.uid.includes('test-customer-dev');

        // Criar dados mock para usuário de teste
        const testUserData = {
          uid: firebaseUser.uid,
          phone: '+5511999999999',
          usertype: isTestCustomer ? 'customer' : 'driver', // ✅ Usar 'customer' em vez de 'passenger'
          userType: isTestCustomer ? 'customer' : 'driver', // ✅ Compatibilidade
          name: isTestCustomer ? 'Customer de Teste' : 'Usuário de Teste',
          firstName: isTestCustomer ? 'Customer' : 'Driver',
          lastName: 'de Teste',
          email: isTestCustomer ? 'customer@leafapp.com' : 'test@leafapp.com',
          isTestUser: true,
          isTestCustomer: isTestCustomer,
          approved: true,
          walletBalance: isTestCustomer ? 500 : 1000,
          rating: isTestCustomer ? 4.9 : 4.8,
          carType: isTestCustomer ? null : 'standard',
          carModel: isTestCustomer ? null : 'Test Car',
          carPlate: isTestCustomer ? null : 'TEST1234',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          // Dados específicos para customer
          ...(isTestCustomer && {
            customerData: {
              preferredPaymentMethod: 'credit_card',
              hasValidPayment: true,
              totalRides: 0,
              totalSpent: 0,
              favoriteLocations: [],
              emergencyContact: {
                name: 'Contato de Emergência',
                phone: '+5511999999998'
              }
            }
          }),
          // Campos necessários para bypass de permissões
          permissions: {
            canAccessDatabase: true,
            canReadAll: true,
            canWriteAll: true,
            bypassSecurity: true,
            bypassPayment: isTestCustomer, // Customer precisa de bypass de pagamento
            bypassKYC: isTestCustomer      // Customer precisa de bypass de KYC
          }
        };

        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: testUserData
        });

        // ✅ Inicializar serviços de notificação
        try {
          await persistentRideNotificationService.initialize();
          await interactiveNotificationService.initialize();
          Logger.log('✅ Serviços de notificação inicializados para usuário de teste');
        } catch (notifError) {
          Logger.warn('⚠️ Erro ao inicializar serviços de notificação:', notifError);
        }

        hasSynced.current = true;
        setIsSyncing(false);
        Logger.log('✅ Usuário de teste sincronizado com bypass de permissões');
        return;
      }

      // Buscar dados do usuário no Realtime Database
      const userRef = database().ref(`users/${firebaseUser.uid}`);
      const snapshot = await userRef.once('value');

      if (snapshot.exists()) {
        const userData = snapshot.val();
        Logger.log('✅ Dados encontrados no Realtime Database:', userData);

        // Criar payload completo com dados do Firebase Auth + Realtime Database
        const completeUserData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || userData.email,
          phoneNumber: firebaseUser.phoneNumber || userData.mobile,
          // Dados do Realtime Database
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          usertype: userData.usertype || 'customer',
          mobile: userData.mobile || firebaseUser.phoneNumber,
          profileImage: userData.profileImage || null,
          walletBalance: userData.walletBalance || 0,
          // Outros campos importantes
          ...userData,
          // Garantir que profile tenha todos os dados
          profile: {
            uid: firebaseUser.uid,
            email: firebaseUser.email || userData.email,
            phoneNumber: firebaseUser.phoneNumber || userData.mobile,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            usertype: userData.usertype || 'customer',
            mobile: userData.mobile || firebaseUser.phoneNumber,
            profileImage: userData.profileImage || null,
            walletBalance: userData.walletBalance || 0,
            ...userData
          }
        };

        // Dispatch para o Redux
        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: completeUserData
        });

        Logger.log('✅ Usuário sincronizado com sucesso no Redux');

        // ✅ Inicializar serviços de notificação após login
        try {
          await persistentRideNotificationService.initialize();
          await interactiveNotificationService.initialize();
          Logger.log('✅ Serviços de notificação inicializados');
        } catch (notifError) {
          Logger.warn('⚠️ Erro ao inicializar serviços de notificação:', notifError);
        }

        // Salvar token FCM no Firebase se disponível
        try {
          const fcmToken = await AsyncStorage.getItem('fcmToken');
          if (fcmToken) {
            Logger.log('📱 Token FCM encontrado, salvando no Firebase:', fcmToken.substring(0, 20) + '...');

            await userRef.update({
              fcmToken: fcmToken,
              pushToken: fcmToken,
              platform: Platform.OS,
              lastSeen: new Date().toISOString()
            });

            Logger.log('✅ Token FCM salvo no Firebase Realtime Database');
          }
        } catch (fcmError) {
          Logger.error('❌ Erro ao salvar token FCM:', fcmError);
        }
      } else {
        Logger.log('⚠️ Usuário não encontrado no Realtime Database - NÃO criando perfil básico');
        Logger.log('⚠️ Deixando AppCommon controlar o fluxo de onboarding');

        // NÃO criar perfil básico - deixar AppCommon controlar
        // hasSynced.current = false; // Manter como não sincronizado

        // Dispatch de dados mínimos SEM usertype
        const minimalUserData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          phoneNumber: firebaseUser.phoneNumber,
          // NÃO definir usertype aqui
          profile: {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            phoneNumber: firebaseUser.phoneNumber,
            // NÃO definir usertype aqui
          }
        };

        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: minimalUserData
        });

        // NÃO marcar como sincronizado para permitir onboarding
        hasSynced.current = false;
      }

      // Marcar como sincronizado
      // hasSynced.current = true; // Manter como não sincronizado
    } catch (error) {
      Logger.error('❌ Erro ao sincronizar dados do usuário:', error);

      // Em caso de erro, usar dados mínimos SEM usertype
      const fallbackUserData = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        phoneNumber: firebaseUser.phoneNumber,
        // NÃO definir usertype aqui
        profile: {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          phoneNumber: firebaseUser.phoneNumber,
          // NÃO definir usertype aqui
        }
      };

      dispatch({
        type: FETCH_USER_SUCCESS,
        payload: fallbackUserData
      });

      // NÃO marcar como sincronizado para permitir onboarding
      hasSynced.current = false;
    } finally {
      setIsSyncing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    if (user && !loading && !hasSynced.current) {
      // Usuário autenticado no Firebase, sincronizar dados completos apenas uma vez
      syncUserData(user);
    }
  }, [user, loading]);

  // Não renderizar nada enquanto carrega
  if (loading) {
    return null;
  }

  return children;
};

export default AuthProvider; 