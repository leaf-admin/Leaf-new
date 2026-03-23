import Logger from '../../utils/Logger';
import React, { useState, useCallback } from 'react';
import { StatusBar, View, StyleSheet, ImageBackground, TouchableOpacity, Text } from 'react-native';
import Constants from 'expo-constants';
import { FETCH_USER_SUCCESS } from '../../common-local/types';
import store from '../../common-local/store';
import { saveStepData, completeStep, saveCurrentStep, loadStepData } from '../../utils/secureOnboardingStorage';
import testUserService from '../../services/TestUserService';
import UserDatabaseService from '../../utils/userDatabaseService';
import { createInitialDriverOnboardingState } from '../../services/DriverOnboardingService';
import onboardingTheme from './common/onboardingTheme';

const { color, radius } = onboardingTheme;
const onboardingBackground = require('../../../assets/images/onboarding-city-bg.jpg');
const ONBOARDING_AB_DEFAULT = 'B';

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
  }
};

// ✅ CRÍTICO: Flag de ambiente de review (App Store compliance)
const IS_REVIEW_ENV = Constants.expoConfig?.extra?.isReview === true;

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

function normalizeUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType === 'driver' ? 'driver' : 'customer';
}

function splitFullName(fullName) {
  const clean = String(fullName || '').trim();
  if (!clean) {
    return {
      firstName: '',
      lastName: ''
    };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: ''
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function normalizeProfileData(profileData = {}) {
  const fullNameCandidate =
    profileData.fullName ||
    [profileData.firstName, profileData.lastName].filter(Boolean).join(' ').trim();
  const { firstName, lastName } = splitFullName(fullNameCandidate);

  return {
    fullName: fullNameCandidate || '',
    firstName,
    lastName
  };
}

const AuthFlow = ({ visible, onComplete, onClose, onboardingProgress }) => {
  const [abVariant, setAbVariant] = useState(ONBOARDING_AB_DEFAULT);
  const [currentStep, setCurrentStep] = useState(0);
  const [authData, setAuthData] = useState({});
  const [pendingUserData, setPendingUserData] = useState(null); // ✅ Estado para armazenar dados do usuário que precisam ser dispatchados
  const [isPasswordLogin, setIsPasswordLogin] = useState(false); // ✅ Flag para login com senha
  const [isForgotPassword, setIsForgotPassword] = useState(false); // ✅ Flag para esqueci senha

  // ✅ Dispatch de dados do usuário de teste quando disponível
  // Usar store.dispatch diretamente para evitar problemas com hooks
  React.useEffect(() => {
    if (pendingUserData) {
      // Usar setTimeout para garantir que aconteça após renderização completa
      const timeoutId = setTimeout(() => {
        try {
          // ✅ Usar store.dispatch diretamente em vez de useDispatch para evitar problemas de contexto
          store.dispatch({
            type: FETCH_USER_SUCCESS,
            payload: pendingUserData
          });
          Logger.log('✅ Redux store atualizado com dados do usuário de teste');
          setPendingUserData(null); // Limpar após dispatch
        } catch (error) {
          Logger.error('❌ Erro ao atualizar Redux store:', error);
        }
      }, 200);

      return () => clearTimeout(timeoutId);
    }
  }, [pendingUserData]);

  const resolveInitialStep = useCallback((completedSteps = [], fallbackStep = 0, userType = null) => {
    const normalizedType = normalizeUserType(userType);

    if (completedSteps.includes('driver_contact')) {
      return 6;
    }

    if (completedSteps.includes('credentials')) {
      if (normalizedType === 'driver') {
        return 6;
      }
      return 5;
    }

    if (completedSteps.includes('document_data')) {
      return 4;
    }

    if (completedSteps.includes('profile_data')) {
      return 4;
    }

    if (completedSteps.includes('profile_selection')) {
      if (normalizedType === 'driver') {
        return 4;
      }
      return 3;
    }

    if (completedSteps.includes('phone_validation')) {
      return 2;
    }

    return fallbackStep;
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
          resolvedUserType = normalizeUserType(profileSelectionData?.userType);
        }

        const initialStep = resolveInitialStep(completedSteps, fallbackStep, resolvedUserType);
        if (!isMounted) {
          return;
        }

        setCurrentStep(initialStep);
        await saveCurrentStep(initialStep);
        Logger.log('AuthFlow - 🔄 Step inicial definido:', initialStep);

        const savedData = {};

        // Carregar dados do telefone se disponível
        if (completedSteps.includes('phone_validation')) {
          const phoneData = await loadStepData('phone_validation');
          Logger.log('📱 Dados do telefone carregados:', phoneData);
          if (phoneData.phoneNumber) {
            savedData.phoneNumber = phoneData.phoneNumber;
          }
          if (phoneData.confirmation) {
            savedData.confirmation = phoneData.confirmation;
          }
        }

        // Carregar dados da seleção de perfil se disponível
        if (completedSteps.includes('profile_selection')) {
          const profileSelectionData = await loadStepData('profile_selection');
          Logger.log('👤 Dados da seleção de perfil carregados:', profileSelectionData);
          if (profileSelectionData.userType) {
            savedData.profileSelection = {
              userType: normalizeUserType(profileSelectionData.userType),
              timestamp: profileSelectionData.timestamp
            };
          }
        }

        // Carregar dados pessoais se disponível
        if (completedSteps.includes('profile_data')) {
          const profileData = await loadStepData('profile_data');
          Logger.log('📝 Dados pessoais carregados:', profileData);
          const normalizedProfile = normalizeProfileData(profileData);
          if (normalizedProfile.firstName || normalizedProfile.lastName || normalizedProfile.fullName) {
            savedData.profileData = normalizedProfile;
          }
        }

        // Carregar dados de documentos se disponível
        if (completedSteps.includes('document_data')) {
          const documentData = await loadStepData('document_data');
          Logger.log('📄 Dados de documentos carregados:', documentData);
          if (
            documentData.cpf ||
            documentData.email ||
            documentData.city ||
            documentData.cnhExtraction ||
            documentData.vehicleExtraction
          ) {
            savedData.documentData = {
              cpf: documentData.cpf || '',
              email: documentData.email || '',
              city: documentData.city || '',
              cnhExtraction: documentData.cnhExtraction || null,
              vehicleExtraction: documentData.vehicleExtraction || null,
              cnhPdfMeta: documentData.cnhPdfMeta || null,
              vehiclePdfMeta: documentData.vehiclePdfMeta || null
            };
          }
        }

        if (completedSteps.includes('driver_contact')) {
          const driverContactData = await loadStepData('driver_contact');
          if (driverContactData?.email) {
            savedData.driverContactData = {
              email: driverContactData.email
            };
            savedData.documentData = {
              ...(savedData.documentData || {}),
              email: driverContactData.email
            };
          }
        }

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
  }, [onboardingProgress, resolveInitialStep]);

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
    const isDriver = normalizeUserType(authData?.profileSelection?.userType) === 'driver';
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
    if (user && user.isReviewAccount) {
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

          // Atualizar Redux com usuário simulado
          store.dispatch({
            type: FETCH_USER_SUCCESS,
            payload: {
              ...reviewUserData.user,
              ...mockUser,
              phoneNumber: phoneNumber,
              usertype: userType,
              userType: userType,
              authenticated: true
            }
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

    // 🚀 VERIFICAR SE É USUÁRIO DE TESTE (legado - manter para compatibilidade)
    if (user && user.isTestUser) {
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
          setPendingUserData(testUserData);

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
            store.dispatch({
              type: FETCH_USER_SUCCESS,
              payload: {
                ...testUserDataComplete.user,
                phoneNumber: phoneNumber,
                usertype: userType,
                userType: userType
              }
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
      (IS_REVIEW_ENV || __DEV__) &&
      confirmation &&
      confirmation.isReviewAccount &&
      confirmation.reviewUser;

    if (canBypass) {
      Logger.log('🔐 REVIEW ACCESS: Pulando OTP e fazendo login direto', {
        phoneNumber,
        userType: confirmation.reviewUser.userType,
        isReviewEnv: IS_REVIEW_ENV,
        isDev: __DEV__,
        skipOTP: skipOTP
      });

      // Chamar handleOTPVerified diretamente com o usuário de review
      await handleOTPVerified(confirmation.reviewUser);
      return;
    } else if (skipOTP && (!IS_REVIEW_ENV && !__DEV__)) {
      // ✅ Bloquear bypass em produção
      Logger.error('🚫 Tentativa de bypass bloqueada: ambiente de produção', {
        phoneNumber,
        isReviewEnv: IS_REVIEW_ENV,
        isDev: __DEV__
      });
      // Continuar com fluxo normal de OTP
    }

    // ✅ Fluxo normal: Mostrar tela de OTP
    await saveStepDataLocal({ phoneNumber, confirmation, isExistingUser });
    // Marcar telefone como validado
    await completeStep('phone_validation');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep, handleOTPVerified]);

  // ✅ Função para quando usuário existe e tem senha
  const handleUserExists = useCallback(async (existingUser, phoneNumber) => {
    await saveStepDataLocal({ existingUser, phoneNumber });
    setIsPasswordLogin(true);
  }, [saveStepDataLocal]);

  // ✅ Função para login com senha bem-sucedido
  const handlePasswordLoginSuccess = useCallback(async (userData) => {
    Logger.log('✅ Login com senha bem-sucedido:', userData);

    // Salvar dados do usuário
    await saveStepDataLocal({ user: userData });
    await completeStep('phone_validation');

    // Resetar flags
    setIsPasswordLogin(false);

    // Completar autenticação
    if (onComplete) {
      onComplete({
        ...authData,
        user: userData,
        phoneValidated: true,
        isExistingUser: true
      });
    }
  }, [saveStepDataLocal, completeStep, authData, onComplete]);

  // ✅ Função para esqueci a senha
  const handleForgotPassword = useCallback(() => {
    setIsPasswordLogin(false);
    setIsForgotPassword(true);
  }, []);

  // ✅ Função para reset de senha completo
  const handlePasswordReset = useCallback(async (userData) => {
    Logger.log('✅ Senha resetada com sucesso:', userData);

    // Voltar para login com senha
    setIsForgotPassword(false);
    setIsPasswordLogin(true);
  }, []);

  // Função para lidar com a seleção do perfil
  const handleProfileSelected = useCallback(async (profileSelection) => {
    const normalizedSelection = {
      ...profileSelection,
      userType: normalizeUserType(profileSelection?.userType)
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
    const normalizedProfile = normalizeProfileData(profileData);
    await saveStepDataLocal({ profileData: normalizedProfile });
    // Marcar dados pessoais como completos
    await completeStep('profile_data');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep]);

  // Função para lidar com o envio do documento
  const handleDocumentSubmitted = useCallback(async (documentData) => {
    const profileSelectionType = normalizeUserType(authData?.profileSelection?.userType);
    const cnhFullName = documentData?.cnhExtraction?.data?.nome || '';
    const normalizedProfile =
      profileSelectionType === 'driver' && cnhFullName
        ? normalizeProfileData({ fullName: cnhFullName })
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

  const finalizeOnboarding = useCallback(async ({ credentialsOverride, documentDataOverride = {} } = {}) => {
    const normalizedUserType = normalizeUserType(authData?.profileSelection?.userType);
    const normalizedProfile = normalizeProfileData(authData?.profileData || {});
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

    if (profilePayload?.uid) {
      store.dispatch({
        type: FETCH_USER_SUCCESS,
        payload: profilePayload
      });
    }

    if (onComplete) {
      onComplete({
        ...onboardingData,
        usertype: normalizedUserType,
        userType: normalizedUserType,
        persistedProfile: profilePayload,
        needsDocumentUpload: normalizedUserType === 'driver'
      });
    }
  }, [authData, onComplete]);

  // Função para lidar com a criação das credenciais
  const handleCredentialsCreated = useCallback(async (credentials) => {
    const normalizedUserType = normalizeUserType(authData?.profileSelection?.userType);
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
    // Aqui você pode implementar a lógica para alternar para o fluxo de registro
    // Por enquanto, vamos continuar com o fluxo de login
  }, [saveStepDataLocal]);

  // Renderizar o step atual
  const renderCurrentStep = () => {
    // ✅ Tela de esqueci senha
    if (isForgotPassword) {
      return (
        <ForgotPasswordStep
          phoneNumber={authData.phoneNumber}
          existingUser={authData.existingUser}
          onPasswordReset={handlePasswordReset}
          onBack={() => {
            setIsForgotPassword(false);
            setIsPasswordLogin(true);
          }}
        />
      );
    }

    // ✅ Tela de login com senha
    if (isPasswordLogin) {
      return (
        <PasswordLoginStep
          phoneNumber={authData.phoneNumber}
          existingUser={authData.existingUser}
          onLoginSuccess={handlePasswordLoginSuccess}
          onForgotPassword={handleForgotPassword}
          onBack={() => {
            setIsPasswordLogin(false);
            setCurrentStep(0);
          }}
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
            onUserExists={handleUserExists}
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
              profileSelection: authData.profileSelection || {}
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

  const variantTokens = ONBOARDING_AB_VARIANTS[abVariant] || ONBOARDING_AB_VARIANTS.A;

  return (
    <View style={styles.safeArea}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      <ImageBackground source={onboardingBackground} style={styles.backgroundImage} resizeMode="cover">
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
        <View style={styles.variantSwitcher}>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => setAbVariant('A')}
            style={[styles.variantButton, abVariant === 'A' ? styles.variantButtonActive : null]}
          >
            <Text style={[styles.variantButtonText, abVariant === 'A' ? styles.variantButtonTextActive : null]}>A</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => setAbVariant('B')}
            style={[styles.variantButton, abVariant === 'B' ? styles.variantButtonActive : null]}
          >
            <Text style={[styles.variantButtonText, abVariant === 'B' ? styles.variantButtonTextActive : null]}>B</Text>
          </TouchableOpacity>
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
    flex: 1
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
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  contentFrame: {
    width: '100%',
    maxWidth: 392,
    alignSelf: 'center',
    minHeight: 360,
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
  },
  variantSwitcher: {
    position: 'absolute',
    top: 54,
    right: 14,
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,23,34,0.16)',
    backgroundColor: 'rgba(255,255,255,0.82)',
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
    overflow: 'hidden'
  },
  variantButton: {
    minWidth: 34,
    paddingHorizontal: 12,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center'
  },
  variantButtonActive: {
    backgroundColor: 'rgba(15,23,34,0.92)'
  },
  variantButtonText: {
    color: '#4D5868',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700'
  },
  variantButtonTextActive: {
    color: '#FFFFFF'
  }
});

export default AuthFlow; 
