import Logger from '../utils/Logger';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useAuth } from '../hooks/useAuth';
import { FETCH_USER_SUCCESS } from '../state/actionTypes';
import interactiveNotificationService from '../services/InteractiveNotificationService';
import persistentRideNotificationService from '../services/PersistentRideNotificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { allowTestUserTools } from '../config/runtimeAccessPolicy';
import mobileProfileService from '../services/MobileProfileService';
import { restoreQaSeedProfile } from '../utils/qaSeedProfile';
import {
  buildIncompleteOnboardingProfile,
  persistPhoneValidatedOnboardingSession,
} from '../utils/onboardingSessionState';

const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const TEST_MODE_STORAGE_KEY = '@test_mode';

const normalizeUserType = (userType) => {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType === 'driver' ? 'driver' : userType === 'customer' ? 'customer' : null;
};

const normalizePersistedProfile = (profile) => {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const uid = String(profile.uid || '').trim();
  if (!uid) {
    return null;
  }

  const normalizedUserType = normalizeUserType(
    profile.usertype || profile.userType || profile?.profile?.usertype || profile?.profile?.userType
  );

  return {
    ...profile,
    uid,
    ...(normalizedUserType ? { usertype: normalizedUserType, userType: normalizedUserType } : {})
  };
};

const resolveStoredProfileRole = (profile) =>
  normalizeUserType(
    profile?.usertype ||
      profile?.userType ||
      profile?.role ||
      profile?.profile?.usertype ||
      profile?.profile?.userType ||
      profile?.profile?.role
  );

const normalizePhoneDigits = (phone) => String(phone || '').replace(/\D/g, '');

const buildCompleteUserDataFromProfile = (firebaseUser, profile) => {
  const normalizedProfile = normalizePersistedProfile(profile);
  if (!normalizedProfile?.uid) {
    return null;
  }

  return {
    uid: normalizedProfile.uid,
    email: normalizedProfile.email || firebaseUser?.email,
    phoneNumber:
      normalizedProfile.phoneNumber ||
      normalizedProfile.mobile ||
      firebaseUser?.phoneNumber,
    phone:
      normalizedProfile.phone ||
      normalizedProfile.mobile ||
      normalizedProfile.phoneNumber ||
      firebaseUser?.phoneNumber,
    firstName: normalizedProfile.firstName || '',
    lastName: normalizedProfile.lastName || '',
    usertype: resolveStoredProfileRole(normalizedProfile) || 'customer',
    mobile: normalizedProfile.mobile || firebaseUser?.phoneNumber,
    profileImage: normalizedProfile.profileImage || null,
    walletBalance: normalizedProfile.walletBalance || 0,
    ...normalizedProfile,
    profile: {
      uid: normalizedProfile.uid,
      email: normalizedProfile.email || firebaseUser?.email,
      phoneNumber:
        normalizedProfile.phoneNumber ||
        normalizedProfile.mobile ||
        firebaseUser?.phoneNumber,
      firstName: normalizedProfile.firstName || '',
      lastName: normalizedProfile.lastName || '',
      usertype: resolveStoredProfileRole(normalizedProfile) || 'customer',
      mobile: normalizedProfile.mobile || firebaseUser?.phoneNumber,
      profileImage: normalizedProfile.profileImage || null,
      walletBalance: normalizedProfile.walletBalance || 0,
      ...normalizedProfile,
    },
  };
};

const AuthBootstrapShell = ({ syncing }) => (
  <View style={styles.bootstrapContainer}>
    <View style={styles.bootstrapContent}>
      <ActivityIndicator size="large" color="#9FE870" />
      <Text style={styles.bootstrapTitle}>
        {syncing ? 'Entrando na sua conta...' : 'Preparando o app...'}
      </Text>
      <Text style={styles.bootstrapSubtitle}>
        Isso leva apenas alguns segundos.
      </Text>
    </View>
  </View>
);

const runPostLoginServicesInBackground = ({ updateFcmToken = false } = {}) => {
  void (async () => {
    try {
      const results = await Promise.allSettled([
        persistentRideNotificationService.initialize(),
        interactiveNotificationService.initialize(),
      ]);

      const failed = results.find(result => result.status === 'rejected');
      if (failed) {
        Logger.warn('⚠️ Erro ao inicializar serviços de notificação:', failed.reason);
      } else {
        Logger.log('✅ Serviços de notificação inicializados');
      }

      if (updateFcmToken) {
        const fcmToken = await AsyncStorage.getItem('fcmToken');
        if (fcmToken) {
          Logger.log('📱 Token FCM encontrado, atualizando perfil moderno:', fcmToken.substring(0, 20) + '...');

          await mobileProfileService.upsertCurrentProfile({
            fcmToken: fcmToken,
            pushToken: fcmToken,
            platform: Platform.OS,
            lastSeen: new Date().toISOString()
          });

          Logger.log('✅ Token FCM salvo no backend moderno');
        }
      }
    } catch (error) {
      Logger.warn('⚠️ Tarefa pós-login em background falhou:', error?.message || error);
    }
  })();
};


const AuthProvider = ({ children }) => {
  const { user, loading } = useAuth();
  const dispatch = useDispatch();
  const [isSyncing, setIsSyncing] = useState(false);
  const hasSynced = useRef(false);
  const lastSyncedUid = useRef(null);

  // ✅ Otimização: Memoizar função para evitar recriações desnecessárias
  const syncUserData = useCallback(async (firebaseUser) => {
    if (isSyncing || hasSynced.current) return; // Evitar múltiplas sincronizações

    setIsSyncing(true);
    try {
      Logger.log('🔄 Sincronizando dados do usuário na fonte moderna...');

      // 🚀 BYPASS PARA USUÁRIO DE TESTE - Permitir acesso total
      if (
        allowTestUserTools() &&
        firebaseUser.uid &&
        (firebaseUser.uid.includes('test-user-dev') || firebaseUser.uid.includes('test-customer-dev'))
      ) {
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

        runPostLoginServicesInBackground();

        hasSynced.current = true;
        setIsSyncing(false);
        Logger.log('✅ Usuário de teste sincronizado com bypass de permissões');
        return;
      }

      let cachedProfile = null;
      let testModeEnabled = false;
      try {
        const [[, storedUidValue], [, cachedProfileRaw], [, testModeValue]] =
          await AsyncStorage.multiGet([
            AUTH_UID_STORAGE_KEY,
            USER_DATA_STORAGE_KEY,
            TEST_MODE_STORAGE_KEY,
          ]);
        const storedUid = String(storedUidValue || '').trim();
        testModeEnabled = String(testModeValue || '').trim() === 'true';
        cachedProfile = cachedProfileRaw
          ? normalizePersistedProfile(JSON.parse(cachedProfileRaw))
          : null;

        if (!cachedProfile && storedUid) {
          const rebuiltQaProfile = await restoreQaSeedProfile({
            AsyncStorage,
            authUidKey: AUTH_UID_STORAGE_KEY,
            userDataKey: USER_DATA_STORAGE_KEY,
            driverActivationKey: `@prototype_driver_activation_${storedUid}`
          });

          if (rebuiltQaProfile?.uid) {
            cachedProfile = normalizePersistedProfile(rebuiltQaProfile);
            Logger.log('🧪 AuthProvider - perfil QA reconstruído do cache local:', {
              uid: cachedProfile.uid,
              usertype: cachedProfile.usertype || cachedProfile.userType || null
            });
          }
        }
      } catch (cacheError) {
        Logger.warn('⚠️ Erro ao restaurar perfil local no AuthProvider:', cacheError?.message || cacheError);
        await AsyncStorage.multiRemove([USER_DATA_STORAGE_KEY, AUTH_UID_STORAGE_KEY]);
      }

      const cachedProfileRole = resolveStoredProfileRole(cachedProfile);
      const firebaseUid = String(firebaseUser?.uid || '').trim();
      const firebasePhoneDigits = normalizePhoneDigits(firebaseUser?.phoneNumber);
      const cachedPhoneDigits = normalizePhoneDigits(
        cachedProfile?.phone ||
          cachedProfile?.mobile ||
          cachedProfile?.phoneNumber ||
          cachedProfile?.profile?.phone ||
          cachedProfile?.profile?.mobile ||
          cachedProfile?.profile?.phoneNumber
      );
      const cachedProfileMatchesFirebase =
        cachedProfile?.uid &&
        cachedProfileRole &&
        firebaseUid &&
        cachedProfile.uid === firebaseUid &&
        (!firebasePhoneDigits || !cachedPhoneDigits || cachedPhoneDigits === firebasePhoneDigits);

      const dispatchProfileUserData = async (profile, source) => {
        const completeUserData = buildCompleteUserDataFromProfile(firebaseUser, profile);
        if (!completeUserData) {
          return null;
        }

        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: completeUserData
        });

        await AsyncStorage.multiSet([
          [AUTH_UID_STORAGE_KEY, completeUserData.uid],
          [USER_DATA_STORAGE_KEY, JSON.stringify(completeUserData)]
        ]);

        Logger.log('✅ Usuário sincronizado no Redux via perfil:', {
          source,
          uid: completeUserData.uid,
          usertype: completeUserData.usertype || completeUserData.userType || null
        });

        return completeUserData;
      };

      const refreshCachedProfileInBackground = () => {
        void (async () => {
          try {
            const remoteProfile = await mobileProfileService.getCurrentProfile({ suppressErrors: true });
            const normalizedRemoteProfile = normalizePersistedProfile(remoteProfile);
            const remoteProfileRole = resolveStoredProfileRole(normalizedRemoteProfile);
            const remotePhoneDigits = normalizePhoneDigits(
              normalizedRemoteProfile?.phone ||
                normalizedRemoteProfile?.mobile ||
                normalizedRemoteProfile?.phoneNumber ||
                normalizedRemoteProfile?.profile?.phone ||
                normalizedRemoteProfile?.profile?.mobile ||
                normalizedRemoteProfile?.profile?.phoneNumber
            );
            const remoteMatchesFirebase =
              normalizedRemoteProfile?.uid &&
              remoteProfileRole &&
              normalizedRemoteProfile.uid === firebaseUid &&
              (!firebasePhoneDigits || !remotePhoneDigits || remotePhoneDigits === firebasePhoneDigits);

            if (remoteMatchesFirebase) {
              await dispatchProfileUserData(normalizedRemoteProfile, 'remote-refresh');
              Logger.log('✅ Perfil remoto atualizado em background após cache local');
            }
          } catch (remoteRefreshError) {
            Logger.warn(
              '⚠️ Atualização remota em background do perfil falhou:',
              remoteRefreshError?.message || remoteRefreshError
            );
          }
        })();
      };

      if (
        testModeEnabled &&
        cachedProfile?.uid &&
        cachedProfileRole &&
        firebaseUid &&
        cachedProfile.uid !== firebaseUid
      ) {
        Logger.warn('🧪 AuthProvider - sessão Firebase divergente do perfil QA semeado; priorizando cache local do simulador', {
          firebaseUid,
          seededUid: cachedProfile.uid,
          seededRole: cachedProfileRole,
        });

        const seededUserData = buildCompleteUserDataFromProfile(firebaseUser, cachedProfile);
        if (seededUserData) {
          dispatch({
            type: FETCH_USER_SUCCESS,
            payload: seededUserData
          });
          await AsyncStorage.multiSet([
            [AUTH_UID_STORAGE_KEY, seededUserData.uid],
            [USER_DATA_STORAGE_KEY, JSON.stringify(seededUserData)]
          ]);
          hasSynced.current = true;
          setIsSyncing(false);
          return;
        }
      }

      if (cachedProfileMatchesFirebase) {
        const cachedUserData = await dispatchProfileUserData(cachedProfile, 'local-cache');
        if (cachedUserData) {
          hasSynced.current = true;
          setIsSyncing(false);
          runPostLoginServicesInBackground({ updateFcmToken: true });
          refreshCachedProfileInBackground();
          return;
        }
      }

      const remoteProfile = await mobileProfileService.getCurrentProfile({ suppressErrors: true });
      const normalizedRemoteProfile = normalizePersistedProfile(remoteProfile);
      const remoteProfileRole = resolveStoredProfileRole(normalizedRemoteProfile);
      const shouldPreferCachedProfile =
        testModeEnabled &&
        cachedProfile?.uid &&
        cachedProfileRole &&
        (!normalizedRemoteProfile?.uid ||
          normalizedRemoteProfile.uid !== cachedProfile.uid ||
          (remoteProfileRole && remoteProfileRole !== cachedProfileRole));

      const userData = shouldPreferCachedProfile
        ? cachedProfile
        : normalizedRemoteProfile || cachedProfile;

      const userDataRole = resolveStoredProfileRole(userData);

      if (userData?.uid && userDataRole) {
        Logger.log('✅ Dados encontrados na fonte moderna:', {
          uid: userData.uid,
          usertype: userDataRole
        });

        // Criar payload completo com dados do Firebase Auth + perfil moderno
        const completeUserData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || userData.email,
          phoneNumber: firebaseUser.phoneNumber || userData.mobile || userData.phoneNumber,
          phone: firebaseUser.phoneNumber || userData.phone || userData.mobile || userData.phoneNumber,
          // Dados do perfil moderno
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          usertype: userDataRole,
          userType: userDataRole,
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
            usertype: userDataRole,
            userType: userDataRole,
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
        await AsyncStorage.multiSet([
          [AUTH_UID_STORAGE_KEY, firebaseUser.uid],
          [USER_DATA_STORAGE_KEY, JSON.stringify(completeUserData)]
        ]);

        Logger.log('✅ Usuário sincronizado com sucesso no Redux');

        runPostLoginServicesInBackground({ updateFcmToken: true });
        hasSynced.current = true;
      } else {
        Logger.log('⚠️ Usuário não encontrado na fonte moderna - NÃO criando perfil básico');
        Logger.log('⚠️ Deixando AppCommon controlar o fluxo de onboarding');

        // NÃO criar perfil básico - deixar AppCommon controlar
        // hasSynced.current = false; // Manter como não sincronizado

        // Dispatch de dados mínimos SEM usertype
        const minimalUserData = {
          ...buildIncompleteOnboardingProfile(firebaseUser),
          profile: {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            phoneNumber: firebaseUser.phoneNumber,
            // NÃO definir usertype aqui
          }
        };

        await persistPhoneValidatedOnboardingSession(minimalUserData);

        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: minimalUserData
        });

        // Evita loop infinito de "recuperando dados da conta" quando perfil moderno ainda não existe.
        hasSynced.current = true;
      }

    } catch (error) {
      Logger.error('❌ Erro ao sincronizar dados do usuário:', error);

      // Em caso de erro, usar dados mínimos SEM usertype
      const fallbackUserData = {
        ...buildIncompleteOnboardingProfile(firebaseUser),
        profile: {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          phoneNumber: firebaseUser.phoneNumber,
          // NÃO definir usertype aqui
        }
      };

      await persistPhoneValidatedOnboardingSession(fallbackUserData);

      dispatch({
        type: FETCH_USER_SUCCESS,
        payload: fallbackUserData
      });

      // Evita retrigger infinito de sincronização em caso de falha transitória do backend.
      hasSynced.current = true;
    } finally {
      setIsSyncing(false);
    }
  }, [dispatch, isSyncing]);

  useEffect(() => {
    const currentUid = user?.uid || null;
    if (currentUid !== lastSyncedUid.current) {
      hasSynced.current = false;
      lastSyncedUid.current = currentUid;
    }
  }, [user?.uid]);

  useEffect(() => {
    if (user && !loading && !hasSynced.current) {
      // Usuário autenticado no Firebase, sincronizar dados completos apenas uma vez
      syncUserData(user);
    }
  }, [user, loading, syncUserData]);

  const shouldRenderBootstrapShell = loading || (Boolean(user) && isSyncing);

  if (shouldRenderBootstrapShell) {
    return <AuthBootstrapShell syncing={Boolean(user) && isSyncing} />;
  }

  return children;
};

const styles = StyleSheet.create({
  bootstrapContainer: {
    flex: 1,
    backgroundColor: '#041007',
  },
  bootstrapContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  bootstrapTitle: {
    marginTop: 16,
    color: '#F5F7F7',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  bootstrapSubtitle: {
    marginTop: 6,
    color: 'rgba(245, 247, 247, 0.82)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});

export default AuthProvider; 
