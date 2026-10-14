import React, { useMemo, useState } from 'react';
import { Alert, Linking } from 'react-native';
import ContinueButton from '../common/ContinueButton';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import { ConsentRow } from '../../onboarding/onboardingSteps';
import { AppConfig } from '../../../../config/AppConfig';

const CredentialsStep = ({ onCreated, onBack, initialData = {}, progressMeta, isSubmitting = false }) => {
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

  const submitLabel = isDriver ? 'Aceitar e enviar cadastro' : 'Concluir';

  return (
    <EditorialOnboardingScreen
      title={isDriver ? 'Últimos combinados' : 'Termos da Leaf'}
      description={isDriver
        ? 'Para dirigir com a Leaf precisamos do seu aceite nestes pontos.'
        : 'Revise os termos para finalizar sua conta.'}
      onBack={onBack}
      progressMeta={progressMeta}
      footer={(
        <ContinueButton
          onPress={handleSubmit}
          disabled={!isFormValid || isSubmitting}
          text={isSubmitting ? 'Enviando…' : submitLabel}
          testID="auth-credentials-submit"
        />
      )}
    >
      <ConsentRow
        title="Termos de Uso"
        description="Regras de uso da plataforma."
        required
        checked={consents.acceptTerms}
        onToggle={() => toggleConsent('acceptTerms')}
        onOpen={() => openLegalLink(AppConfig.terms_of_service_url, 'os Termos de Uso')}
        testID="auth-credentials-terms-consent"
      />
      <ConsentRow
        title="Política de Privacidade"
        description="Como cuidamos dos seus dados."
        required
        checked={consents.acceptPrivacy}
        onToggle={() => toggleConsent('acceptPrivacy')}
        onOpen={() => openLegalLink(AppConfig.privacy_policy_url, 'a Política de Privacidade')}
        testID="auth-credentials-privacy-consent"
      />
      {isDriver ? (
        <>
          <ConsentRow
            title="Checagem de antecedentes"
            description="Autorizo a consulta de antecedentes criminais e a validação regulatória."
            required
            checked={consents.consentBackgroundCheck}
            onToggle={() => toggleConsent('consentBackgroundCheck')}
            testID="auth-driver-background-check-consent"
          />
          <ConsentRow
            title="Novidades e promoções"
            description="Aceito receber comunicações promocionais sobre campanhas e ganhos extras."
            checked={consents.marketingOptIn}
            onToggle={() => toggleConsent('marketingOptIn')}
            testID="auth-driver-marketing-consent"
          />
        </>
      ) : null}
    </EditorialOnboardingScreen>
  );
};

export default CredentialsStep;
