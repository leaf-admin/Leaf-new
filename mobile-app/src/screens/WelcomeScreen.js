import Logger from '../utils/Logger';
import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, StatusBar, Animated, TouchableOpacity } from 'react-native';
import { fonts } from '../theme/runtimeTokens';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

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
  const [currentIndex, setCurrentIndex] = useState(0);
  const welcomeFadeAnim = useRef(new Animated.Value(1)).current;
  const buttonFadeAnim = useRef(new Animated.Value(1)).current;
  const fadeInAnim = useRef(new Animated.Value(0)).current;
  const [buttonDisabled, setButtonDisabled] = useState(false);
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Logger.log('WelcomeScreen - Componente montado');

    Animated.timing(fadeInAnim, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true
    }).start(() => {
      Logger.log('WelcomeScreen - Animacao de entrada concluida');
    });
  }, []);

  useEffect(() => {
    let idx = 0;

    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(welcomeFadeAnim, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true
        }),
        Animated.timing(buttonFadeAnim, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true
        })
      ]).start(() => {
        idx = (idx + 1) % translations.length;
        setCurrentIndex(idx);

        Animated.parallel([
          Animated.timing(welcomeFadeAnim, {
            toValue: 1,
            duration: 260,
            useNativeDriver: true
          }),
          Animated.timing(buttonFadeAnim, {
            toValue: 1,
            duration: 260,
            useNativeDriver: true
          })
        ]).start();
      });
    }, 3800);

    return () => clearInterval(interval);
  }, []);

  const handleStart = () => {
    Logger.log('WelcomeScreen - Botao start pressionado');
    if (buttonDisabled) return;

    setButtonDisabled(true);

    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.96,
        duration: 110,
        useNativeDriver: true
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 110,
        useNativeDriver: true
      })
    ]).start(() => {
      Logger.log('WelcomeScreen - Navegando para ProfileSelectionScreen');
      navigation.navigate('ProfileSelectionScreen');
      setButtonDisabled(false);
    });
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeInAnim }]}>
      <StatusBar backgroundColor={color.background} barStyle="dark-content" />
      <View style={styles.backgroundBlobPrimary} />
      <View style={styles.backgroundBlobSecondary} />

      <View style={styles.logoWrapper}>
        <Animated.Text style={[
          styles.welcomeText,
          { opacity: welcomeFadeAnim }
        ]}>
          {translations[currentIndex].welcome}
        </Animated.Text>

        <Image
          source={require('../../assets/images/customcolor_logo_customcolor_background.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      <TouchableOpacity
        style={styles.startButton}
        onPress={handleStart}
        disabled={buttonDisabled}
        activeOpacity={0.9}
      >
        <Animated.Text style={[
          styles.startButtonText,
          {
            opacity: buttonFadeAnim,
            transform: [{ scale: buttonScaleAnim }]
          }
        ]}>
          {translations[currentIndex].start}
        </Animated.Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.background,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl
  },
  backgroundBlobPrimary: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(16,22,34,0.08)',
    top: -90,
    right: -70
  },
  backgroundBlobSecondary: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(16,22,34,0.06)',
    bottom: -80,
    left: -60
  },
  logoWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    flexDirection: 'column',
    backgroundColor: color.panel,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingVertical: spacing.xxl,
    shadowColor: '#0E1522',
    ...elevation.panel
  },
  welcomeText: {
    color: color.textPrimary,
    fontSize: 24,
    fontFamily: fonts.Bold,
    textAlign: 'center',
    letterSpacing: 1.2,
    width: '100%',
    marginBottom: spacing.sm
  },
  logo: {
    width: 190,
    height: 190,
    alignSelf: 'center',
    marginTop: spacing.xs
  },
  startButton: {
    backgroundColor: color.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    minHeight: 52,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 9
  },
  startButtonText: {
    color: color.accentText,
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    textAlign: 'center'
  }
});
