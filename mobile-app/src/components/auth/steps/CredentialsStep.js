import React, { useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../theme/runtimeTokens';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import { AppConfig } from '../../../../config/AppConfig';

const { color, spacing } = onboardingTheme;

const CredentialsStep = ({ onCreated, onBack, initialData = {}, progressMeta }) => {
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

  const openLegalLink = async (url, label) => {
    try {
      const normalizedUrl = String(url || '').trim();
      if (!normalizedUrl) {
        Alert.alert('Indisponível', `URL de ${label} não configurada.`);
        return;
      }

      const supported = await Linking.canOpenURL(normalizedUrl);
      if (!supported) {
        Alert.alert('Indisponível', `Não foi possível abrir ${label} agora.`);
        return;
      }

      await Linking.openURL(normalizedUrl);
    } catch (_error) {
      Alert.alert('Erro', `Não foi possível abrir ${label}.`);
    }
  };

  return (
    <EditorialOnboardingScreen
      title={'Confirme\npermissões'}
      description={isDriver
        ? 'Revise os consentimentos necessários para dirigir com segurança pela Leaf.'
        : 'Revise os termos para finalizar sua conta.'}
      onBack={onBack}
      progressMeta={progressMeta}
      footer={<ContinueButton onPress={handleSubmit} disabled={!isFormValid} text="Concluir" />}
    >
      <View style={styles.legalLinksRow}>
        <TouchableOpacity onPress={() => openLegalLink(AppConfig.terms_of_service_url, 'Termos de Uso')}>
          <Text style={styles.legalLinkText}>Ler Termos de Uso</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openLegalLink(AppConfig.privacy_policy_url, 'Política de Privacidade')}>
          <Text style={styles.legalLinkText}>Ler Política de Privacidade</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.block}>
        <Text style={styles.sectionLabel}>Obrigatório</Text>
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

            <Text style={styles.sectionLabel}>Opcional</Text>
            <ConsentRow
              checked={consents.marketingOptIn}
              label="Aceito receber comunicações promocionais (opcional)"
              onPress={() => toggleConsent('marketingOptIn')}
            />
          </>
        ) : null}
      </View>
    </EditorialOnboardingScreen>
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
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: spacing.md
  },
  backButton: {
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
    fontSize: 32,
    lineHeight: 36,
    color: color.textPrimary,
    fontFamily: fonts.Bold,
    letterSpacing: 0
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: color.textSecondary,
    fontFamily: fonts.Regular,
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18
  },
  legalLinkText: {
    fontSize: 12,
    lineHeight: 16,
    color: color.accent,
    textDecorationLine: 'underline',
    fontFamily: fonts.Medium
  },
  block: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 24,
    backgroundColor: color.surface,
    padding: 18
  },
  sectionLabel: {
    marginTop: 2,
    marginBottom: spacing.xs,
    color: color.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.Bold,
    textTransform: 'uppercase',
    letterSpacing: 0.8
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
