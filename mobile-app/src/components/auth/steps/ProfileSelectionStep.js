import Logger from '../../../utils/Logger';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../theme/runtimeTokens';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

const options = [
  {
    key: 'customer',
    title: 'Quero viajar',
    icon: 'car-outline',
    description: 'Solicite viagens com experiência premium'
  },
  {
    key: 'driver',
    title: 'Quero dirigir',
    icon: 'navigate-outline',
    description: 'Dirija com a Leaf e receba por corrida'
  }
];

function normalizeUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType;
}

const ProfileSelectionStep = ({ onProfileSelected, onBack, initialData = {} }) => {
  const [selected, setSelected] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const normalizedType = normalizeUserType(initialData?.userType);
    if (!normalizedType) {
      return;
    }

    const match = options.find(item => item.key === normalizedType);
    if (match) {
      setSelected(match);
      Logger.log('ProfileSelectionStep - dados iniciais carregados:', normalizedType);
    }
  }, [initialData?.userType]);

  const toggleDropdown = () => {
    const nextOpen = !isDropdownOpen;
    setIsDropdownOpen(nextOpen);

    Animated.parallel([
      Animated.timing(dropdownAnim, {
        toValue: nextOpen ? 1 : 0,
        duration: 240,
        useNativeDriver: false
      }),
      Animated.timing(rotateAnim, {
        toValue: nextOpen ? 1 : 0,
        duration: 240,
        useNativeDriver: false
      })
    ]).start();
  };

  const handleOptionSelect = useCallback(
    async option => {
      setSelected(option);
      setIsDropdownOpen(false);

      await saveStepData('profile_selection', { userType: option.key });

      Animated.parallel([
        Animated.timing(dropdownAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: false
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: false
        })
      ]).start();
    },
    [dropdownAnim, rotateAnim]
  );

  const handleContinue = () => {
    if (!selected) {
      return;
    }

    onProfileSelected({
      userType: selected.key,
      timestamp: new Date().toISOString()
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Escolha seu perfil</Text>
      <Text style={styles.subtitle}>Você pode alternar entre passageiro e motorista no app depois.</Text>

      <View style={styles.card}>
        <View style={styles.dropdownContainer}>
          <TouchableOpacity
            style={[styles.dropdownButton, selected ? styles.dropdownButtonSelected : null]}
            activeOpacity={0.88}
            onPress={toggleDropdown}
            testID="auth-profile-selection-trigger"
            accessibilityLabel="auth-profile-selection-trigger"
          >
            <Text style={[styles.dropdownButtonText, selected ? styles.dropdownButtonTextSelected : null]}>
              {selected ? selected.title : 'Selecione um perfil'}
            </Text>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: rotateAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '180deg']
                    })
                  }
                ]
              }}
            >
              <Ionicons name="chevron-down" size={22} color={selected ? color.accentText : color.textSecondary} />
            </Animated.View>
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.dropdownList,
              {
                maxHeight: dropdownAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 220]
                }),
                opacity: dropdownAnim
              }
            ]}
          >
            {options.map(option => {
              const selectedOption = selected?.key === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.optionRow, selectedOption ? styles.optionRowSelected : null]}
                  onPress={() => handleOptionSelect(option)}
                  activeOpacity={0.9}
                  testID={`auth-profile-option-${option.key}`}
                  accessibilityLabel={`auth-profile-option-${option.key}`}
                >
                  <Ionicons
                    name={option.icon}
                    size={20}
                    color={selectedOption ? color.accentText : color.textPrimary}
                  />
                  <View style={styles.optionTextWrap}>
                    <Text style={[styles.optionTitle, selectedOption ? styles.optionTitleSelected : null]}>
                      {option.title}
                    </Text>
                    <Text
                      style={[
                        styles.optionDescription,
                        selectedOption ? styles.optionDescriptionSelected : null
                      ]}
                    >
                      {option.description}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        </View>
      </View>

      <ContinueButton
        onPress={handleContinue}
        disabled={!selected}
        text="Continuar"
        testID="auth-profile-selection-continue-btn"
        accessibilityLabel="auth-profile-selection-continue-btn"
      />

      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack}
        testID="auth-profile-selection-back-btn"
        accessibilityLabel="auth-profile-selection-back-btn"
      >
        <Text style={styles.backButtonText}>Voltar</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  title: {
    color: color.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fonts.Bold,
    textAlign: 'center'
  },
  subtitle: {
    marginTop: 8,
    marginBottom: spacing.md,
    color: color.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Regular,
    textAlign: 'center'
  },
  card: {
    backgroundColor: color.panelSoft,
    borderWidth: 1,
    borderColor: color.glassStroke,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 9
  },
  dropdownContainer: {
    marginBottom: 6
  },
  dropdownButton: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surfaceMuted,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  dropdownButtonSelected: {
    borderColor: color.accent,
    backgroundColor: color.accent
  },
  dropdownButtonText: {
    color: color.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.Medium
  },
  dropdownButtonTextSelected: {
    color: color.accentText
  },
  dropdownList: {
    overflow: 'hidden',
    marginTop: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface
  },
  optionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border
  },
  optionRowSelected: {
    backgroundColor: color.accent
  },
  optionTextWrap: {
    flex: 1,
    marginLeft: 8
  },
  optionTitle: {
    color: color.textPrimary,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fonts.SemiBold
  },
  optionTitleSelected: {
    color: color.accentText
  },
  optionDescription: {
    marginTop: 1,
    color: color.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fonts.Regular
  },
  optionDescriptionSelected: {
    color: 'rgba(255,255,255,0.88)'
  },
  backButton: {
    alignSelf: 'center',
    marginTop: -4,
    marginBottom: spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  backButtonText: {
    color: color.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Medium
  }
});

export default ProfileSelectionStep;
