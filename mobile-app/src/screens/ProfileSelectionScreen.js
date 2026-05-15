import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../theme/runtimeTokens';
import OnboardingLayout from '../components/OnboardingLayout';
import onboardingTheme from '../components/auth/common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

const options = [
  {
    key: 'passenger',
    title: 'Quero viajar',
    subtitle: 'Solicite viagens, acompanhe preço e pagamento com calma.',
    icon: 'car-outline'
  },
  {
    key: 'driver',
    title: 'Quero dirigir',
    subtitle: 'Envie documentos, receba corridas e acompanhe ganhos.',
    icon: 'navigate-outline'
  }
];

export default function ProfileSelectionScreen() {
  const navigation = useNavigation();
  const [selected, setSelected] = useState(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true
      })
    ]).start();
  }, []);

  const handleOptionPress = (optionKey) => {
    setSelected(optionKey);

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true
      })
    ]).start();
  };

  const handleContinue = async () => {
    if (selected) {
      await AsyncStorage.setItem('@user_type', selected);

      navigation.navigate('PhoneInputScreen', { userType: selected });
    }
  };

  const progressBar = (
    <View style={styles.progressBarContainer}>
      <View style={[styles.progressDot, styles.progressActive]} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
      <View style={styles.progressDot} />
    </View>
  );

  return (
    <OnboardingLayout
      progress={progressBar}
      onContinue={handleContinue}
      continueLabel="Continuar"
      continueDisabled={!selected}
    >
      <Animated.View style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }]
        }
      ]}>
        <View style={styles.header}>
          <Text style={styles.title}>Como você quer usar a Leaf?</Text>
          <Text style={styles.subtitle}>
            Escolha o tipo de conta que melhor se adapta às suas necessidades
          </Text>
        </View>

        <View style={styles.optionsWrapper}>
          {options.map(opt => {
            const isSelected = selected === opt.key;
            return (
              <Animated.View
                key={opt.key}
                style={styles.optionContainer}
              >
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    isSelected && styles.optionButtonSelected
                  ]}
                  onPress={() => handleOptionPress(opt.key)}
                  activeOpacity={0.9}
                >
                  <View style={styles.optionContent}>
                    <View style={[
                      styles.iconContainer,
                      isSelected && styles.iconContainerSelected
                    ]}>
                      <Ionicons
                        name={opt.icon}
                        size={22}
                        color={color.accent}
                      />
                    </View>
                    
                    <View style={styles.textContainer}>
                      <Text style={styles.optionTitle}>
                        {opt.title}
                      </Text>
                      <Text style={styles.optionSubtitle}>
                        {opt.subtitle}
                      </Text>
                    </View>

                    {isSelected && (
                      <View style={styles.checkmarkContainer}>
                        <Text style={styles.checkmark}>✓</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

      </Animated.View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    width: '100%',
    paddingTop: spacing.lg
  },
  header: {
    alignItems: 'flex-start',
    marginBottom: spacing.xl
  },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontFamily: fonts.Bold,
    color: color.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'left',
    letterSpacing: 0
  },
  subtitle: {
    fontSize: 15,
    color: color.textSecondary,
    textAlign: 'left',
    lineHeight: 21,
    fontFamily: fonts.Regular
  },
  optionsWrapper: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    width: '100%',
    gap: spacing.sm
  },
  optionContainer: {
    width: '100%',
    shadowColor: color.accent
  },
  optionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 92,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panelSoft,
    position: 'relative',
    overflow: 'hidden'
  },
  optionButtonSelected: {
    backgroundColor: color.surface,
    borderColor: color.borderStrong,
    ...elevation.soft
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    zIndex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  iconContainerSelected: {
    backgroundColor: 'rgba(232,239,231,0.95)'
  },
  textContainer: {
    flex: 1
  },
  optionTitle: {
    color: color.textPrimary,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fonts.SemiBold,
    marginBottom: 3,
    letterSpacing: 0
  },
  optionSubtitle: {
    color: color.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Regular,
    letterSpacing: 0
  },
  checkmarkContainer: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm
  },
  checkmark: {
    color: color.accentText,
    fontSize: 16,
    fontWeight: 'bold'
  },
  progressBarContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 0,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: color.borderStrong,
    marginHorizontal: 4
  },
  progressActive: {
    backgroundColor: color.accent
  }
});
