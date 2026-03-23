import Logger from '../../utils/Logger';
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { useOnboardingPersistence } from '../../hooks/useOnboardingPersistence';
import AuthFlow from '../auth/AuthFlow';
import onboardingTheme from '../auth/common/onboardingTheme';

const { color } = onboardingTheme;

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

const OnboardingWrapper = ({ children }) => {
  const navigation = useNavigation();
  const auth = useSelector(state => state.auth);
  const { onboarding, isLoaded } = useOnboardingPersistence();
  
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
    if (!isCheckingStatus) {
      return;
    }

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
          setOnboardingProgress({ step: 0, completed: [] });
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
          setOnboardingProgress(buildOnboardingPayload(onboarding.progress || {}));
          
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
  }, [auth.profile, navigation, isCheckingStatus]);

  // Mostrar loading enquanto verifica
  if (isCheckingStatus) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={color.textPrimary} />
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
    backgroundColor: color.background,
  },
  loadingText: {
    color: color.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
  },
});

export default OnboardingWrapper;
