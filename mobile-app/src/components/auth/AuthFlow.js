import Logger from '../../utils/Logger';
import React, { useState, useCallback } from 'react';
import { StatusBar, View, StyleSheet, ImageBackground, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FETCH_USER_SUCCESS } from '../../state/actionTypes';
import store from '../../state/appStore';
import { saveStepData, completeStep, saveCurrentStep, loadStepData } from '../../utils/secureOnboardingStorage';
import testUserService from '../../services/TestUserService';
import UserAuthService from '../../services/UserAuthService';
import UserDatabaseService from '../../utils/userDatabaseService';
import { createInitialDriverOnboardingState } from '../../services/DriverOnboardingService';
import { allowReviewAccess } from '../../config/runtimeAccessPolicy';
import onboardingTheme from './common/onboardingTheme';
import {
  buildRestoredAuthFlowData,
  normalizeAuthFlowProfileData,
  normalizeAuthFlowUserType,
  resolveAuthFlowInitialStep,
} from './authFlowRecovery';

const { color, radius } = onboardingTheme;
const onboardingBackground = require('../../../assets/images/onboarding-city-bg-auth.png');
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';

const ONBOARDING_AB_VARIANTS = {
  A: {
    backgroundTint: 'rgba(244,247,250,0.64)',
    softMask: 'rgba(255,255,255,0.12)',
    frameBorder: 'rgba(255,255,255,0.76)',
    frameBackground: 'rgba(255,255,255,0.86)',
    frameShadowOpacity: 0.22,
    frameShadowRadius: 28,
    frameElevation: 14
  },
  B: {
    backgroundTint: 'rgba(214,224,236,0.34)',
    softMask: 'rgba(255,255,255,0.04)',
    frameBorder: 'rgba(255,255,255,0.86)',
    frameBackground: 'rgba(255,255,255,0.76)',
    frameShadowOpacity: 0.24,
    frameShadowRadius: 28,
    frameElevation: 14
  },
  ANDROID: {
    backgroundTint: 'rgba(255,255,255,0.14)',
    softMask: 'rgba(255,255,255,0.02)',
    frameBorder: 'rgba(255,255,255,0.90)',
    frameBackground: 'rgba(255,255,255,0.72)',
    frameShadowOpacity: 0.16,
    frameShadowRadius: 22,
    frameElevation: 10
  }
};

// Steps de autenticação
import PhoneInputStep from './steps/PhoneInputStep';
import OTPStep from './steps/OTPStep';
import PasswordLoginStep from './steps/PasswordLoginStep';
import ForgotPasswordStep from './steps/ForgotPasswordStep';
import ProfileSelectionStep from './steps/ProfileSelectionStep';
import ProfileDataStep from './steps/ProfileDataStep';
import DocumentStep from './steps/DocumentStep';
import CredentialsStep from './steps/CredentialsStep';
import DriverEmailStep from './steps/DriverEmailStep';
import onboardingBackgroundDataUri from './common/onboardingBackgroundDataUri';

const AuthFlow = ({ visible, onComplete, onClose, onboardingProgress }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [authData, setAuthData] = useState({});
  const [authMode, setAuthMode] = useState('phone');
  const isReviewEnv = allowReviewAccess();

  const persistAuthenticatedProfile = useCallback(async (profile, fallbackUserType = null) => {
    try {
      const uid = String(profile?.uid || profile?.user?.uid || '').trim();
      if (!uid) {
        return null;
      }

      const rawUserType =
        profile?.usertype ||
        profile?.userType ||
        profile?.profile?.usertype ||
        profile?.profile?.userType ||
        fallbackUserType ||
        null;
      const normalizedUserType = rawUserType ? normalizeAuthFlowUserType(rawUserType) : null;

      const normalizedProfile = {
        ...profile,
        uid,
        ...(normalizedUserType ? { usertype: normalizedUserType, userType: normalizedUserType } : {})
      };

      await AsyncStorage.multiSet([
        [AUTH_UID_STORAGE_KEY, uid],
        [USER_DATA_STORAGE_KEY, JSON.stringify(normalizedProfile)]
      ]);

      return normalizedProfile;
    } catch (error) {
      Logger.warn('⚠️ AuthFlow - Falha ao persistir sessão local:', error?.message || error);
      return null;
    }
  }, []);

  // 🔍 DETERMINAR STEP INICIAL BASEADO NO PROGRESSO E CARREGAR DADOS SALVOS
  React.useEffect(() => {
    let isMounted = true;

    const initializeStep = async () => {
      try {
        let completedSteps = [];
        let fallbackStep = 0;

        if (onboardingProgress && Array.isArray(onboardingProgress.completed)) {
          completedSteps = onboardingProgress.completed;
          fallbackStep = onboardingProgress.step || 0;
          Logger.log('AuthFlow - 🔍 Progresso recebido por prop:', onboardingProgress);
        } else {
          Logger.log('AuthFlow - 🧭 Iniciando fluxo do zero (ordem padrão do onboarding)');
        }

        let resolvedUserType = null;
        if (completedSteps.includes('profile_selection')) {
          const profileSelectionData = await loadStepData('profile_selection');
          resolvedUserType = normalizeAuthFlowUserType(profileSelectionData?.userType);
        }

        const initialStep = resolveAuthFlowInitialStep(
          completedSteps,
          fallbackStep,
          resolvedUserType,
        );
        if (!isMounted) {
          return;
        }

        setCurrentStep(initialStep);
        await saveCurrentStep(initialStep);
        Logger.log('AuthFlow - 🔄 Step inicial definido:', initialStep);

        const phoneData = completedSteps.includes('phone_validation')
          ? await loadStepData('phone_validation')
          : null;
        const profileSelectionData = completedSteps.includes('profile_selection')
          ? await loadStepData('profile_selection')
          : null;
        const profileData = completedSteps.includes('profile_data')
          ? await loadStepData('profile_data')
          : null;
        const documentData = completedSteps.includes('document_data')
          ? await loadStepData('document_data')
          : null;
        const driverContactData = completedSteps.includes('driver_contact')
          ? await loadStepData('driver_contact')
          : null;

        Logger.log('📱 Dados do telefone carregados:', phoneData);
        Logger.log('👤 Dados da seleção de perfil carregados:', profileSelectionData);
        Logger.log('📝 Dados pessoais carregados:', profileData);
        Logger.log('📄 Dados de documentos carregados:', documentData);

        const savedData = buildRestoredAuthFlowData({
          completedSteps,
          phoneData,
          profileSelectionData,
          profileData,
          documentData,
          driverContactData,
        });

        // Aplicar dados carregados
        if (isMounted && Object.keys(savedData).length > 0) {
          setAuthData(prev => ({ ...prev, ...savedData }));
          Logger.log('AuthFlow - 📥 Dados salvos carregados e processados:', savedData);
        }
      } catch (error) {
        Logger.error('AuthFlow - ❌ Erro ao inicializar progresso salvo:', error);
      }
    };

    initializeStep();

    return () => {
      isMounted = false;
    };
  }, [onboardingProgress]);

  // Função para obter o nome do step baseado no índice
  const getStepNameByIndex = useCallback((index) => {
    switch (index) {
      case 0: return 'phone_validation';
      case 1: return 'phone_validation'; // OTP é parte da validação do telefone
      case 2: return 'profile_selection';
      case 3: return 'profile_data';
      case 4: return 'document_data';
      case 5: return 'credentials';
      case 6: return 'driver_contact';
      default: return null;
    }
  }, []);

  // Função para avançar para o próximo step
  const goToNextStep = useCallback(async () => {
    const currentStepName = getStepNameByIndex(currentStep);
    if (currentStepName) {
      // Marcar step atual como completo
      await completeStep(currentStepName);
    }

    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    await saveCurrentStep(nextStep);
  }, [currentStep]);

  // Função para voltar ao step anterior
  const goToPreviousStep = useCallback(async () => {
    const isDriver = normalizeAuthFlowUserType(authData?.profileSelection?.userType) === 'driver';
    let prevStep = Math.max(0, currentStep - 1);

    // Fluxo motorista: pula o step de nome manual
    if (isDriver && currentStep === 4) {
      prevStep = 2;
    }

    setCurrentStep(prevStep);
    await saveCurrentStep(prevStep);
  }, [currentStep, authData?.profileSelection?.userType]);

  // Função para salvar dados do step atual
  const saveStepDataLocal = useCallback(async (data) => {
    // Salvar no estado local
    setAuthData(prev => ({ ...prev, ...data }));

    // Salvar no AsyncStorage
    const stepName = getStepNameByIndex(currentStep);
    if (stepName) {
      await saveStepData(stepName, data);
    }
  }, [currentStep]);

  // Função para lidar com a verificação do OTP (precisa estar antes de handlePhoneVerificationSent)
  const handleOTPVerified = useCallback(async (user) => {
    // ✅ REVIEW ACCESS: Verificar se é conta de review (pula OTP)
    if (user && user.isReviewAccount && isReviewEnv) {
      const phoneNumber = authData.phoneNumber || user.phoneNumber;
      const userType = user.userType || 'customer'; // ✅ CORRIGIDO: projeto usa 'customer', não 'passenger'

      Logger.log('🔐 REVIEW ACCESS: Processando login de conta de review', {
        phoneNumber,
        userType,
        authMethod: 'review_access'
      });

      try {
        // Criar dados do usuário de review
        const reviewUserData = {
          phoneNumber: phoneNumber,
          user: {
            ...user,
            uid: user.uid,
            usertype: userType,
            userType: userType,
            isReviewAccount: true
          },
          profileSelection: {
            userType: userType,
            timestamp: new Date().toISOString()
          },
          phoneValidated: true,
          isReviewAccount: true,
          authMethod: 'review_access',
          usertype: userType,
          userType: userType
        };

        await saveStepDataLocal(reviewUserData);
        await completeStep('phone_validation');
        await completeStep('profile_selection');

        // ✅ CRÍTICO: SIMULAR AUTENTICAÇÃO PARA USUÁRIOS DE REVIEW
        // Como é review, vamos apenas marcar como "autenticado" sem Firebase real
        try {
          // Criar um usuário simulado para o contexto do app
          const mockUser = {
            uid: `review-${userType}-${Date.now()}`,
            phoneNumber: phoneNumber,
            displayName: `Review ${userType}`,
            email: `review-${userType}@leaf.app`,
            isReviewAccount: true
          };

          Logger.log('🔐 REVIEW ACCESS: Usuário simulado criado:', mockUser.uid);

          const reviewAuthPayload = {
            ...reviewUserData.user,
            ...mockUser,
            phoneNumber: phoneNumber,
            usertype: userType,
            userType: userType,
            authenticated: true
          };
          const persistedReviewPayload =
            await persistAuthenticatedProfile(reviewAuthPayload, userType) || reviewAuthPayload;

          // Atualizar Redux com usuário simulado
          store.dispatch({
            type: FETCH_USER_SUCCESS,
            payload: persistedReviewPayload
          });

          Logger.log('✅ REVIEW ACCESS: Redux atualizado com usuário simulado');

          // Também atualizar o estado de autenticação global
          store.dispatch({
            type: 'SET_AUTH_STATUS',
            payload: { authenticated: true, user: mockUser }
          });

        } catch (error) {
          Logger.warn('⚠️ REVIEW ACCESS: Erro na simulação (continuando):', error.message);
        }

        Logger.log('✅ REVIEW ACCESS: Login de review concluído com sucesso');

        if (onComplete) {
          onComplete(reviewUserData);
        }
        return;
      } catch (error) {
        Logger.error('❌ Erro no login de review:', error);
        // Continuar com fluxo normal em caso de erro
      }
    }

    // Compatibilidade de usuário de teste restrita a ambiente controlado
    if (user && user.isTestUser && testUserService.isTestMode()) {
      const phoneNumber = authData.phoneNumber || user.phoneNumber;
      const isCustomer = user.isTestCustomer || user.userType === 'customer';
      const userType = isCustomer ? 'customer' : 'driver';

      Logger.log('🚀 BYPASS: Criando usuário de teste completo após OTP...', { isCustomer, userType, phoneNumber });

      try {
        // Criar usuário de teste no banco de dados
        let testUserData;
        if (isCustomer) {
          // Extrair apenas o número do telefone (sem +55)
          const phoneNumberOnly = phoneNumber ? phoneNumber.replace('+55', '') : '11888888888';
          testUserData = await testUserService.createTestCustomer(phoneNumberOnly);
        } else {
          // Para drivers, usar createTestUser
          testUserData = await testUserService.createTestUser({
            uid: user.uid,
            phoneNumber: phoneNumber,
            phone: phoneNumber,
            usertype: 'driver',
            userType: 'driver',
            name: 'Driver de Teste',
            firstName: 'Driver',
            lastName: 'de Teste',
            email: 'test@leafapp.com',
            isTestUser: true,
            isTestCustomer: false
          });
        }

        if (testUserData) {
          const testUserDataComplete = {
            phoneNumber: phoneNumber,
            user: {
              ...user,
              uid: testUserData.uid,
              usertype: userType,
              userType: userType
            },
            profileSelection: {
              userType: userType,
              timestamp: new Date().toISOString()
            },
            profileData: {
              fullName: `${testUserData.firstName || 'Teste'} ${testUserData.lastName || 'Usuário'}`.trim(),
              firstName: testUserData.firstName || 'Teste',
              lastName: testUserData.lastName || 'Usuário'
            },
            documentData: {
              cpf: testUserData.cpf || '',
              email: testUserData.email || 'test@leafapp.com'
            },
            credentials: {
              acceptTerms: true,
              acceptPrivacy: true,
              consentBackgroundCheck: !isCustomer,
              marketingOptIn: false
            },
            ...(!isCustomer ? { driverActivation: createInitialDriverOnboardingState() } : {}),
            phoneValidated: true,
            cnhUploaded: !isCustomer,
            isTestUser: true,
            isTestCustomer: isCustomer,
            ...testUserData,
            usertype: userType,
            userType: userType
          };

          await saveStepDataLocal(testUserDataComplete);
          await completeStep('phone_validation');
          await completeStep('profile_selection');
          await completeStep('profile_data');
          await completeStep('document_data');
          await completeStep('credentials');

          // ✅ CRÍTICO: Atualizar Redux antes de chamar onComplete
          // O AppNavigator depende do Redux para redirecionar automaticamente
          try {
            const testAuthPayload = {
              ...testUserDataComplete.user,
              phoneNumber: phoneNumber,
              usertype: userType,
              userType: userType
            };
            const persistedTestPayload =
              await persistAuthenticatedProfile(testAuthPayload, userType) || testAuthPayload;

            store.dispatch({
              type: FETCH_USER_SUCCESS,
              payload: persistedTestPayload
            });
            Logger.log('✅ Redux atualizado com dados de usuário de teste');
          } catch (reduxError) {
            Logger.error('❌ Erro ao atualizar Redux:', reduxError);
          }

          Logger.log(`✅ Usuário de teste ${isCustomer ? 'customer' : 'driver'} criado com sucesso!`);

          if (onComplete) {
            onComplete(testUserDataComplete);
          }
          return;
        }
      } catch (error) {
        Logger.error('❌ Erro no bypass de usuário de teste:', error);
        // Continuar com fluxo normal em caso de erro
      }
    }

    // Fluxo normal (não é usuário de teste nem review)
    await saveStepDataLocal({ user });
    await completeStep('phone_validation');
    goToNextStep();
  }, [authData, saveStepDataLocal, completeStep, goToNextStep, onComplete]);

  // Função para lidar com o envio do telefone
  const handlePhoneVerificationSent = useCallback(async (confirmation, phoneNumber, isExistingUser = false, skipOTP = false) => {
    // ✅ CRÍTICO: REVIEW ACCESS - Bypass apenas permitido em ambiente de review
    // App Store compliance: OTP não pode ser pulado fora do ambiente de review
    // Verificação em múltiplas camadas para segurança
    const canBypass = skipOTP &&
      isReviewEnv &&
      confirmation &&
      confirmation.isReviewAccount &&
      confirmation.reviewUser;

    if (canBypass) {
      Logger.log('🔐 REVIEW ACCESS: Pulando OTP e fazendo login direto', {
        phoneNumber,
        userType: confirmation.reviewUser.userType,
        isReviewEnv,
        isDev: __DEV__,
        skipOTP: skipOTP
      });

      // Chamar handleOTPVerified diretamente com o usuário de review
      await handleOTPVerified(confirmation.reviewUser);
      return;
    } else if (skipOTP && !isReviewEnv) {
      // ✅ Bloquear bypass em produção
      Logger.error('🚫 Tentativa de bypass bloqueada: ambiente de produção', {
        phoneNumber,
        isReviewEnv,
        isDev: __DEV__
      });
      // Continuar com fluxo normal de OTP
    }

      // ✅ Fluxo normal: Mostrar tela de OTP
      setAuthMode('otp');
      await saveStepDataLocal({ phoneNumber, confirmation, isExistingUser });
    // Marcar telefone como validado
    await completeStep('phone_validation');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep, handleOTPVerified]);

  const handlePasswordLoginRequested = useCallback(async (phoneNumber) => {
    const normalizedPhone = UserAuthService.normalizePhone(phoneNumber);
    setAuthData(prev => ({ ...prev, phoneNumber: normalizedPhone, authMethod: 'phone_password' }));
    await saveStepDataLocal({ phoneNumber: normalizedPhone, authMethod: 'phone_password' });
    setAuthMode('password_login');
  }, [saveStepDataLocal]);

  const handlePasswordLoginSuccess = useCallback(async (userData) => {
    const normalizedUserType = normalizeAuthFlowUserType(userData?.userType || userData?.usertype || 'customer');
    const loginPayload = {
      ...userData,
      phoneNumber: userData?.phoneNumber || authData?.phoneNumber,
      usertype: normalizedUserType,
      userType: normalizedUserType,
      authMethod: 'phone_password',
      authenticated: true
    };

    const persistedLoginPayload =
      await persistAuthenticatedProfile(loginPayload, normalizedUserType) || loginPayload;

    store.dispatch({
      type: FETCH_USER_SUCCESS,
      payload: persistedLoginPayload
    });

    store.dispatch({
      type: 'SET_AUTH_STATUS',
      payload: { authenticated: true, user: persistedLoginPayload }
    });

    await completeStep('phone_validation');

    if (onComplete) {
      onComplete({
        ...persistedLoginPayload,
        phoneValidated: true,
        authMethod: 'phone_password'
      });
    }
  }, [authData?.phoneNumber, onComplete, persistAuthenticatedProfile]);

  const handlePasswordLoginBack = useCallback(() => {
    setAuthMode('phone');
    setCurrentStep(0);
  }, []);

  const handleForgotPassword = useCallback(() => {
    setAuthMode('forgot_password');
  }, []);

  // Função para lidar com a seleção do perfil
  const handleProfileSelected = useCallback(async (profileSelection) => {
    const normalizedSelection = {
      ...profileSelection,
      userType: normalizeAuthFlowUserType(profileSelection?.userType)
    };
    await saveStepDataLocal({ profileSelection: normalizedSelection });
    // Marcar seleção de perfil como completa
    await completeStep('profile_selection');
    if (normalizedSelection.userType === 'driver') {
      // Fluxo motorista: OTP -> seleção de perfil -> CNH
      setCurrentStep(4);
      await saveCurrentStep(4);
      return;
    }
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep]);

  // Função para lidar com o envio dos dados do perfil
  const handleProfileDataSubmitted = useCallback(async (profileData) => {
    const normalizedProfile = normalizeAuthFlowProfileData(profileData);
    const normalizedUserType = normalizeAuthFlowUserType(authData?.profileSelection?.userType);
    const isDriver = normalizedUserType === 'driver';

    const nextDocumentData = isDriver
      ? (authData?.documentData || {})
      : {
          ...(authData?.documentData || {}),
          email: String(profileData?.email || '').trim().toLowerCase()
        };

    const nextCredentials = isDriver
      ? (authData?.credentials || {})
      : {
	          ...(authData?.credentials || {}),
	          password: profileData?.password,
	          confirmPassword: profileData?.confirmPassword,
	          acceptTerms: Boolean(profileData?.acceptTerms),
	          acceptPrivacy: Boolean(profileData?.acceptPrivacy)
	        };

    await saveStepDataLocal({
      profileData: normalizedProfile,
      ...(isDriver ? {} : { documentData: nextDocumentData, credentials: nextCredentials })
    });

    // Marcar dados pessoais como completos
    await completeStep('profile_data');

    if (isDriver) {
      goToNextStep();
      return;
    }

    await completeStep('document_data');
    await completeStep('credentials');
    await finalizeOnboarding({
      documentDataOverride: nextDocumentData,
      credentialsOverride: nextCredentials
    });
  }, [authData?.credentials, authData?.documentData, authData?.profileSelection?.userType, completeStep, finalizeOnboarding, goToNextStep, saveStepDataLocal]);

  // Função para lidar com o envio do documento
  const handleDocumentSubmitted = useCallback(async (documentData) => {
    const profileSelectionType = normalizeAuthFlowUserType(authData?.profileSelection?.userType);
    const cnhFullName = documentData?.cnhExtraction?.data?.nome || '';
    const normalizedProfile =
      profileSelectionType === 'driver' && cnhFullName
        ? normalizeAuthFlowProfileData({ fullName: cnhFullName })
        : authData?.profileData || {};

    await saveStepDataLocal({
      documentData,
      ...(profileSelectionType === 'driver' && cnhFullName
        ? { profileData: normalizedProfile }
        : {})
    });

    // Marcar documentos como completos
    await completeStep('document_data');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep, authData?.profileSelection?.userType, authData?.profileData]);

  async function finalizeOnboarding({ credentialsOverride, documentDataOverride = {} } = {}) {
    const normalizedUserType = normalizeAuthFlowUserType(authData?.profileSelection?.userType);
    const normalizedProfile = normalizeAuthFlowProfileData(authData?.profileData || {});
    const normalizedSelection = {
      ...(authData?.profileSelection || {}),
      userType: normalizedUserType,
      timestamp: authData?.profileSelection?.timestamp || new Date().toISOString()
    };
    const driverActivation = normalizedUserType === 'driver' ? createInitialDriverOnboardingState() : null;
    const mergedDocumentData = {
      ...(authData?.documentData || {}),
      ...(documentDataOverride || {})
    };

    const onboardingData = {
      ...authData,
      profileSelection: normalizedSelection,
      profileData: normalizedProfile,
      documentData: mergedDocumentData,
      credentials: credentialsOverride || authData?.credentials || {}
    };

    if (driverActivation) {
      onboardingData.driverActivation = driverActivation;
    }

    let savedProfilePayload = null;
    try {
      const result = await UserDatabaseService.saveUserProfile(onboardingData);
      if (result?.success && result?.profile) {
        savedProfilePayload = result.profile;
      }
    } catch (error) {
      Logger.warn('⚠️ Falha ao salvar perfil completo no banco durante onboarding:', error?.message || error);
    }

    const fallbackPayload = UserDatabaseService.buildProfilePayload(onboardingData);
    const profilePayload = savedProfilePayload || fallbackPayload;
	    const persistedProfilePayload =
	      await persistAuthenticatedProfile(profilePayload, normalizedUserType) || profilePayload;

	    if (normalizedUserType === 'customer' && onboardingData?.credentials?.password) {
	      try {
	        await UserAuthService.setupPassword(
	          onboardingData.phoneNumber || profilePayload.phoneNumber || profilePayload.mobile,
	          onboardingData.credentials.password
	        );
	      } catch (error) {
	        Logger.error('❌ Falha ao configurar senha do passageiro:', error);
	        throw error;
	      }
	    }

    if (persistedProfilePayload?.uid) {
      store.dispatch({
        type: FETCH_USER_SUCCESS,
        payload: persistedProfilePayload
      });
    }

    if (onComplete) {
      onComplete({
        ...onboardingData,
        usertype: normalizedUserType,
        userType: normalizedUserType,
        persistedProfile: persistedProfilePayload,
        needsDocumentUpload: normalizedUserType === 'driver'
      });
    }
  }

  // Função para lidar com a criação das credenciais
  const handleCredentialsCreated = useCallback(async (credentials) => {
    const normalizedUserType = normalizeAuthFlowUserType(authData?.profileSelection?.userType);
    await saveStepDataLocal({ credentials });

    // Marcar credenciais como completo
    await completeStep('credentials');

    if (normalizedUserType === 'driver') {
      // Após consentimentos do motorista, pedir e-mail (com opção de pular)
      setCurrentStep(6);
      await saveCurrentStep(6);
      return;
    }

    await finalizeOnboarding({ credentialsOverride: credentials });
  }, [saveStepDataLocal, completeStep, authData?.profileSelection?.userType, finalizeOnboarding]);

  const handleDriverEmailSubmitted = useCallback(async (driverContactData) => {
    const normalizedEmail = String(driverContactData?.email || '').trim().toLowerCase();
    const mergedDocumentData = {
      ...(authData?.documentData || {}),
      email: normalizedEmail
    };

    await saveStepDataLocal({
      driverContactData: {
        email: normalizedEmail,
        skipped: Boolean(driverContactData?.skipped),
        updatedAt: new Date().toISOString()
      },
      documentData: mergedDocumentData
    });

    await saveStepData('driver_contact', { email: normalizedEmail });
    await completeStep('driver_contact');

    await finalizeOnboarding({
      credentialsOverride: authData?.credentials || {},
      documentDataOverride: mergedDocumentData
    });
  }, [authData?.credentials, authData?.documentData, finalizeOnboarding, saveStepDataLocal]);

  // Função para alternar para o fluxo de registro
  const handleSwitchToRegister = useCallback((phoneNumber) => {
    if (phoneNumber) {
      saveStepDataLocal({ phoneNumber });
    }
    setAuthMode('phone');
    // Aqui você pode implementar a lógica para alternar para o fluxo de registro
    // Por enquanto, vamos continuar com o fluxo de login
  }, [saveStepDataLocal]);

  // Renderizar o step atual
  const renderCurrentStep = () => {
    if (authMode === 'password_login') {
      return (
        <PasswordLoginStep
          phoneNumber={authData.phoneNumber}
          onLoginSuccess={handlePasswordLoginSuccess}
          onForgotPassword={handleForgotPassword}
          onBack={handlePasswordLoginBack}
        />
      );
    }

    if (authMode === 'forgot_password') {
      return (
        <ForgotPasswordStep
          phoneNumber={authData.phoneNumber}
          onPasswordReset={handlePasswordLoginSuccess}
          onBack={() => setAuthMode('password_login')}
        />
      );
    }

    // Fluxo normal de cadastro
    switch (currentStep) {
      case 0:
        return (
          <PhoneInputStep
            onVerificationSent={handlePhoneVerificationSent}
            onSwitchToRegister={handleSwitchToRegister}
            onPasswordLoginRequested={handlePasswordLoginRequested}
          />
        );
      case 1:
        return (
          <OTPStep
            phoneNumber={authData.phoneNumber}
            confirmation={authData.confirmation}
            onVerified={handleOTPVerified}
            onBack={goToPreviousStep}
          />
        );
      case 2:
        return (
          <ProfileSelectionStep
            onProfileSelected={handleProfileSelected}
            onBack={goToPreviousStep}
            initialData={authData.profileSelection || {}}
          />
        );
      case 3:
        return (
          <ProfileDataStep
            onSubmitted={handleProfileDataSubmitted}
            onBack={goToPreviousStep}
            initialData={{
              ...(authData.profileData || {}),
              profileSelection: authData.profileSelection || {},
              documentData: authData.documentData || {},
              credentials: authData.credentials || {}
            }}
          />
        );
      case 4:
        return (
          <DocumentStep
            onSubmitted={handleDocumentSubmitted}
            onBack={goToPreviousStep}
            initialData={{
              profileData: authData.profileData || {},
              profileSelection: authData.profileSelection || {},
              documentData: authData.documentData || {},
              user: authData.user || null
            }}
          />
        );
      case 5:
        return (
          <CredentialsStep
            onCreated={handleCredentialsCreated}
            onBack={goToPreviousStep}
            initialData={{
              profileData: authData.profileData || {},
              documentData: authData.documentData || {},
              profileSelection: authData.profileSelection || {},
              ...(authData.credentials || {})
            }}
          />
        );
      case 6:
        return (
          <DriverEmailStep
            onSubmitted={handleDriverEmailSubmitted}
            onBack={goToPreviousStep}
            initialData={{
              email: authData?.documentData?.email || authData?.driverContactData?.email || ''
            }}
          />
        );
      default:
        return null;
    }
  };

  if (!visible) {
    return null;
  }

  const variantTokens = Platform.OS === 'android' ? ONBOARDING_AB_VARIANTS.ANDROID : ONBOARDING_AB_VARIANTS.B;
  const backgroundSource = Platform.OS === 'android'
    ? { uri: onboardingBackgroundDataUri }
    : onboardingBackground;

  return (
    <View style={styles.safeArea}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <ImageBackground
        source={backgroundSource}
        style={styles.backgroundImage}
        imageStyle={styles.backgroundImageAsset}
        resizeMode="cover"
        fadeDuration={0}
      >
        <View style={[styles.backgroundTint, { backgroundColor: variantTokens.backgroundTint }]} pointerEvents="none" />
        <View style={[styles.backgroundSoftMask, { backgroundColor: variantTokens.softMask }]} pointerEvents="none" />
        <View style={styles.contentHost}>
          <View
            style={[
              styles.contentFrame,
              {
                borderColor: variantTokens.frameBorder,
                backgroundColor: variantTokens.frameBackground,
                shadowOpacity: variantTokens.frameShadowOpacity,
                shadowRadius: variantTokens.frameShadowRadius,
                elevation: variantTokens.frameElevation
              }
            ]}
          >
            {renderCurrentStep()}
          </View>
        </View>
      </ImageBackground>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.background
  },
  backgroundImage: {
    flex: 1,
    backgroundColor: '#E7ECF1'
  },
  backgroundImageAsset: {
    opacity: Platform.OS === 'android' ? 1 : 1
  },
  backgroundTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(244,247,250,0.64)'
  },
  backgroundSoftMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.12)'
  },
  contentHost: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Platform.OS === 'android' ? 18 : 14,
    paddingVertical: Platform.OS === 'android' ? 22 : 14
  },
  contentFrame: {
    width: '100%',
    maxWidth: Platform.OS === 'android' ? 404 : 392,
    alignSelf: 'center',
    minHeight: Platform.OS === 'android' ? 388 : 360,
    maxHeight: '86%',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.76)',
    backgroundColor: color.panel,
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 14,
    overflow: 'hidden'
  }
});

export default AuthFlow; 
