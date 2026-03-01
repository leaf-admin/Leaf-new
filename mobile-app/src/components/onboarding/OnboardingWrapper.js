import Logger from '../../utils/Logger';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { useOnboardingPersistence } from '../../hooks/useOnboardingPersistence';
import AuthFlow from '../auth/AuthFlow';


const OnboardingWrapper = ({ children }) => {
  const navigation = useNavigation();
  const auth = useSelector(state => state.auth);
  const { 
    onboarding, 
    loadOnboardingData, 
    isLoaded, 
    getStepData,
    isStepComplete 
  } = useOnboardingPersistence();
  
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState(null);

  Logger.log('OnboardingWrapper - 🔄 Renderizando:', {
    isCheckingStatus,
    shouldShowOnboarding,
    authProfile: auth.profile,
    isLoaded: isLoaded()
  });

  // Timeout de segurança para não ficar travado
  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      if (isCheckingStatus) {
        Logger.log('OnboardingWrapper - ⚠️ Timeout de segurança ativado, mostrando onboarding');
        setIsCheckingStatus(false);
        setShouldShowOnboarding(true);
      }
    }, 5000); // 5 segundos máximo

    return () => clearTimeout(safetyTimeout);
  }, [isCheckingStatus]);

  // Verificar status do usuário e decidir o que mostrar
  useEffect(() => {
    const checkUserStatus = async () => {
      try {
        Logger.log('OnboardingWrapper - 🔍 Verificando status do usuário...');
        
        // Verificar se o usuário está autenticado no Firebase primeiro
        const hasFirebaseAuth = auth.profile && auth.profile.uid;
        Logger.log('OnboardingWrapper - 🔐 Usuário autenticado no Firebase?', !!hasFirebaseAuth);
        
        // Se não está autenticado, mostrar onboarding imediatamente
        if (!hasFirebaseAuth) {
          Logger.log('OnboardingWrapper - 🔐 Usuário não autenticado, mostrando onboarding imediatamente');
          setShouldShowOnboarding(true);
          setOnboardingProgress(null);
          setIsCheckingStatus(false);
          return;
        }
        
        // Aguardar dados do onboarding serem carregados (apenas para usuários autenticados)
        if (!isLoaded()) {
          Logger.log('OnboardingWrapper - ⏳ Aguardando carregamento dos dados...');
          // Se não carregou em 2 segundos, continuar mesmo assim
          setTimeout(() => {
            if (!isLoaded()) {
              Logger.log('OnboardingWrapper - ⏰ Timeout no carregamento, continuando...');
              setIsCheckingStatus(false);
              setShouldShowOnboarding(true);
            }
          }, 2000);
          return;
        }

        // Verificar se o usuário tem dados completos no Realtime Database
        const hasCompleteProfile = auth.profile && auth.profile.usertype;
        Logger.log('OnboardingWrapper - 📊 Perfil completo no Realtime Database?', !!hasCompleteProfile);

        if (hasCompleteProfile) {
          // ✅ SITUAÇÃO 1: Usuário completo - ir para NewMapScreen
          Logger.log('OnboardingWrapper - ✅ Usuário completo, navegando para NewMapScreen');
          setShouldShowOnboarding(false);
          setIsCheckingStatus(false);
          
          // Navegar para Map (NewMapScreen)
          navigation.replace('Map');
          return;
        } else {
          // 🔄 SITUAÇÃO 2: Usuário autenticado mas incompleto - continuar onboarding
          Logger.log('OnboardingWrapper - 🔄 Usuário autenticado mas incompleto, continuando onboarding');
          
          // Determinar step inicial baseado no progresso
          let initialStep = 0;
          if (isStepComplete('phone_validation')) {
            initialStep = 2; // ProfileSelectionStep
          } else if (isStepComplete('profile_selection')) {
            initialStep = 3; // ProfileDataStep
          } else if (isStepComplete('profile_data')) {
            initialStep = 4; // DocumentStep
          } else if (isStepComplete('document_data')) {
            initialStep = 5; // CredentialsStep
          }
          
          setOnboardingProgress({
            step: initialStep,
            completed: (onboarding.progress ? Object.keys(onboarding.progress).filter(key => onboarding.progress[key]) : [])
          });
          
          setShouldShowOnboarding(true);
          setIsCheckingStatus(false);
          return;
        }
      } catch (error) {
        Logger.error('OnboardingWrapper - ❌ Erro ao verificar status:', error);
        // Em caso de erro, mostrar onboarding
        setShouldShowOnboarding(true);
        setIsCheckingStatus(false);
      }
    };

    // Executar verificação quando os dados estiverem carregados
    if (isLoaded()) {
      checkUserStatus();
    }
  }, [isLoaded, auth.profile, navigation, isStepComplete, onboarding.progress]);

  // Mostrar loading enquanto verifica
  if (isCheckingStatus) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1A330E" />
        <Text style={styles.loadingText}>Verificando perfil...</Text>
      </View>
    );
  }

  // Se deve mostrar onboarding, renderizar AuthFlow
  if (shouldShowOnboarding) {
    return (
      <AuthFlow
        visible={true}
        onComplete={(authData) => {
          Logger.log('OnboardingWrapper - ✅ Onboarding completado:', authData);
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
          Logger.log('OnboardingWrapper - ❌ Onboarding fechado');
        }}
        onboardingProgress={onboardingProgress}
      />
    );
  }

  // Se não deve mostrar onboarding, renderizar children (normalmente NewMapScreen)
  return children;
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A330E',
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    marginTop: 20,
  },
});

export default OnboardingWrapper;
