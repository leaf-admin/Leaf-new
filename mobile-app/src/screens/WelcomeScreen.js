import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, StatusBar, Animated, TouchableOpacity, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

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
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [buttonDisabled, setButtonDisabled] = useState(false);
  const buttonAnim = useRef(new Animated.Value(1)).current;
  const fadeInAnim = useRef(new Animated.Value(0)).current;
  const logoScaleAnim = useRef(new Animated.Value(0.8)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    console.log("WelcomeScreen - Componente montado");
    
    // Animação inicial do logo
    Animated.spring(logoScaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    // Animação do subtítulo
    Animated.timing(subtitleAnim, {
      toValue: 1,
      duration: 800,
      delay: 500,
      useNativeDriver: true,
    }).start();
  }, []);

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
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    console.log("WelcomeScreen - Iniciando animação de fade in");
    Animated.timing(fadeInAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start(() => {
      console.log("WelcomeScreen - Animação de fade in concluída");
    });
  }, []);

  const handleStart = () => {
    console.log("WelcomeScreen - Botão Start pressionado");
    if (buttonDisabled) return;
    setButtonDisabled(true);
    
    // Animação de press do botão
    Animated.sequence([
      Animated.timing(buttonAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonAnim, {
        toValue: 0,
        duration: 300,
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
    <LinearGradient
      colors={['#1A330E', '#2A4A1E', '#3A5A2E']}
      style={styles.container}
    >
      <StatusBar backgroundColor="#1A330E" barStyle="light-content" />
      
      <Animated.View style={[styles.content, { opacity: fadeInAnim }]}>
        <View style={styles.logoWrapper}>
          <Animated.View style={[styles.logoContainer, { transform: [{ scale: logoScaleAnim }] }]}>
            <Image
              source={require('../../assets/images/customcolor_logo_customcolor_background.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </Animated.View>
          
          <Animated.View style={[styles.textContainer, { opacity: fadeAnim }]}>
            <Text style={styles.welcomeText}>{currentText}</Text>
            <Animated.Text style={[styles.subtitleText, { opacity: subtitleAnim }]}>
              {currentSubtitle}
            </Animated.Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.buttonContainer, { transform: [{ scale: buttonAnim }] }]}>
          <TouchableOpacity 
            style={styles.startButton} 
            onPress={handleStart} 
            disabled={buttonDisabled}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#4CAF50', '#45A049']}
              style={styles.buttonGradient}
            >
              <Text style={styles.startButtonText}>{currentBtn}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
    width: '100%',
  },
  logoWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  logoContainer: {
    marginBottom: 40,
  },
  logo: {
    width: 200,
    height: 200,
    alignSelf: 'center',
  },
  textContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  welcomeText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1.5,
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  subtitleText: {
    color: '#E8F5E8',
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.9,
    fontStyle: 'italic',
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  startButton: {
    width: '100%',
    borderRadius: 25,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonGradient: {
    paddingVertical: 18,
    paddingHorizontal: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
}); 