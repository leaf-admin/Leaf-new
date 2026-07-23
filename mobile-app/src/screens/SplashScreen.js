import Logger from '../utils/Logger';
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, StatusBar, Animated, Text, ActivityIndicator, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseAuth from '@react-native-firebase/auth';
import { useDispatch, useSelector } from 'react-redux';
import { FETCH_USER_SUCCESS } from '../state/actionTypes';
import { useOnboardingPersistence } from '../hooks/useOnboardingPersistence';
import AuthFlow from '../components/auth/AuthFlow';
import { restoreQaSeedProfile } from '../utils/qaSeedProfile';
import { PROFILE_SELECTION_STEP_INDEX } from '../utils/onboardingSessionState';
import { fonts } from '../theme/runtimeTokens';
import {
  allowTestUserTools,
  isE2ETestBuild,
  isSimulatorBuild,
} from '../config/runtimeAccessPolicy';
import {
  isPersistedProfileOnboardingComplete,
  isProfileIdentityConsistent,
} from '../components/auth/authFlowRecovery';

const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';

const normalizePersistedProfile = (profile) => {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const uid = String(profile.uid || '').trim();
  if (!uid) {
    return null;
  }

  const userTypeCandidate =
    profile.usertype ||
    profile.userType ||
    profile?.profile?.usertype ||
    profile?.profile?.userType ||
    null;
  const normalizedUserType = userTypeCandidate === 'passenger' ? 'customer' : userTypeCandidate;

  return {
    ...profile,
    uid,
    ...(normalizedUserType ? { usertype: normalizedUserType, userType: normalizedUserType } : {})
  };
};

const resolveInitialStep = (completedSteps = []) => {
  if (completedSteps.includes('credentials') || completedSteps.includes('document_data')) {
    return 5;
  }
  if (completedSteps.includes('profile_data')) {
    return 4;
  }
  if (completedSteps.includes('profile_selection')) {
    return 3;
  }
  if (completedSteps.includes('phone_validation')) {
    return 2;
  }
  return 0;
};

const buildOnboardingPayload = (progress = {}) => {
  const completed = Object.keys(progress || {}).filter(key => progress[key]);
  return {
    step: resolveInitialStep(completed),
    completed
  };
};

const buildIncompleteProfileOnboardingPayload = (profile, progress = {}) => {
  const payload = buildOnboardingPayload(progress);
  const hasValidatedPhoneSession = Boolean(profile?.uid);

  if (
    hasValidatedPhoneSession &&
    !payload.completed.includes('phone_validation')
  ) {
    return {
      step: Math.max(payload.step, PROFILE_SELECTION_STEP_INDEX),
      completed: [...payload.completed, 'phone_validation']
    };
  }

  return payload;
};

export default function SplashScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const loadingOpacity = useRef(new Animated.Value(0)).current;
  const dispatch = useDispatch();

  // Estados para controle da verificação
  const [isChecking, setIsChecking] = useState(true);
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState(null);

  // Redux e hooks
  const auth = useSelector(state => state.auth);
  const { onboarding, isLoaded } = useOnboardingPersistence();

  // Verificar status do usuário nos bastidores
  useEffect(() => {
    if (!isChecking) {
      return;
    }

    let isCancelled = false;
    let bootTimeoutId = null;
    let onboardingLoadTimeoutId = null;

    const checkUserStatus = async () => {
      // ✅ Timeout de 5s para verificação de usuário (Item 1.3)
      bootTimeoutId = setTimeout(() => {
        if (isCancelled) {
          return;
        }

        Logger.warn('SplashScreen - ⏰ Timeout na verificação de usuário, permitindo acesso ao app');
        // Permitir app abrir mesmo sem verificação completa
        setOnboardingProgress({ step: 0, completed: [] });
        setShouldShowOnboarding(true);
        setIsChecking(false);
      }, 5000);

      try {
        Logger.log('SplashScreen - 🔍 Verificando status do usuário nos bastidores...');

        const nativeFirebaseUser = firebaseAuth().currentUser;
        const nativeFirebaseUid = String(nativeFirebaseUser?.uid || '').trim();
        let resolvedProfile = auth.profile && auth.profile.uid ? auth.profile : null;
        const canRestoreQaSeed =
          allowTestUserTools() && isSimulatorBuild() && isE2ETestBuild();

        if (
          resolvedProfile &&
          !isProfileIdentityConsistent({
            profile: resolvedProfile,
            firebaseUser: nativeFirebaseUser,
          }) &&
          !canRestoreQaSeed
        ) {
          Logger.warn('SplashScreen - perfil Redux divergente da sessão Firebase ignorado');
          resolvedProfile = null;
        }

        if (!resolvedProfile) {
          try {
            const [storedUserDataRaw, storedUidRaw] = await AsyncStorage.multiGet([
              USER_DATA_STORAGE_KEY,
              AUTH_UID_STORAGE_KEY
            ]);
            const storedUserData = storedUserDataRaw?.[1];
            const storedUid = String(storedUidRaw?.[1] || '').trim();

            if (storedUserData) {
              try {
                const parsedProfile = JSON.parse(storedUserData);
                const normalizedProfile = normalizePersistedProfile(parsedProfile);
                const localProfileMatchesFirebase = isProfileIdentityConsistent({
                  profile: normalizedProfile,
                  firebaseUser: nativeFirebaseUser,
                  storedUid,
                });
                if (normalizedProfile?.uid && (localProfileMatchesFirebase || canRestoreQaSeed)) {
                  resolvedProfile = normalizedProfile;
                  dispatch({
                    type: FETCH_USER_SUCCESS,
                    payload: normalizedProfile
                  });
                  Logger.log('SplashScreen - ♻️ Sessão restaurada do AsyncStorage:', {
                    uid: normalizedProfile.uid,
                    usertype: normalizedProfile.usertype || normalizedProfile.userType || null
                  });
                }
                if (!resolvedProfile && storedUid && canRestoreQaSeed) {
                  const rebuiltQaProfile = await restoreQaSeedProfile({
                    AsyncStorage,
                    authUidKey: AUTH_UID_STORAGE_KEY,
                    userDataKey: USER_DATA_STORAGE_KEY,
                    driverActivationKey: `@prototype_driver_activation_${storedUid}`
                  });

                  if (rebuiltQaProfile?.uid) {
                    resolvedProfile = normalizePersistedProfile(rebuiltQaProfile);
                    dispatch({
                      type: FETCH_USER_SUCCESS,
                      payload: resolvedProfile
                    });
                    Logger.log('SplashScreen - 🧪 Perfil QA reconstruído do UID persistido:', {
                      uid: resolvedProfile.uid,
                      usertype: resolvedProfile.usertype || resolvedProfile.userType || null
                    });
                  }
                }
              } catch (parseError) {
                Logger.warn('SplashScreen - ⚠️ @user_data inválido, limpando cache local');
                const rebuiltQaProfile = storedUid && canRestoreQaSeed
                  ? await restoreQaSeedProfile({
                      AsyncStorage,
                      authUidKey: AUTH_UID_STORAGE_KEY,
                      userDataKey: USER_DATA_STORAGE_KEY,
                      driverActivationKey: `@prototype_driver_activation_${storedUid}`
                    })
                  : null;

                if (rebuiltQaProfile?.uid) {
                  resolvedProfile = normalizePersistedProfile(rebuiltQaProfile);
                  dispatch({
                    type: FETCH_USER_SUCCESS,
                    payload: resolvedProfile
                  });
                  Logger.log('SplashScreen - 🧪 Cache QA reconstruído após parse inválido:', {
                    uid: resolvedProfile.uid,
                    usertype: resolvedProfile.usertype || resolvedProfile.userType || null
                  });
                } else {
                  await AsyncStorage.multiRemove([USER_DATA_STORAGE_KEY]);
                }
              }
            } else if (storedUid) {
              const rebuiltQaProfile = canRestoreQaSeed
                ? await restoreQaSeedProfile({
                    AsyncStorage,
                    authUidKey: AUTH_UID_STORAGE_KEY,
                    userDataKey: USER_DATA_STORAGE_KEY,
                    driverActivationKey: `@prototype_driver_activation_${storedUid}`
                  })
                : null;

              if (rebuiltQaProfile?.uid) {
                resolvedProfile = normalizePersistedProfile(rebuiltQaProfile);
                dispatch({
                  type: FETCH_USER_SUCCESS,
                  payload: resolvedProfile
                });
                Logger.log('SplashScreen - 🧪 Perfil QA reconstruído sem @user_data:', {
                  uid: resolvedProfile.uid,
                  usertype: resolvedProfile.usertype || resolvedProfile.userType || null
                });
              } else {
                Logger.log('SplashScreen - ℹ️ UID persistido encontrado sem perfil completo:', storedUid);
              }
            }
          } catch (storageError) {
            Logger.warn('SplashScreen - ⚠️ Falha ao restaurar sessão local:', storageError?.message || storageError);
          }
        }

        if (!resolvedProfile && nativeFirebaseUid) {
          resolvedProfile = {
            uid: nativeFirebaseUid,
            phoneNumber: nativeFirebaseUser?.phoneNumber || null,
            profileIncomplete: true,
            onboardingPending: true,
          };
        }

        const hasAnyAuthSession = Boolean(
          nativeFirebaseUid &&
          resolvedProfile?.uid &&
          (
            isProfileIdentityConsistent({
              profile: resolvedProfile,
              firebaseUser: nativeFirebaseUser,
            }) ||
            canRestoreQaSeed
          )
        );
        Logger.log('SplashScreen - 🔐 Sessão autenticada disponível?', hasAnyAuthSession);

        // Se não está autenticado, mostrar onboarding
        if (!hasAnyAuthSession) {
          clearTimeout(bootTimeoutId);
          if (isCancelled) {
            return;
          }
          Logger.log('SplashScreen - 🔐 Usuário não autenticado, preparando onboarding');
          setShouldShowOnboarding(true);
          setOnboardingProgress({ step: 0, completed: [] });
          setIsChecking(false);
          return;
        }
        
        // Aguardar dados do onboarding serem carregados (apenas para usuários autenticados)
        if (!isLoaded()) {
          Logger.log('SplashScreen - ⏳ Aguardando carregamento dos dados...');
          // Timeout de 1 segundo (reduzido)
          onboardingLoadTimeoutId = setTimeout(() => {
            if (isCancelled) {
              return;
            }

            if (!isLoaded()) {
              clearTimeout(bootTimeoutId);
              Logger.log('SplashScreen - ⏰ Timeout no carregamento, preparando onboarding');
              setOnboardingProgress(buildIncompleteProfileOnboardingPayload(
                resolvedProfile,
                onboarding.progress || {}
              ));
              setShouldShowOnboarding(true);
              setIsChecking(false);
            }
          }, 1000);
          return;
        }

        // Verificar se o usuário tem dados completos no Realtime Database
        const hasCompleteProfile = isPersistedProfileOnboardingComplete(resolvedProfile);
        Logger.log('SplashScreen - 📊 Perfil completo no Realtime Database?', !!hasCompleteProfile);

        clearTimeout(bootTimeoutId);
        if (isCancelled) {
          return;
        }

        if (hasCompleteProfile) {
          // ✅ SITUAÇÃO 1: Usuário completo - ir para NewMapScreen
          Logger.log('SplashScreen - ✅ Usuário completo, navegando para Map');
          setShouldShowOnboarding(false);
          setIsChecking(false);
          
          // Navegar para Map após transição curta
          // ✅ Verificar se o navigator está pronto antes de navegar
          setTimeout(() => {
            if (navigation.isReady && navigation.isReady()) {
              navigation.replace('Map');
            } else {
              // Se não estiver pronto, tentar novamente após um delay
              setTimeout(() => {
                if (navigation.replace) {
                  navigation.replace('Map');
                }
              }, 1000);
            }
          }, 220);
          return;
        } else {
          // 🔄 SITUAÇÃO 2: Usuário autenticado mas incompleto - continuar onboarding
          Logger.log('SplashScreen - 🔄 Usuário autenticado mas incompleto, preparando onboarding');

          const progressPayload = buildIncompleteProfileOnboardingPayload(
            resolvedProfile,
            onboarding.progress || {}
          );
          setOnboardingProgress(progressPayload);
          
          setShouldShowOnboarding(true);
          setIsChecking(false);
          return;
        }
      } catch (error) {
        clearTimeout(bootTimeoutId);
        if (isCancelled) {
          return;
        }
        Logger.error('SplashScreen - ❌ Erro ao verificar status:', error);
        // Em caso de erro, mostrar onboarding (app sempre abre)
        setOnboardingProgress({ step: 0, completed: [] });
        setShouldShowOnboarding(true);
        setIsChecking(false);
      }
    };

    // Executar verificação imediatamente
    checkUserStatus();

    return () => {
      isCancelled = true;
      clearTimeout(bootTimeoutId);
      clearTimeout(onboardingLoadTimeoutId);
    };
  }, [auth.profile, navigation, isChecking, dispatch, onboarding.isLoaded, onboarding.progress, isLoaded]);

  useEffect(() => {
    // Animação simples e rápida
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Mostrar loading imediatamente
    Animated.timing(loadingOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, scaleAnim, loadingOpacity]);

  // Se deve mostrar onboarding, renderizar AuthFlow
  if (shouldShowOnboarding) {
    return (
      <AuthFlow
        visible={true}
        onComplete={async (authData) => {
          Logger.log('SplashScreen - ✅ Onboarding completado:', authData);
          const completionProfile = normalizePersistedProfile(
            authData?.persistedProfile ||
            authData?.user ||
            authData
          );

          if (completionProfile?.uid) {
            dispatch({
              type: FETCH_USER_SUCCESS,
              payload: completionProfile
            });
            try {
              await AsyncStorage.multiSet([
                [USER_DATA_STORAGE_KEY, JSON.stringify(completionProfile)],
                [AUTH_UID_STORAGE_KEY, completionProfile.uid]
              ]);
            } catch (error) {
              Logger.warn('SplashScreen - ⚠️ Falha ao persistir sessão após onboarding:', error?.message || error);
            }
          }

          // Navegar para a tela principal após onboarding completo
          // ✅ Verificar se o navigator está pronto antes de navegar
          if (navigation.isReady && navigation.isReady()) {
            navigation.replace('Map');
          } else {
            setTimeout(() => {
              if (navigation.replace) {
                navigation.replace('Map');
              }
            }, 500);
          }
        }}
        onClose={() => {
          Logger.log('SplashScreen - ❌ Onboarding fechado');
        }}
        onboardingProgress={onboardingProgress}
      />
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}> 
      <StatusBar backgroundColor="#003002" barStyle="light-content" />
      <Image
        source={require('../../assets/images/splash.png')}
        style={styles.splashImage}
        resizeMode="cover"
      />
      <Animated.View style={[styles.loadingContainer, { opacity: loadingOpacity }]}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Carregando...</Text>
      </Animated.View>
    </Animated.View>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#003002',
  },
  splashImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width,
    height: height,
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
    fontFamily: fonts.Medium,
  },
}); 
