import Logger from '../utils/Logger';
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, StatusBar, Animated, Text, ActivityIndicator, Dimensions } from 'react-native';
import { useSelector } from 'react-redux';
import { useOnboardingPersistence } from '../hooks/useOnboardingPersistence';
import AuthFlow from '../components/auth/AuthFlow';

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

export default function SplashScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const loadingOpacity = useRef(new Animated.Value(0)).current;

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

    const checkUserStatus = async () => {
      // ✅ Timeout de 5s para verificação de usuário (Item 1.3)
      const timeoutId = setTimeout(() => {
        Logger.warn('SplashScreen - ⏰ Timeout na verificação de usuário, permitindo acesso ao app');
        // Permitir app abrir mesmo sem verificação completa
        setShouldShowOnboarding(true);
        setIsChecking(false);
      }, 5000);

      try {
        Logger.log('SplashScreen - 🔍 Verificando status do usuário nos bastidores...');
        
        // Verificar se o usuário está autenticado no Firebase
        const hasFirebaseAuth = auth.profile && auth.profile.uid;
        Logger.log('SplashScreen - 🔐 Usuário autenticado no Firebase?', !!hasFirebaseAuth);
        
        // Se não está autenticado, mostrar onboarding
        if (!hasFirebaseAuth) {
          clearTimeout(timeoutId);
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
          setTimeout(() => {
            if (!isLoaded()) {
              clearTimeout(timeoutId);
              Logger.log('SplashScreen - ⏰ Timeout no carregamento, preparando onboarding');
              setShouldShowOnboarding(true);
              setIsChecking(false);
            }
          }, 1000);
          return;
        }

        // Verificar se o usuário tem dados completos no Realtime Database
        const hasCompleteProfile = auth.profile && auth.profile.usertype;
        Logger.log('SplashScreen - 📊 Perfil completo no Realtime Database?', !!hasCompleteProfile);

        clearTimeout(timeoutId);

        if (hasCompleteProfile) {
          // ✅ SITUAÇÃO 1: Usuário completo - ir para NewMapScreen
          Logger.log('SplashScreen - ✅ Usuário completo, navegando para Map');
          setShouldShowOnboarding(false);
          setIsChecking(false);
          
          // Navegar para Map após 4 segundos
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
          }, 4000);
          return;
        } else {
          // 🔄 SITUAÇÃO 2: Usuário autenticado mas incompleto - continuar onboarding
          Logger.log('SplashScreen - 🔄 Usuário autenticado mas incompleto, preparando onboarding');

          const progressPayload = buildOnboardingPayload(onboarding.progress || {});
          setOnboardingProgress(progressPayload);
          
          setShouldShowOnboarding(true);
          setIsChecking(false);
          return;
        }
      } catch (error) {
        clearTimeout(timeoutId);
        Logger.error('SplashScreen - ❌ Erro ao verificar status:', error);
        // Em caso de erro, mostrar onboarding (app sempre abre)
        setShouldShowOnboarding(true);
        setIsChecking(false);
      }
    };

    // Executar verificação imediatamente
    checkUserStatus();
  }, [auth.profile, navigation, isChecking]);

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
        onComplete={(authData) => {
          Logger.log('SplashScreen - ✅ Onboarding completado:', authData);
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
    fontFamily: 'Roboto-Medium',
  },
}); 
