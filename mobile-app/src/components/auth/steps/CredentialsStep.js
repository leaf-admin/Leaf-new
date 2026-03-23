import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../common-local/font';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

const CredentialsStep = ({ onCreated, onBack, initialData = {} }) => {
  const isDriver = initialData?.profileSelection?.userType === 'driver';

  const [consents, setConsents] = useState({
    acceptTerms: initialData.acceptTerms || false,
    acceptPrivacy: initialData.acceptPrivacy || false,
    consentBackgroundCheck: initialData.consentBackgroundCheck || false,
    marketingOptIn: initialData.marketingOptIn || false
  });

  const [errors, setErrors] = useState({});

  const isFormValid = useMemo(() => {
    const baseAccepted = consents.acceptTerms && consents.acceptPrivacy;
    if (!baseAccepted) {
      return false;
    }

    if (!isDriver) {
      return true;
    }

    return consents.consentBackgroundCheck;
  }, [consents, isDriver]);

  const toggleConsent = field => {
    setConsents(previous => ({ ...previous, [field]: !previous[field] }));
    if (errors[field]) {
      setErrors(previous => ({ ...previous, [field]: '' }));
    }
  };

  const handleSubmit = () => {
    const nextErrors = {};

    if (!consents.acceptTerms) {
      nextErrors.acceptTerms = 'Você precisa aceitar os Termos de Uso.';
    }

    if (!consents.acceptPrivacy) {
      nextErrors.acceptPrivacy = 'Você precisa aceitar a Política de Privacidade.';
    }

    if (isDriver && !consents.consentBackgroundCheck) {
      nextErrors.consentBackgroundCheck = 'Consentimento para checagem de antecedentes é obrigatório para atuar.';
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onCreated(consents);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Finalizar cadastro</Text>
      </View>

      <Text style={styles.subtitle}>
        {isDriver
          ? 'Revise e confirme os consentimentos obrigatórios para ativação do motorista.'
          : 'Revise e confirme os termos para finalizar sua conta de passageiro.'}
      </Text>

      <View style={styles.block}>
        <ConsentRow
          checked={consents.acceptTerms}
          label="Aceito os Termos de Uso *"
          onPress={() => toggleConsent('acceptTerms')}
        />
        {errors.acceptTerms ? <Text style={styles.errorText}>{errors.acceptTerms}</Text> : null}

        <ConsentRow
          checked={consents.acceptPrivacy}
          label="Aceito a Política de Privacidade *"
          onPress={() => toggleConsent('acceptPrivacy')}
        />
        {errors.acceptPrivacy ? <Text style={styles.errorText}>{errors.acceptPrivacy}</Text> : null}

        {isDriver ? (
          <>
            <ConsentRow
              checked={consents.consentBackgroundCheck}
              label="Autorizo checagem de antecedentes criminais e validação regulatória *"
              onPress={() => toggleConsent('consentBackgroundCheck')}
            />
            {errors.consentBackgroundCheck ? (
              <Text style={styles.errorText}>{errors.consentBackgroundCheck}</Text>
            ) : null}

            <ConsentRow
              checked={consents.marketingOptIn}
              label="Aceito receber comunicações promocionais (opcional)"
              onPress={() => toggleConsent('marketingOptIn')}
            />
          </>
        ) : null}
      </View>

      <ContinueButton onPress={handleSubmit} disabled={!isFormValid} text="Concluir" />
    </ScrollView>
  );
};

function ConsentRow({ checked, label, onPress }) {
  return (
    <TouchableOpacity style={styles.consentRow} activeOpacity={0.86} onPress={onPress}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Ionicons name="checkmark" size={14} color={color.accentText} /> : null}
      </View>
      <Text style={styles.consentLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs
  },
  content: {
    paddingBottom: spacing.xs
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm
  },
  backButton: {
    padding: 6,
    marginRight: 8
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    color: color.textPrimary,
    fontFamily: fonts.Bold
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: color.textSecondary,
    fontFamily: fonts.Regular,
    marginBottom: spacing.sm
  },
  block: {
    borderWidth: 1,
    borderColor: color.glassStroke,
    borderRadius: radius.lg,
    backgroundColor: color.panelSoft,
    padding: spacing.sm,
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 9
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginRight: 8,
    backgroundColor: color.surfaceMuted
  },
  checkboxChecked: {
    borderColor: color.accent,
    backgroundColor: color.accent
  },
  consentLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: color.textPrimary,
    fontFamily: fonts.Medium
  },
  errorText: {
    marginTop: -4,
    marginBottom: 8,
    marginLeft: 26,
    color: color.error,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Medium
  }
});

export default CredentialsStep;
