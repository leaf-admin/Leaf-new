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
  const [selected, setSelected] = useState(options[0]);

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
      <Text style={styles.subtitle}>Escolha agora. Você pode trocar depois no perfil.</Text>

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
                <View style={styles.leafGlyph} />
              </View>
              <View style={styles.roleTextWrap}>
                <Text style={styles.roleTitle}>{option.title}</Text>
                <Text style={styles.roleDescription}>{option.description}</Text>
              </View>
              {selectedOption ? (
                <View style={styles.checkBadge}>
                  <Text style={styles.checkBadgeText}>Selecionado</Text>
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
        style={styles.continueButton}
        textStyle={styles.continueButtonText}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 66,
    paddingBottom: 84,
    backgroundColor: '#F6FAF6'
  },
  header: {
    position: 'absolute',
    top: 14,
    left: 12,
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: 0,
    opacity: 0
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
    color: '#102018',
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fonts.Medium,
    textAlign: 'left',
    letterSpacing: 0
  },
  subtitle: {
    marginTop: 7,
    marginBottom: 66,
    color: '#66756B',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Regular,
    textAlign: 'left'
  },
  roleList: {
    gap: 22,
    marginBottom: 'auto'
  },
  roleCard: {
    minHeight: 122,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#DFE8E1',
    backgroundColor: '#FFFFFF'
  },
  roleCardSelected: {
    borderColor: '#1FA76F',
    backgroundColor: '#FFFFFF',
    shadowOpacity: 0,
    elevation: 0
  },
  roleIcon: {
    width: 18,
    height: 28,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginRight: 18,
    marginTop: 4
  },
  roleIconSelected: {
    backgroundColor: 'transparent'
  },
  leafGlyph: {
    width: 12,
    height: 16,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    borderBottomLeftRadius: 3,
    backgroundColor: '#0F3B16',
    transform: [{ rotate: '-34deg' }]
  },
  roleTextWrap: {
    flex: 1
  },
  roleTitle: {
    color: '#101C14',
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fonts.Medium
  },
  roleDescription: {
    marginTop: 6,
    color: '#66756B',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Regular
  },
  checkBadge: {
    width: 86,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EAF6EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10
  },
  checkBadgeText: {
    color: '#0F3B16',
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15
  },
  continueButton: {
    minHeight: 46,
    borderRadius: 23,
    marginTop: 0,
    marginBottom: 0,
    shadowOpacity: 0,
    elevation: 0
  },
  continueButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Medium
  }
});

export default ProfileSelectionStep;
