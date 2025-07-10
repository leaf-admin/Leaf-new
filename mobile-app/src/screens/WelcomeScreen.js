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
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [buttonDisabled, setButtonDisabled] = useState(false);
  const buttonAnim = useRef(new Animated.Value(1)).current;
  const fadeInAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    console.log("WelcomeScreen - Componente montado");
  }, []);

  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(() => {
        idx = (idx + 1) % translations.length;
        setCurrentText(translations[idx].welcome);
        setCurrentBtn(translations[idx].start);
        // Fade in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    console.log("WelcomeScreen - Iniciando animação de fade in");
    Animated.timing(fadeInAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start(() => {
      console.log("WelcomeScreen - Animação de fade in concluída");
    });
  }, []);

  const handleStart = () => {
    console.log("WelcomeScreen - Botão Start pressionado");
    if (buttonDisabled) return;
    setButtonDisabled(true);
    Animated.parallel([
      Animated.timing(buttonAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      })
    ]).start(() => {
      console.log("WelcomeScreen - Navegando para ProfileSelection");
      navigation.navigate('ProfileSelection');
      setButtonDisabled(false);
      buttonAnim.setValue(1);
    });
  };

  return (
    <View style={{ flex: 1, width: '100%', backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' }}>
      <StatusBar backgroundColor="#1A330E" barStyle="light-content" />
      <View style={styles.logoWrapper}>
        <Text style={styles.welcomeText}> 
          {currentText}
        </Text>
        <Image
          source={require('../../assets/images/customcolor_logo_customcolor_background.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <TouchableOpacity style={styles.startButton} onPress={handleStart} disabled={buttonDisabled}>
        <Text style={styles.startButtonText}>{currentBtn}</Text>
      </TouchableOpacity>
    </View>
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
    bottom: 30,
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