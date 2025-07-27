import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, StatusBar, Animated, TouchableOpacity, Dimensions, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

const translations = [
  { welcome: 'BEM VINDO A', start: 'Começar', subtitle: 'Sua jornada começa aqui' },
  { welcome: 'WELCOME TO', start: 'Start', subtitle: 'Your journey starts here' },
  { welcome: 'BIENVENIDO A', start: 'Comenzar', subtitle: 'Tu viaje comienza aquí' },
  { welcome: 'BIENVENUE À', start: 'Commencer', subtitle: 'Votre voyage commence ici' },
  { welcome: 'WILLKOMMEN BEI', start: 'Starten', subtitle: 'Ihre Reise beginnt hier' },
  { welcome: 'BENVENUTO A', start: 'Inizia', subtitle: 'Il tuo viaggio inizia qui' },
  { welcome: 'ようこそ', start: '開始', subtitle: 'あなたの旅がここから始まります' },
  { welcome: '欢迎', start: '开始', subtitle: '您的旅程从这里开始' },
  { welcome: 'أهلاً بك في', start: 'ابدأ', subtitle: 'رحلتك تبدأ من هنا' },
  { welcome: 'BIENVENUE À', start: 'Commencer', subtitle: 'Votre voyage commence ici' },
];

export default function WelcomeScreen({ navigation }) {
  const [currentText, setCurrentText] = useState(translations[0].welcome);
  const [currentBtn, setCurrentBtn] = useState(translations[0].start);
  const [currentSubtitle, setCurrentSubtitle] = useState(translations[0].subtitle);
  const [isLoading, setIsLoading] = useState(false);
  const [buttonDisabled, setButtonDisabled] = useState(false);
  
  // Animações
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const buttonAnim = useRef(new Animated.Value(1)).current;
  const fadeInAnim = useRef(new Animated.Value(0)).current;
  const logoScaleAnim = useRef(new Animated.Value(0.8)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    console.log("WelcomeScreen - Componente montado");
    startInitialAnimations();
  }, []);

  const startInitialAnimations = () => {
    // Animação de entrada do logo
    Animated.sequence([
      Animated.timing(logoScaleAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(subtitleAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      })
    ]).start();

    // Fade in geral
    Animated.timing(fadeInAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        idx = (idx + 1) % translations.length;
        setCurrentText(translations[idx].welcome);
        setCurrentBtn(translations[idx].start);
        setCurrentSubtitle(translations[idx].subtitle);
        // Fade in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      });
    }, 4000); // Aumentado para 4 segundos
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    console.log("WelcomeScreen - Botão Start pressionado");
    if (buttonDisabled || isLoading) return;
    
    setButtonDisabled(true);
    setIsLoading(true);
    
    // Animação do botão
    Animated.sequence([
      Animated.timing(buttonAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      })
    ]).start();

    // Simular carregamento
    setTimeout(() => {
      console.log("WelcomeScreen - Navegando para ProfileSelection");
      navigation.navigate('ProfileSelection');
      setButtonDisabled(false);
      setIsLoading(false);
    }, 500);
  };

  const clearStorage = async () => {
    try {
      setIsLoading(true);
      await AsyncStorage.removeItem('@user_data');
      console.log('Dados do usuário removidos com sucesso!');
      alert('Storage limpo! Reinicie o app.');
    } catch (error) {
      console.error('Erro ao remover dados do usuário:', error);
      alert('Erro ao limpar storage');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#1A330E" barStyle="light-content" />
      
      {/* Background com gradiente sutil */}
      <View style={styles.backgroundGradient} />
      
      {/* Conteúdo principal */}
      <Animated.View 
        style={[
          styles.content,
          {
            opacity: fadeInAnim,
            transform: [{ scale: logoScaleAnim }]
          }
        ]}
      >
        {/* Logo e texto de boas-vindas */}
        <View style={styles.logoWrapper}>
          <Animated.Text 
            style={[
              styles.welcomeText,
              { opacity: fadeAnim }
            ]}
          > 
            {currentText}
          </Animated.Text>
          
          <Image
            source={require('../../assets/images/customcolor_logo_customcolor_background.png')}
            style={[
              styles.logo,
              { 
                width: width * 0.6,
                height: width * 0.6
              }
            ]}
            resizeMode="contain"
          />
          
          <Animated.Text 
            style={[
              styles.subtitle,
              { 
                opacity: subtitleAnim,
                fontSize: 16
              }
            ]}
          >
            {currentSubtitle}
          </Animated.Text>
        </View>

        {/* Botões */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.startButton,
              buttonDisabled && styles.buttonDisabled
            ]}
            onPress={handleStart}
            disabled={buttonDisabled || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.startButtonText}>{currentBtn}</Text>
            )}
          </TouchableOpacity>
          
          {/* Botão temporário para limpar storage */}
          <TouchableOpacity
            style={[
              styles.clearButton,
              buttonDisabled && styles.buttonDisabled
            ]}
            onPress={clearStorage}
            disabled={buttonDisabled || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.clearButtonText}>Limpar Storage</Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Loading overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Carregando...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26, 51, 14, 0.05)', // Verde sutil
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  logoWrapper: {
    alignItems: 'center',
    marginBottom: 60,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A330E',
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 1,
  },
  logo: {
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
    paddingHorizontal: 20,
  },
  startButton: {
    backgroundColor: '#10B981',
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  clearButton: {
    backgroundColor: '#FF4444',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  clearButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 12,
    fontWeight: '500',
  },
}); 