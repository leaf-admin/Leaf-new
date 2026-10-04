import leafTypography from '../../prototype/LeafTypography';
import { LeafObjectIcon } from '../../prototype/LeafVisualElements';
import Logger from '../../../utils/Logger';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
    <EditorialOnboardingScreen
      title={'Escolha\nde perfil'}
      description="Conta pra gente como você quer usar a Leaf agora. Dá pra ajustar isso depois no perfil."
      onBack={onBack}
      backTestID="auth-profile-selection-back-btn"
      backAccessibilityLabel="Voltar"
      progressMeta={progressMeta}
      footer={(
        <ContinueButton
          onPress={handleContinue}
          disabled={!selected}
          text="Continuar"
          testID="auth-profile-selection-continue-btn"
          accessibilityLabel="Continuar"
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
              accessibilityRole="button"
              accessibilityLabel={`${option.title}. ${option.description}`}
              accessibilityHint={selectedOption
                ? 'Perfil selecionado.'
                : 'Toque para selecionar este perfil.'}
              accessibilityState={{ selected: selectedOption }}
            >
              <View style={styles.roleTextWrap}>
                <View style={styles.roleTopRow}>
                  <LeafObjectIcon name={option.key === 'driver' ? 'vehicle' : 'places'} size={48} />
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
    minHeight: 48,
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
    ...leafTypography.bold
  },
  roleDescription: {
    marginTop: 5,
    color: color.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    ...leafTypography.regular
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
    ...leafTypography.bold,
    fontSize: 13,
    lineHeight: 18
  }
});

export default ProfileSelectionStep;
