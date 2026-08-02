import Logger from '../../utils/Logger';
import React, { useState, useCallback } from 'react';
import { Alert, StatusBar, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FETCH_USER_SUCCESS } from '../../state/actionTypes';
import store from '../../state/appStore';
import { saveStepData, completeStep, saveCurrentStep, loadStepData } from '../../utils/secureOnboardingStorage';
import testUserService from '../../services/TestUserService';
import UserAuthService from '../../services/UserAuthService';
import OnboardingProfileService from '../../services/OnboardingProfileService';
import driverActivationService from '../../services/DriverActivationService';
import { createInitialDriverOnboardingState } from '../../services/DriverOnboardingService';
import { allowReviewAccess } from '../../config/runtimeAccessPolicy';
import onboardingTheme from './common/onboardingTheme';
import { resolveEditorialProgressMeta } from './common/EditorialOnboardingLayout';
import {
  buildRestoredAuthFlowData,
  buildSerializableConfirmationMeta,
  hasRequiredDriverConsents,
  normalizeAuthFlowProfileData,
  normalizeAuthFlowUserType,
  resolveAuthFlowInitialStep,
  unwrapAuthFlowStepData,
} from './authFlowRecovery';
import {
  createDriverActivationSubmissionTracker,
  resolveDriverActivationBlockingAlert,
  submitDriverOnboardingActivation,
} from './authFlowDriverActivation';
import {
  persistPhoneValidatedOnboardingSession,
  sanitizeAuthUserForOnboarding,
  PROFILE_SELECTION_STEP_INDEX
} from '../../utils/onboardingSessionState';

const { color } = onboardingTheme;
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';

// Steps de autenticação
import PhoneInputStep from './steps/PhoneInputStep';
import OTPStep from './steps/OTPStep';
import ProfileSelectionStep from './steps/ProfileSelectionStep';
import ProfileDataStep from './steps/ProfileDataStep';
import DocumentStep from './steps/DocumentStep';
import CredentialsStep from './steps/CredentialsStep';
import DriverEmailStep from './steps/DriverEmailStep';

const AuthFlow = ({
  visible,
  onComplete,
  onClose,
  onboardingProgress,
  screenshotStep = null,
  screenshotAuthData = null
}) => {
  const [currentStep, setCurrentStep] = useState(() => (
    Number.isInteger(screenshotStep) ? screenshotStep : 0
  ));
  const [authData, setAuthData] = useState(() => screenshotAuthData || {});
  const driverActivationSubmissionTracker = React.useRef(
    createDriverActivationSubmissionTracker(),
  );
  const isReviewEnv = allowReviewAccess();
  const editorialProgressMeta = React.useMemo(
    () => resolveEditorialProgressMeta(currentStep, authData?.profileSelection?.userType),
    [authData?.profileSelection?.userType, currentStep]
  );

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
    if (Number.isInteger(screenshotStep)) {
      setCurrentStep(screenshotStep);
      setAuthData(screenshotAuthData || {});
      return undefined;
    }

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

        const profileSelectionData = completedSteps.includes('profile_selection')
          ? await loadStepData('profile_selection')
          : null;
        const normalizedProfileSelectionData = unwrapAuthFlowStepData(
          'profile_selection',
          profileSelectionData,
        );
        const resolvedUserType = normalizedProfileSelectionData?.userType
          ? normalizeAuthFlowUserType(normalizedProfileSelectionData.userType)
          : null;
        const rawCredentialsData = completedSteps.includes('credentials')
          ? await loadStepData('credentials')
          : null;
        const credentialsData = unwrapAuthFlowStepData('credentials', rawCredentialsData);

        const initialStep = resolveAuthFlowInitialStep(
          completedSteps,
          fallbackStep,
          resolvedUserType,
          credentialsData,
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
          credentialsData,
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
  }, [onboardingProgress, screenshotAuthData, screenshotStep]);

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
      const stepFields = {
        profile_selection: 'profileSelection',
        profile_data: 'profileData',
        document_data: 'documentData',
        credentials: 'credentials',
        driver_contact: 'driverContactData',
      };
      const writes = Object.entries(stepFields)
        .filter(([, fieldName]) => data?.[fieldName] && typeof data[fieldName] === 'object')
        .map(([targetStep, fieldName]) => saveStepData(targetStep, data[fieldName]));

      if (stepName === 'phone_validation' || writes.length === 0) {
        writes.push(saveStepData(stepName, data));
      }

      await Promise.all(writes);
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
          const phoneNumberOnly = phoneNumber ? phoneNumber.replace('+55', '') : '21102938475';
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
    const phoneNumber = authData.phoneNumber || user?.phoneNumber || null;
    const sanitizedUser = sanitizeAuthUserForOnboarding({
      ...user,
      phoneNumber,
    });
    await persistPhoneValidatedOnboardingSession(sanitizedUser);
    await saveStepDataLocal({
      phoneNumber: sanitizedUser.phoneNumber,
      phoneValidated: true,
      isExistingUser: false,
      user: sanitizedUser,
    });
    await completeStep('phone_validation');
    setCurrentStep(PROFILE_SELECTION_STEP_INDEX);
    await saveCurrentStep(PROFILE_SELECTION_STEP_INDEX);
  }, [authData, saveStepDataLocal, completeStep, onComplete]);

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
    }

    const canTestOtpBypass =
      skipOTP &&
      confirmation &&
      confirmation.isTestOtpBypass === true &&
      confirmation.bypassUser;

    if (canTestOtpBypass) {
      Logger.log('🧪 OTP bypass de conta de teste aplicado antes da validação manual.', {
        phoneNumber
      });
      await handleOTPVerified(confirmation.bypassUser);
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

    // ✅ Fluxo normal: seguir para tela de OTP.
    // O objeto confirmation do Firebase pode conter métodos/ciclos; ele fica só em memória.
    setAuthData(prev => ({ ...prev, phoneNumber, confirmation, isExistingUser }));
    await saveStepData('phone_validation', {
      phoneNumber,
      isExistingUser,
      confirmation: buildSerializableConfirmationMeta(confirmation)
    });
    // Marcar telefone como validado
    await completeStep('phone_validation');
    goToNextStep();
  }, [completeStep, goToNextStep, handleOTPVerified]);

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
      profileDataOverride: normalizedProfile,
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

  async function finalizeOnboarding({ credentialsOverride, documentDataOverride = {}, profileDataOverride = null } = {}) {
    const normalizedUserType = normalizeAuthFlowUserType(authData?.profileSelection?.userType);
    const normalizedProfile = normalizeAuthFlowProfileData(profileDataOverride || authData?.profileData || {});
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

    if (
      normalizedUserType === 'driver' &&
      !hasRequiredDriverConsents(onboardingData.credentials)
    ) {
      setCurrentStep(5);
      await saveCurrentStep(5);
      Alert.alert(
        'Permissões obrigatórias',
        'Aceite os Termos de Uso, a Política de Privacidade e a checagem de antecedentes para continuar.',
      );
      return false;
    }

    let savedProfilePayload = null;
    try {
      const result = await OnboardingProfileService.saveOnboardingProfile(onboardingData);
      if (result?.success && result?.profile) {
        savedProfilePayload = result.profile;
      }
    } catch (error) {
      Logger.warn('⚠️ Falha ao salvar perfil completo no banco durante onboarding:', error?.message || error);
    }

    if (!savedProfilePayload) {
      Alert.alert(
        'Cadastro não confirmado',
        'Não foi possível salvar seu cadastro agora. Verifique sua conexão e tente novamente.',
      );
      return false;
    }

    let driverActivationSubmission = null;
    if (normalizedUserType === 'driver') {
      try {
        driverActivationSubmission = await submitDriverOnboardingActivation({
          activationService: driverActivationService,
          credentials: onboardingData.credentials,
          documentData: mergedDocumentData,
          tracker: driverActivationSubmissionTracker.current,
        });
      } catch (error) {
        Logger.error(
          '❌ Falha na submissão canônica obrigatória do motorista:',
          error?.cause?.message || error?.message || error,
        );
        const blockingAlert = resolveDriverActivationBlockingAlert(error);
        Alert.alert(blockingAlert.title, blockingAlert.message);
        return false;
      }
    }

    const persistedProfilePayload =
      await persistAuthenticatedProfile(savedProfilePayload, normalizedUserType);
    if (!persistedProfilePayload) {
      Alert.alert(
        'Sessão não preparada',
        'Seu cadastro foi salvo, mas não foi possível preparar a sessão neste aparelho. Tente entrar novamente.',
      );
      return false;
    }

    if (driverActivationSubmission?.crlvError) {
      Logger.warn(
        '⚠️ CNH enviada, mas o CRLV opcional ficou pendente:',
        driverActivationSubmission.crlvError?.message || driverActivationSubmission.crlvError,
      );
      Alert.alert(
        'CRLV pendente',
        'Seu cadastro foi criado e você pode acessar o mapa, mas o CRLV não foi enviado. Envie-o em Documentos para poder ficar online.',
      );
    }

    if (normalizedUserType === 'customer' && onboardingData?.credentials?.password) {
      const passwordPhoneNumber =
        onboardingData.phoneNumber ||
        normalizedProfile.phoneNumber ||
        normalizedProfile.mobile ||
        persistedProfilePayload.phoneNumber ||
        persistedProfilePayload.mobile ||
        savedProfilePayload.phoneNumber ||
        savedProfilePayload.mobile;
      try {
        await UserAuthService.setupPassword(
          passwordPhoneNumber,
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
      const driverActivationSubmissionPayload = driverActivationSubmission
        ? {
            requiredComplete: driverActivationSubmission.requiredComplete === true,
            cnhSubmitted: driverActivationSubmission.cnhSubmitted === true,
            crlvSubmitted: driverActivationSubmission.crlvSubmitted === true,
            pendingCrlvAsset: driverActivationSubmission.pendingCrlvAsset || null,
          }
        : null;

      onComplete({
        ...onboardingData,
        usertype: normalizedUserType,
        userType: normalizedUserType,
        persistedProfile: persistedProfilePayload,
        needsDocumentUpload: normalizedUserType === 'driver',
        ...(driverActivationSubmissionPayload
          ? { driverActivationSubmission: driverActivationSubmissionPayload }
          : {})
      });
    }

    return true;
  }

  // Função para lidar com a criação das credenciais
  const handleCredentialsCreated = useCallback(async (credentials) => {
    const normalizedUserType = normalizeAuthFlowUserType(authData?.profileSelection?.userType);

    if (normalizedUserType === 'driver' && !hasRequiredDriverConsents(credentials)) {
      Alert.alert(
        'Permissões obrigatórias',
        'Aceite os três consentimentos obrigatórios para continuar.',
      );
      return;
    }

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

  // Renderizar o step atual
  const renderCurrentStep = () => {
    // Fluxo normal de cadastro
    switch (currentStep) {
      case 0:
        return (
          <PhoneInputStep
            onVerificationSent={handlePhoneVerificationSent}
            onPasswordLoginSuccess={handlePasswordLoginSuccess}
            progressMeta={editorialProgressMeta}
          />
        );
      case 1:
        return (
          <OTPStep
            phoneNumber={authData.phoneNumber}
            confirmation={authData.confirmation}
            onVerified={handleOTPVerified}
            onBack={goToPreviousStep}
            progressMeta={editorialProgressMeta}
          />
        );
      case 2:
        return (
          <ProfileSelectionStep
            onProfileSelected={handleProfileSelected}
            onBack={goToPreviousStep}
            initialData={authData.profileSelection || {}}
            progressMeta={editorialProgressMeta}
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
            progressMeta={editorialProgressMeta}
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
            progressMeta={editorialProgressMeta}
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
            progressMeta={editorialProgressMeta}
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
            progressMeta={editorialProgressMeta}
          />
        );
      default:
        return null;
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar
        translucent={false}
        backgroundColor={color.background}
        barStyle="dark-content"
      />
      <View style={styles.contentHost}>
        <View style={styles.contentFrame}>
          {renderCurrentStep()}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.background
  },
  contentHost: {
    flex: 1,
    backgroundColor: color.background
  },
  contentFrame: {
    width: '100%',
    alignSelf: 'stretch',
    flex: 1
  }
});

export default AuthFlow; 
