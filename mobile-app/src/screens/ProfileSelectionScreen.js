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
    subtitle: 'Encontre motoristas próximos e faça suas viagens',
    icon: 'car-sport-outline'
  },
  {
    key: 'driver',
    title: 'Quero ser parceiro',
    subtitle: 'Dirija e ganhe dinheiro com suas viagens',
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
                style={[
                  styles.optionContainer,
                  { transform: [{ scale: isSelected ? 1.02 : 1 }] }
                ]}
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
                        size={28}
                        color={isSelected ? color.accentText : color.textPrimary}
                      />
                    </View>
                    
                    <View style={styles.textContainer}>
                      <Text style={[
                        styles.optionTitle,
                        { color: isSelected ? color.accentText : color.textPrimary }
                      ]}>
                        {opt.title}
                      </Text>
                      <Text style={[
                        styles.optionSubtitle,
                        { color: isSelected ? 'rgba(255,255,255,0.86)' : color.textSecondary }
                      ]}>
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

        {selected && (
          <Animated.View style={[styles.selectedInfo, { opacity: fadeAnim }]}>
            <Text style={styles.selectedInfoText}>
              Você selecionou: {options.find(opt => opt.key === selected)?.title}
            </Text>
          </Animated.View>
        )}
      </Animated.View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    width: '100%',
    paddingTop: spacing.xs
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm
  },
  title: {
    fontSize: 26,
    fontFamily: fonts.Bold,
    color: color.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 0.3
  },
  subtitle: {
    fontSize: 16,
    color: color.textSecondary,
    textAlign: 'center',
    lineHeight: 22
  },
  optionsWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    gap: spacing.md
  },
  optionContainer: {
    width: '100%',
    shadowColor: '#0E1522',
    ...elevation.soft
  },
  optionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.panel,
    position: 'relative',
    overflow: 'hidden'
  },
  optionButtonSelected: {
    backgroundColor: color.accent,
    borderColor: color.accent
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    zIndex: 1,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: color.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16
  },
  iconContainerSelected: {
    backgroundColor: 'rgba(255,255,255,0.18)'
  },
  textContainer: {
    flex: 1
  },
  optionTitle: {
    fontSize: 20,
    fontFamily: fonts.SemiBold,
    marginBottom: 4,
    letterSpacing: 0.2
  },
  optionSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1
  },
  checkmarkContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkmark: {
    color: color.accentText,
    fontSize: 18,
    fontWeight: 'bold'
  },
  selectedInfo: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm
  },
  selectedInfoText: {
    fontSize: 14,
    color: color.textSecondary,
    textAlign: 'center',
    fontFamily: fonts.Medium
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
