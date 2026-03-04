import Logger from '../utils/Logger';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, StatusBar, Animated, TouchableOpacity } from 'react-native';


const translations = [
  { welcome: 'BEM VINDO A', start: 'Começar' },
  { welcome: 'WELCOME TO', start: 'Start' },
  { welcome: 'BIENVENIDO A', start: 'Comenzar' },
  { welcome: 'BIENVENUE À', start: 'Commencer' },
  { welcome: 'WILLKOMMEN BEI', start: 'Starten' },
  { welcome: 'BENVENUTO A', start: 'Inizia' },
  { welcome: 'ようこそ', start: '開始' },
  { welcome: '欢迎', start: '开始' },
  { welcome: 'أهلاً بك في', start: 'ابدأ' },
  { welcome: 'BIENVENUE À', start: 'Commencer' },
];

export default function WelcomeScreen({ navigation }) {
  const [currentText, setCurrentText] = useState(translations[0].welcome);
  const [currentBtn, setCurrentBtn] = useState(translations[0].start);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Animações separadas para texto e botão
  const welcomeFadeAnim = useRef(new Animated.Value(1)).current;
  const buttonFadeAnim = useRef(new Animated.Value(1)).current;

  // Animação de entrada inicial
  const fadeInAnim = useRef(new Animated.Value(0)).current;

  const [buttonDisabled, setButtonDisabled] = useState(false);
  const buttonAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Logger.log("WelcomeScreen - Componente montado");

    // Animação de entrada inicial
    Animated.timing(fadeInAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start(() => {
      Logger.log("WelcomeScreen - Animação de entrada concluída");
    });
  }, []);

  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      // Fade out simultâneo para texto e botão
      Animated.parallel([
        Animated.timing(welcomeFadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(buttonFadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        })
      ]).start(() => {
        // Atualiza os textos
        idx = (idx + 1) % translations.length;
        setCurrentIndex(idx);
        setCurrentText(translations[idx].welcome);
        setCurrentBtn(translations[idx].start);

        // Fade in simultâneo para texto e botão
        Animated.parallel([
          Animated.timing(welcomeFadeAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(buttonFadeAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          })
        ]).start();
      });
    }, 4000); // 4 segundos para cada mudança

    return () => clearInterval(interval);
  }, []);

  const handleStart = () => {
    Logger.log("WelcomeScreen - Botão Start pressionado");
    if (buttonDisabled) return;
    setButtonDisabled(true);
    Animated.parallel([
      Animated.timing(buttonAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      })
    ]).start(() => {
      Logger.log("WelcomeScreen - Navegando para ProfileSelection");
      navigation.navigate('ProfileSelectionScreen');
      setButtonDisabled(false);
      buttonAnim.setValue(1);
    });
  };

  return (
    <Animated.View style={[
      { flex: 1, width: '100%', backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
      { opacity: fadeInAnim }
    ]}>
      <StatusBar backgroundColor="#1A330E" barStyle="light-content" />
      <View style={styles.logoWrapper}>
        <Animated.Text style={[
          styles.welcomeText,
          { opacity: welcomeFadeAnim }
        ]}>
          {currentText}
        </Animated.Text>
        <Image
          source={require('../../assets/images/customcolor_logo_customcolor_background.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <TouchableOpacity style={styles.startButton} onPress={handleStart} disabled={buttonDisabled}>
        <Animated.Text style={[
          styles.startButtonText,
          { opacity: buttonFadeAnim }
        ]}>
          {currentBtn}
        </Animated.Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  logoWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
    flexDirection: 'column',
  },
  welcomeText: {
    color: '#1A330E',
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 2,
    width: '100%',
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    transform: [{ translateY: -80 }],
    zIndex: 10,
  },
  logo: {
    width: 215,
    height: 215,
    alignSelf: 'center',
    marginTop: 0,
  },
  startButton: {
    backgroundColor: '#2A4A1E',
    borderRadius: 8,
    paddingVertical: 16,
    width: 215,
    alignItems: 'center',
    position: 'absolute',
    bottom: 50, // Elevado de 30 para 50 para evitar sobreposição com barra de navegação/home indicator
    alignSelf: 'center',
  },
  startButtonText: {
    color: '#F5F5F5',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1A330E',
    borderRadius: 16,
    padding: 24,
    width: 255,
    alignItems: 'center',
    marginTop: 32,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
}); 