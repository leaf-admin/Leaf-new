import Logger from '../../../utils/Logger';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fonts } from '../../../theme/runtimeTokens';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';

const { color } = onboardingTheme;

const options = [
  {
    key: 'customer',
    title: 'Quero viajar',
    description: 'Solicite viagens com experiência premium'
  },
  {
    key: 'driver',
    title: 'Quero dirigir',
    description: 'Dirija com a Leaf e receba por corrida'
  }
];

function normalizeUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType;
}

const ProfileSelectionStep = ({ onProfileSelected, onBack, initialData = {}, progressMeta }) => {
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
    <EditorialOnboardingScreen
      title={'Escolha\nde perfil'}
      description="Conta pra gente como você quer usar a Leaf agora. Dá pra ajustar isso depois no perfil."
      onBack={onBack}
      backTestID="auth-profile-selection-back-btn"
      backAccessibilityLabel="auth-profile-selection-back-btn"
      progressMeta={progressMeta}
      footer={(
        <ContinueButton
          onPress={handleContinue}
          disabled={!selected}
          text="Continuar"
          testID="auth-profile-selection-continue-btn"
          accessibilityLabel="auth-profile-selection-continue-btn"
        />
      )}
    >
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
              <View style={styles.roleTextWrap}>
                <View style={styles.roleTopRow}>
                  <View style={[styles.leafGlyph, selectedOption ? styles.leafGlyphSelected : null]} />
                  {selectedOption ? (
                    <View style={styles.checkDot}>
                      <Text style={styles.checkDotText}>✓</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.roleTitle}>{option.title}</Text>
                <Text style={styles.roleDescription}>{option.description}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </EditorialOnboardingScreen>
  );
};

const styles = StyleSheet.create({
  roleList: {
    gap: 20
  },
  roleCard: {
    minHeight: 128,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: '#FFFFFF'
  },
  roleCardSelected: {
    borderWidth: 2,
    borderColor: color.accent,
    backgroundColor: '#FFFFFF'
  },
  roleTopRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  leafGlyph: {
    width: 15,
    height: 21,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    borderBottomLeftRadius: 3,
    backgroundColor: color.textMuted,
    transform: [{ rotate: '-34deg' }]
  },
  leafGlyphSelected: {
    backgroundColor: color.accent
  },
  roleTextWrap: {
    flex: 1
  },
  roleTitle: {
    color: color.textPrimary,
    fontSize: 20,
    lineHeight: 25,
    fontFamily: fonts.Bold
  },
  roleDescription: {
    marginTop: 5,
    color: color.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Regular
  },
  checkDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkDotText: {
    color: color.accentText,
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 18
  }
});

export default ProfileSelectionStep;
