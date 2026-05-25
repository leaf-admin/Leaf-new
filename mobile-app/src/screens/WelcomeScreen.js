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
      <View pointerEvents="none" style={styles.backgroundCanvas}>
        <View style={[styles.routeLine, styles.routeLineTop]} />
        <View style={[styles.routeLine, styles.routeLineMiddle]} />
        <View style={[styles.routeLine, styles.routeLineBottom]} />
        <View style={styles.routePin} />
      </View>

      <View style={styles.brandCluster}>
        <View style={styles.leafMark}>
          <View style={styles.leafMarkCore} />
        </View>
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
    paddingTop: spacing.xxl + spacing.lg,
    paddingBottom: spacing.xxl
  },
  backgroundCanvas: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden'
  },
  routeLine: {
    position: 'absolute',
    height: 2,
    borderRadius: 2,
    backgroundColor: color.mapLine
  },
  routeLineTop: {
    width: 310,
    top: 118,
    right: -104,
    transform: [{ rotate: '-23deg' }]
  },
  routeLineMiddle: {
    width: 420,
    top: 292,
    left: -126,
    backgroundColor: color.skyLine,
    transform: [{ rotate: '18deg' }]
  },
  routeLineBottom: {
    width: 360,
    bottom: 152,
    right: -108,
    transform: [{ rotate: '-17deg' }]
  },
  routePin: {
    position: 'absolute',
    top: 194,
    left: 38,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.accent,
    opacity: 0.22
  },
  brandCluster: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    flexDirection: 'column',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl
  },
  leafMark: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.panelSoft,
    borderWidth: 1,
    borderColor: color.glassStroke,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: color.accent,
    ...elevation.soft
  },
  leafMarkCore: {
    width: 18,
    height: 24,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 4,
    backgroundColor: color.accent,
    transform: [{ rotate: '36deg' }]
  },
  welcomeText: {
    color: color.textPrimary,
    fontSize: 14,
    fontFamily: fonts.Bold,
    textAlign: 'center',
    letterSpacing: 1.4,
    width: '100%',
    marginBottom: spacing.md,
    textTransform: 'uppercase'
  },
  logo: {
    width: 212,
    height: 212,
    alignSelf: 'center',
    marginTop: -spacing.sm
  },
  startButton: {
    backgroundColor: color.accent,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.accent,
    minHeight: 58,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.accent,
    ...elevation.soft
  },
  startButtonText: {
    color: color.accentText,
    fontSize: 16,
    fontFamily: fonts.SemiBold,
    textAlign: 'center'
  }
});
