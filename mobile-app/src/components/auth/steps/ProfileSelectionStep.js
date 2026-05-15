import Logger from '../../../utils/Logger';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

  const handleOptionSelect = useCallback(
    async option => {
      setSelected(option);

      await saveStepData('profile_selection', { userType: option.key });
    },
    []
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
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconBackButton}
          onPress={onBack}
          testID="auth-profile-selection-back-btn"
          accessibilityLabel="auth-profile-selection-back-btn"
        >
          <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Como você quer usar a Leaf?</Text>
      <Text style={styles.subtitle}>Você pode alternar entre passageiro e motorista no app depois.</Text>

      <View style={styles.roleList}>
        {options.map(option => {
          const selectedOption = selected?.key === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.roleCard, selectedOption ? styles.roleCardSelected : null]}
              onPress={() => handleOptionSelect(option)}
              activeOpacity={0.9}
              testID={`auth-profile-option-${option.key}`}
              accessibilityLabel={`auth-profile-option-${option.key}`}
            >
              <View style={[styles.roleIcon, selectedOption ? styles.roleIconSelected : null]}>
                <Ionicons
                  name={option.icon}
                  size={22}
                  color={selectedOption ? color.accent : color.accent}
                />
              </View>
              <View style={styles.roleTextWrap}>
                <Text style={styles.roleTitle}>{option.title}</Text>
                <Text style={styles.roleDescription}>{option.description}</Text>
              </View>
              {selectedOption ? (
                <View style={styles.checkBadge}>
                  <Ionicons name="checkmark" size={14} color={color.accentText} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <ContinueButton
        onPress={handleContinue}
        disabled={!selected}
        text="Continuar"
        testID="auth-profile-selection-continue-btn"
        accessibilityLabel="auth-profile-selection-continue-btn"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm
  },
  header: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: spacing.lg
  },
  iconBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panelSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    color: color.textPrimary,
    fontSize: 32,
    lineHeight: 36,
    fontFamily: fonts.Bold,
    textAlign: 'left',
    letterSpacing: 0
  },
  subtitle: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    color: color.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fonts.Regular,
    textAlign: 'left'
  },
  roleList: {
    gap: spacing.sm,
    marginBottom: 'auto'
  },
  roleCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panelSoft
  },
  roleCardSelected: {
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    shadowColor: color.accent,
    ...elevation.soft
  },
  roleIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accentSoft,
    marginRight: spacing.sm
  },
  roleIconSelected: {
    backgroundColor: 'rgba(232,239,231,0.95)'
  },
  roleTextWrap: {
    flex: 1
  },
  roleTitle: {
    color: color.textPrimary,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fonts.SemiBold
  },
  roleDescription: {
    marginTop: 3,
    color: color.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Regular
  },
  checkBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm
  }
});

export default ProfileSelectionStep;
