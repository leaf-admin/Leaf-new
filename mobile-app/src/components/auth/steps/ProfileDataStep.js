import leafTypography from '../../prototype/LeafTypography';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { ZoomIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import { OnboardingField } from '../../onboarding/onboardingKit';
import { useHapticFeedback } from '../../../hooks/useHapticFeedback';
import { AppConfig } from '../../../../config/AppConfig';

// Nome (e, para passageiro, e-mail opcional + aceite). Sem senha no cadastro: o acesso é pelo
// código do celular e a sessão fica salva; quem quiser cria uma senha depois, na Conta.
const { color } = onboardingTheme;
const EMAIL_REGEX = /\S+@\S+\.\S+/;

const ProfileDataStep = ({ onSubmitted, onBack, initialData = {}, progressMeta, isSubmitting = false }) => {
  const haptic = useHapticFeedback();
  const [profileData, setProfileData] = useState({
    fullName: initialData.fullName || [initialData.firstName, initialData.lastName].filter(Boolean).join(' ').trim(),
    email: initialData?.documentData?.email || initialData?.email || '',
    acceptLegal: Boolean(
      (initialData?.credentials?.acceptTerms || initialData?.acceptTerms) &&
      (initialData?.credentials?.acceptPrivacy || initialData?.acceptPrivacy)
    ),
  });
  const [errors, setErrors] = useState({});
  const isDriver = useMemo(() => initialData?.profileSelection?.userType === 'driver', [initialData?.profileSelection?.userType]);

  const normalizedEmail = String(profileData.email || '').trim();
  const nameOk = String(profileData.fullName || '').trim().split(/\s+/).filter(Boolean).length >= 2;
  const emailOk = !normalizedEmail || EMAIL_REGEX.test(normalizedEmail);
  const isFormValid = nameOk && (isDriver || (emailOk && profileData.acceptLegal));

  const update = useCallback(async (field, value) => {
    const next = { ...profileData, [field]: value };
    setProfileData(next);
    setErrors((previous) => (previous[field] ? { ...previous, [field]: '' } : previous));
    await saveStepData('profile_data', next);
  }, [profileData]);

  const openLegalLink = useCallback(async (url, label) => {
    try {
      const normalizedUrl = String(url || '').trim();
      if (!normalizedUrl || !(await Linking.canOpenURL(normalizedUrl))) {
        Alert.alert('Indisponível', `Não foi possível abrir ${label} agora.`);
        return;
      }
      await Linking.openURL(normalizedUrl);
    } catch (_error) {
      Alert.alert('Erro', `Não foi possível abrir ${label}.`);
    }
  }, []);

  const handleSubmit = () => {
    const nextErrors = {};
    if (!nameOk) nextErrors.fullName = 'Informe nome e sobrenome.';
    if (!isDriver && !emailOk) nextErrors.email = 'Confira o e-mail.';
    if (!isDriver && !profileData.acceptLegal) nextErrors.acceptLegal = 'Para continuar, aceite os Termos e a Política de Privacidade.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      haptic('error');
      return;
    }
    onSubmitted({
      fullName: profileData.fullName.trim(),
      ...(isDriver ? {} : {
        email: normalizedEmail.toLowerCase(),
        acceptTerms: true,
        acceptPrivacy: true,
      }),
    });
  };

  return (
    <EditorialOnboardingScreen
      keyboard
      title={isDriver ? 'Qual é o seu nome?' : 'Como podemos te chamar?'}
      description={isDriver
        ? 'Use o nome como está na sua CNH.'
        : 'Seu nome aparece para o motorista na hora do embarque.'}
      onBack={onBack}
      progressMeta={progressMeta}
      footer={(
        <ContinueButton
          testID="auth-profile-submit"
          onPress={handleSubmit}
          disabled={!isFormValid || isSubmitting}
          text={isSubmitting ? 'Salvando…' : 'Continuar'}
        />
      )}
    >
      <OnboardingField
        label="Nome e sobrenome"
        value={profileData.fullName}
        onChangeText={(value) => update('fullName', value)}
        placeholder="Ana Souza"
        autoCapitalize="words"
        textContentType="name"
        autoComplete="name"
        error={errors.fullName}
        testID="auth-profile-full-name-input"
      />
      {!isDriver ? (
        <>
          <OnboardingField
            label="E-mail (opcional)"
            accessibilityLabel="E-mail"
            value={profileData.email}
            onChangeText={(value) => update('email', value)}
            placeholder="voce@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            textContentType="emailAddress"
            autoComplete="email"
            error={errors.email}
            hint="Para receber os recibos das corridas."
            testID="auth-profile-email-input"
          />
          <Pressable
            onPress={() => { haptic('tap'); update('acceptLegal', !profileData.acceptLegal); }}
            style={styles.consentRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: profileData.acceptLegal }}
            testID="auth-profile-legal-consent"
          >
            <View style={[styles.checkbox, profileData.acceptLegal && styles.checkboxChecked]}>
              {profileData.acceptLegal ? (
                <Reanimated.View entering={ZoomIn.duration(140)}>
                  <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                </Reanimated.View>
              ) : null}
            </View>
            <Text style={styles.consentText}>
              Li e aceito os{' '}
              <Text style={styles.link} onPress={() => openLegalLink(AppConfig.terms_of_service_url, 'os Termos de Uso')}>Termos de Uso</Text>
              {' '}e a{' '}
              <Text style={styles.link} onPress={() => openLegalLink(AppConfig.privacy_policy_url, 'a Política de Privacidade')}>Política de Privacidade</Text>.
            </Text>
          </Pressable>
          {errors.acceptLegal ? <Text style={styles.error}>{errors.acceptLegal}</Text> : null}
        </>
      ) : null}
    </EditorialOnboardingScreen>
  );
};

const styles = StyleSheet.create({
  consentRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 6 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(17,33,12,0.22)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: color.accent, borderColor: color.accent },
  consentText: { flex: 1, ...leafTypography.regular, fontSize: 15, lineHeight: 22, color: color.textSecondary },
  link: { ...leafTypography.medium, color: color.textPrimary, textDecorationLine: 'underline' },
  error: { ...leafTypography.medium, fontSize: 13, color: color.error, marginTop: 8 },
});

export default ProfileDataStep;
