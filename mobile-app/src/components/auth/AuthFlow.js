import Logger from '../../utils/Logger';
import React, { useState, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useDispatch } from 'react-redux';
import { FETCH_USER_SUCCESS } from '../../common-local/types';
import store from '../../common-local/store';
import { saveStepData, completeStep, saveCurrentStep, loadStepData } from '../../utils/secureOnboardingStorage';
import testUserService from '../../services/TestUserService';

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

const AuthFlow = ({ visible, onComplete, onClose, onboardingProgress }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [authData, setAuthData] = useState({});
  const bottomSheetRef = useRef(null);
  const dispatch = useDispatch();
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

  // 🔍 DETERMINAR STEP INICIAL BASEADO NO PROGRESSO E CARREGAR DADOS SALVOS
  React.useEffect(() => {
    const initializeStep = async () => {
      if (onboardingProgress && onboardingProgress.completed) {
        Logger.log('AuthFlow - 🔍 Progresso recebido:', onboardingProgress);
        Logger.log('AuthFlow - 🔍 Passos completados:', onboardingProgress.completed);

        // 🔍 DETERMINAR STEP INICIAL
        let initialStep = onboardingProgress.step || 0;

        // Se o step inicial for 2 (ProfileSelectionStep), significa que o usuário já está autenticado
        if (initialStep === 2) {
          Logger.log('AuthFlow - ✅ Usuário já autenticado, começando do step de seleção de perfil');

          // Para usuários já autenticados, simular dados de telefone validado
          setAuthData(prev => ({
            ...prev,
            phoneNumber: '+55', // Placeholder para usuários já autenticados
            phoneValidated: true
          }));
        } else {
          // Lógica para determinar step baseado no progresso (para usuários não autenticados)
          if (onboardingProgress.completed.includes('phone_validation')) {
            // ✅ Telefone já validado, começar do step de seleção de perfil
            initialStep = 2; // ProfileSelectionStep
            Logger.log('AuthFlow - ✅ Telefone já validado, começando do step:', initialStep);
          } else if (onboardingProgress.completed.includes('profile_selection')) {
            // ✅ Perfil já selecionado, começar do step de dados pessoais
            initialStep = 3; // ProfileDataStep
            Logger.log('AuthFlow - ✅ Perfil já selecionado, começando do step:', initialStep);
          } else if (onboardingProgress.completed.includes('profile_data')) {
            // ✅ Dados pessoais já preenchidos, começar do step de documentos
            initialStep = 4; // DocumentStep
            Logger.log('AuthFlow - ✅ Dados pessoais já preenchidos, começando do step:', initialStep);
          } else if (onboardingProgress.completed.includes('document_data')) {
            // ✅ Documentos já preenchidos, ir para credenciais
            initialStep = 5; // CredentialsStep
            Logger.log('AuthFlow - ✅ Documentos já preenchidos, começando do step:', initialStep);
          }
        }

        setCurrentStep(initialStep);
        await saveCurrentStep(initialStep);
        Logger.log('AuthFlow - 🔄 Step inicial definido:', initialStep);

        // 🔍 CARREGAR DADOS SALVOS DOS STEPS ANTERIORES
        const loadSavedData = async () => {
          try {
            const savedData = {};

            // Carregar dados do telefone se disponível
            if (onboardingProgress.completed.includes('phone_validation')) {
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
            if (onboardingProgress.completed.includes('profile_selection')) {
              const profileSelectionData = await loadStepData('profile_selection');
              Logger.log('👤 Dados da seleção de perfil carregados:', profileSelectionData);
              // Extrair dados corretamente (evitar duplicação)
              if (profileSelectionData.userType) {
                savedData.profileSelection = {
                  userType: profileSelectionData.userType,
                  timestamp: profileSelectionData.timestamp
                };
              }
            }

            // Carregar dados pessoais se disponível
            if (onboardingProgress.completed.includes('profile_data')) {
              const profileData = await loadStepData('profile_data');
              Logger.log('📝 Dados pessoais carregados:', profileData);
              // Extrair dados corretamente (evitar duplicação)
              if (profileData.firstName || profileData.lastName) {
                savedData.profileData = {
                  firstName: profileData.firstName || '',
                  lastName: profileData.lastName || '',
                  dateOfBirth: profileData.dateOfBirth || '',
                  gender: profileData.gender || ''
                };
              }
            }

            // Carregar dados de documentos se disponível
            if (onboardingProgress.completed.includes('document_data')) {
              const documentData = await loadStepData('document_data');
              Logger.log('📄 Dados de documentos carregados:', documentData);
              // Extrair dados corretamente (evitar duplicação)
              if (documentData.cpf || documentData.email) {
                savedData.documentData = {
                  cpf: documentData.cpf || '',
                  email: documentData.email || ''
                };
              }
            }

            // Aplicar dados carregados
            if (Object.keys(savedData).length > 0) {
              setAuthData(prev => ({ ...prev, ...savedData }));
              Logger.log('AuthFlow - 📥 Dados salvos carregados e processados:', savedData);
            }
          } catch (error) {
            Logger.error('AuthFlow - ❌ Erro ao carregar dados salvos:', error);
          }
        };

        await loadSavedData();
      }
    };

    initializeStep();
  }, [onboardingProgress]);

  // Snap points para o BottomSheet baseados no step atual
  const getSnapPoints = useCallback(() => {
    switch (currentStep) {
      case 0: // PhoneInputStep
        return ['60%', '80%']; // Altura maior para entrada de telefone (ajustado para teclado)
      case 1: // OTPStep
        return ['45%', '60%']; // Altura menor para OTP
      case 2: // ProfileSelectionStep
        return ['60%', '80%']; // Altura média para seleção de perfil
      case 3: // ProfileDataStep
        return ['70%', '90%']; // Altura maior para dados pessoais
      case 4: // DocumentStep
        return ['80%', '95%']; // Altura grande para documentos
      case 5: // CredentialsStep
        return ['60%', '80%']; // Altura média para credenciais
      default:
        return ['60%', '80%'];
    }
  }, [currentStep]);

  const snapPoints = getSnapPoints();

  // Função para obter o nome do step baseado no índice
  const getStepNameByIndex = useCallback((index) => {
    switch (index) {
      case 0: return 'phone_validation';
      case 1: return 'phone_validation'; // OTP é parte da validação do telefone
      case 2: return 'profile_selection';
      case 3: return 'profile_data';
      case 4: return 'document_data';
      case 5: return 'credentials';
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
    const prevStep = Math.max(0, currentStep - 1);
    setCurrentStep(prevStep);
    await saveCurrentStep(prevStep);
  }, [currentStep]);

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
              firstName: testUserData.firstName || 'Teste',
              lastName: testUserData.lastName || 'Usuário',
              dateOfBirth: testUserData.dateOfBirth || '',
              gender: testUserData.gender || ''
            },
            documentData: {
              cpf: testUserData.cpf || '',
              email: testUserData.email || 'test@leafapp.com'
            },
            credentials: {
              acceptTerms: true,
              acceptMarketing: false
            },
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
    await saveStepDataLocal({ profileSelection });
    // Marcar seleção de perfil como completa
    await completeStep('profile_selection');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep]);

  // Função para lidar com o envio dos dados do perfil
  const handleProfileDataSubmitted = useCallback(async (profileData) => {
    await saveStepDataLocal({ profileData });
    // Marcar dados pessoais como completos
    await completeStep('profile_data');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep]);

  // Função para lidar com o envio do documento
  const handleDocumentSubmitted = useCallback(async (documentData) => {
    await saveStepDataLocal({ documentData });
    // Marcar documentos como completos
    await completeStep('document_data');
    goToNextStep();
  }, [saveStepDataLocal, completeStep, goToNextStep]);

  // Função para lidar com a criação das credenciais
  const handleCredentialsCreated = useCallback(async (credentials) => {
    // Criar objeto com todos os dados do onboarding
    const onboardingData = {
      ...authData,
      credentials
    };

    await saveStepDataLocal({ credentials });

    // Marcar credenciais como completo
    await completeStep('credentials');

    // ✅ Onboarding completado!
    Logger.log('✅ Onboarding completado:', onboardingData);

    // Verificar se é driver para redirecionar para upload de documentos
    const profileSelection = onboardingData.profileSelection;
    if (profileSelection && profileSelection.userType === 'driver') {
      // Para drivers, ir para upload de documentos
      Logger.log('🚗 Driver detectado, redirecionando para upload de documentos');
      if (onComplete) {
        onComplete({ ...onboardingData, needsDocumentUpload: true });
      }
    } else {
      // Para customers, ir direto para a tela principal
      Logger.log('👤 Customer detectado, redirecionando para tela principal');
      if (onComplete) {
        onComplete(onboardingData);
      }
    }
  }, [saveStepDataLocal, completeStep, authData, onComplete]);

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
            initialData={authData.profileData || {}}
          />
        );
      case 4:
        return (
          <DocumentStep
            onSubmitted={handleDocumentSubmitted}
            onBack={goToPreviousStep}
            initialData={{
              profileData: authData.profileData || {},
              profileSelection: authData.profileSelection || {}
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
              documentData: authData.documentData || {}
            }}
          />
        );
      default:
        return null;
    }
  };

  // Backdrop bloqueado (não fecha ao clicar fora)
  const renderBackdrop = useCallback(
    (props) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        onPress={() => { }} // Não faz nada ao clicar
        pressBehavior="none" // Bloquear toque no backdrop
      />
    ),
    []
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={visible ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.bottomSheetBackground}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.contentContainer}>
        {renderCurrentStep()}
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 0, // Padding already handled by the Steps (e.g. PhoneInputStep, OTPStep)
    paddingTop: 0,      // Padding already handled by the Steps to have more control
  },
});

export default AuthFlow; 