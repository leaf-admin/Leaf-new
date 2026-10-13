import leafTypography from '../../prototype/LeafTypography';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import EditorialOnboardingScreen from '../common/EditorialOnboardingLayout';
import { AppConfig } from '../../../../config/AppConfig';

const { color, spacing } = onboardingTheme;
const EMAIL_REGEX = /\S+@\S+\.\S+/;
const PASSWORD_REGEX = /(?=.*[A-Za-z])(?=.*\d)/;

const ProfileDataStep = ({ onSubmitted, onBack, initialData = {}, progressMeta, isSubmitting = false }) => {
	  const [profileData, setProfileData] = useState({
	    fullName: initialData.fullName || [initialData.firstName, initialData.lastName].filter(Boolean).join(' ').trim(),
	    email: initialData?.documentData?.email || initialData?.email || '',
	    password: initialData?.credentials?.password || '',
	    confirmPassword: initialData?.credentials?.confirmPassword || '',
	    acceptTerms: Boolean(initialData?.credentials?.acceptTerms || initialData?.acceptTerms),
	    acceptPrivacy: Boolean(initialData?.credentials?.acceptPrivacy || initialData?.acceptPrivacy)
	  });
	  const [showPassword, setShowPassword] = useState(false);
	  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});

  const isDriver = useMemo(() => initialData?.profileSelection?.userType === 'driver', [initialData?.profileSelection?.userType]);

  const validateFields = useCallback(() => {
    const nextErrors = {};
    const normalizedEmail = String(profileData.email || '').trim();
    const normalizedPassword = String(profileData.password || '');
    const normalizedConfirmPassword = String(profileData.confirmPassword || '');

    if (!profileData.fullName?.trim()) {
      nextErrors.fullName = 'Nome completo é obrigatório';
    }

    if (!isDriver) {
	      if (!normalizedEmail) {
	        nextErrors.email = 'E-mail é obrigatório.';
	      } else if (!EMAIL_REGEX.test(normalizedEmail)) {
	        nextErrors.email = 'E-mail inválido';
	      }

      if (!normalizedPassword) {
        nextErrors.password = 'Senha é obrigatória.';
      } else if (normalizedPassword.length < 8) {
        nextErrors.password = 'A senha deve ter pelo menos 8 caracteres.';
      } else if (!PASSWORD_REGEX.test(normalizedPassword)) {
        nextErrors.password = 'A senha deve conter letras e números.';
      }

      if (!normalizedConfirmPassword) {
        nextErrors.confirmPassword = 'Confirme sua senha.';
      } else if (normalizedPassword !== normalizedConfirmPassword) {
        nextErrors.confirmPassword = 'As senhas não coincidem.';
      }

      if (!profileData.acceptTerms) {
        nextErrors.acceptTerms = 'Você precisa aceitar os Termos de Uso.';
      }

      if (!profileData.acceptPrivacy) {
        nextErrors.acceptPrivacy = 'Você precisa aceitar a Política de Privacidade.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
	  }, [isDriver, profileData.acceptPrivacy, profileData.acceptTerms, profileData.confirmPassword, profileData.email, profileData.fullName, profileData.password]);

  const isFormValid = useMemo(() => {
    const normalizedEmail = String(profileData.email || '').trim();
    const normalizedPassword = String(profileData.password || '');
    const normalizedConfirmPassword = String(profileData.confirmPassword || '');

    if (!profileData.fullName?.trim()) {
      return false;
    }

    if (isDriver) {
      return true;
    }

	    return (
	      Boolean(normalizedEmail) &&
        EMAIL_REGEX.test(normalizedEmail) &&
        normalizedPassword.length >= 8 &&
        PASSWORD_REGEX.test(normalizedPassword) &&
        normalizedPassword === normalizedConfirmPassword &&
        profileData.acceptTerms &&
        profileData.acceptPrivacy
	    );
	  }, [isDriver, profileData.acceptPrivacy, profileData.acceptTerms, profileData.confirmPassword, profileData.email, profileData.fullName, profileData.password]);

  const passwordMatchState = useMemo(() => {
    const normalizedPassword = String(profileData.password || '');
    const normalizedConfirmPassword = String(profileData.confirmPassword || '');

    if (!normalizedPassword || !normalizedConfirmPassword) {
      return null;
    }

    const matches = normalizedPassword === normalizedConfirmPassword;
    return {
      matches,
      icon: matches ? 'checkmark-circle' : 'alert-circle',
      text: matches ? 'Senhas iguais' : 'As senhas não coincidem'
    };
  }, [profileData.confirmPassword, profileData.password]);

  const updateField = useCallback(
    async (field, value) => {
      const nextData = { ...profileData, [field]: value };
      setProfileData(nextData);
      await saveStepData('profile_data', nextData);

      if (errors[field] || field === 'password' || field === 'confirmPassword') {
        setErrors(previous => ({
          ...previous,
          [field]: '',
          ...(field === 'password' || field === 'confirmPassword'
            ? { password: '', confirmPassword: '' }
            : {})
        }));
      }
    },
    [errors, profileData]
  );

  const toggleConsent = useCallback(async (field) => {
    const nextData = { ...profileData, [field]: !profileData[field] };
    setProfileData(nextData);
    await saveStepData('profile_data', nextData);
    if (errors[field]) {
      setErrors(previous => ({ ...previous, [field]: '' }));
    }
  }, [errors, profileData]);

  const openLegalLink = useCallback(async (url, label) => {
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
  }, []);

  const handleSubmit = () => {
    if (!validateFields()) {
      return;
    }

    const normalizedEmail = String(profileData.email || '').trim().toLowerCase();
    const normalizedPassword = String(profileData.password || '');
    const normalizedConfirmPassword = String(profileData.confirmPassword || '');

	    onSubmitted({
      fullName: profileData.fullName.trim(),
      ...(isDriver
        ? {}
        : {
	            email: normalizedEmail,
	            password: normalizedPassword,
	            confirmPassword: normalizedConfirmPassword,
	            acceptTerms: profileData.acceptTerms,
	            acceptPrivacy: profileData.acceptPrivacy
	          })
    });
  };

  return (
    <EditorialOnboardingScreen
      keyboard
      title={'Complete\nseus dados'}
      description="Confirme seu nome, e-mail e senha para deixar sua conta pronta."
      onBack={onBack}
      progressMeta={progressMeta}
      stickyFooter={false}
      footer={(
        <ContinueButton
          onPress={handleSubmit}
          disabled={!isFormValid || isSubmitting}
          text={isSubmitting ? 'Salvando...' : 'Salvar e entrar'}
        />
      )}
    >
      <View style={styles.card}>
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Nome completo *</Text>
          <TextInput
            testID="auth-profile-full-name-input"
            accessibilityLabel="Nome completo"
            accessibilityHint="Informe seu nome e sobrenome como aparecem nos documentos."
            style={[styles.input, errors.fullName && styles.inputError]}
            value={profileData.fullName}
            onChangeText={value => updateField('fullName', value)}
            placeholder="Digite seu nome completo"
            placeholderTextColor={color.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {errors.fullName ? (
            <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {errors.fullName}
            </Text>
          ) : null}
        </View>

        {!isDriver ? (
          <>
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>E-mail *</Text>
              <TextInput
                testID="auth-profile-email-input"
                accessibilityLabel="E-mail"
                accessibilityHint="Informe seu endereço de e-mail para concluir o cadastro."
                style={[styles.input, errors.email && styles.inputError]}
                value={profileData.email}
                onChangeText={value => updateField('email', value)}
                placeholder="voce@exemplo.com"
                placeholderTextColor={color.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              {errors.email ? (
                <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {errors.email}
                </Text>
              ) : null}
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>Senha *</Text>
              <View style={[styles.passwordContainer, errors.password && styles.inputError]}>
                <TextInput
                  testID="auth-profile-password-input"
                  accessibilityLabel="Senha"
                  accessibilityHint="Use pelo menos 8 caracteres, incluindo letras e números."
                  style={styles.passwordInput}
                  value={profileData.password}
                  onChangeText={value => updateField('password', value)}
                  placeholder="Mín. 8 caracteres"
                  placeholderTextColor={color.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(previous => !previous)}
                  testID="auth-profile-password-visibility-btn"
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  accessibilityHint="Alterna a visibilidade da senha digitada."
                >
                  <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={18} color={color.textMuted} />
                </TouchableOpacity>
              </View>
              {errors.password ? (
                <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {errors.password}
                </Text>
              ) : null}
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>Confirmar senha *</Text>
              <View
                style={[
                  styles.passwordContainer,
                  passwordMatchState?.matches && styles.inputSuccess,
                  errors.confirmPassword && styles.inputError
                ]}
              >
                <TextInput
                  testID="auth-profile-confirm-password-input"
                  accessibilityLabel="Confirmar senha"
                  accessibilityHint="Digite novamente a senha escolhida."
                  style={styles.passwordInput}
                  value={profileData.confirmPassword}
                  onChangeText={value => updateField('confirmPassword', value)}
                  placeholder="Repita sua senha"
                  placeholderTextColor={color.textMuted}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword(previous => !previous)}
                  testID="auth-profile-confirm-password-visibility-btn"
                  accessibilityRole="button"
                  accessibilityLabel={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                  accessibilityHint="Alterna a visibilidade da confirmação de senha."
                >
                  <Ionicons name={showConfirmPassword ? 'eye-off' : 'eye'} size={18} color={color.textMuted} />
                </TouchableOpacity>
              </View>
              {passwordMatchState ? (
                <View style={styles.passwordMatchRow}>
                  <Ionicons
                    name={passwordMatchState.icon}
                    size={14}
                    color={passwordMatchState.matches ? color.success : color.error}
                  />
                  <Text
                    style={[
                      styles.passwordMatchText,
                      !passwordMatchState.matches && styles.passwordMatchTextError
                    ]}
                    accessibilityRole={passwordMatchState.matches ? 'text' : 'alert'}
                    accessibilityLiveRegion="polite"
                  >
                    {passwordMatchState.text}
                  </Text>
                </View>
              ) : null}
              {errors.confirmPassword ? (
                <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {errors.confirmPassword}
                </Text>
              ) : null}
            </View>
            <Text style={styles.helperText}>Você continuará entrando pelo telefone. A senha ajuda nos próximos acessos e na recuperação da conta.</Text>

	            <View style={styles.legalLinksRow}>
              <TouchableOpacity
                onPress={() => openLegalLink(AppConfig.terms_of_service_url, 'Termos de Uso')}
                accessibilityRole="button"
                accessibilityLabel="Ler Termos de Uso"
              >
                <Text style={styles.legalLinkText}>Ler Termos de Uso</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openLegalLink(AppConfig.privacy_policy_url, 'Política de Privacidade')}
                accessibilityRole="button"
                accessibilityLabel="Ler Política de Privacidade"
              >
                <Text style={styles.legalLinkText}>Ler Política de Privacidade</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.consentsBlock}>
              <ConsentRow
                checked={profileData.acceptTerms}
                label="Aceito os Termos de Uso *"
                onPress={() => toggleConsent('acceptTerms')}
                testID="auth-profile-terms-consent"
              />
              {errors.acceptTerms ? (
                <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {errors.acceptTerms}
                </Text>
              ) : null}

              <ConsentRow
                checked={profileData.acceptPrivacy}
                label="Aceito a Política de Privacidade *"
                onPress={() => toggleConsent('acceptPrivacy')}
                testID="auth-profile-privacy-consent"
              />
              {errors.acceptPrivacy ? (
                <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {errors.acceptPrivacy}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </EditorialOnboardingScreen>
  );
};

function ConsentRow({ checked, label, onPress, testID }) {
  return (
    <TouchableOpacity
      style={styles.consentRow}
      activeOpacity={0.86}
      onPress={onPress}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      accessibilityHint={checked ? 'Toque duas vezes para desmarcar.' : 'Toque duas vezes para aceitar.'}
    >
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
    paddingHorizontal: 32,
    paddingTop: 66,
    paddingBottom: spacing.md,
    backgroundColor: '#F6FAF6'
  },
  header: {
    position: 'absolute',
    top: 14,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 0,
    opacity: 0
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
    fontSize: 22,
    lineHeight: 28,
    color: '#102018',
    ...leafTypography.medium,
    textAlign: 'left',
    letterSpacing: 0
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#66756B',
    ...leafTypography.regular,
    marginTop: 7,
    marginBottom: 58
  },
  card: {
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
    padding: 0,
    marginBottom: spacing.md
  },
  fieldContainer: {
    marginBottom: 18
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    color: color.textSecondary,
    ...leafTypography.semiBold,
    marginBottom: 8
  },
	  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 0,
    minHeight: 54,
    fontSize: 15,
    lineHeight: 20,
    ...leafTypography.regular,
    color: color.textPrimary,
	    backgroundColor: '#FFFFFF'
	  },
	  passwordContainer: {
	    flexDirection: 'row',
	    alignItems: 'center',
	    borderWidth: 1,
	    borderColor: color.border,
	    borderRadius: 20,
	    backgroundColor: '#FFFFFF',
      minHeight: 54
	  },
	  passwordInput: {
	    flex: 1,
	    paddingHorizontal: 20,
	    paddingVertical: 9,
	    fontSize: 15,
	    lineHeight: 20,
	    ...leafTypography.regular,
	    color: color.textPrimary
	  },
	  eyeButton: {
	    paddingHorizontal: 8,
	    paddingVertical: 8
	  },
	  inputError: {
	    borderColor: color.error
	  },
  inputSuccess: {
    borderColor: color.success
  },
  errorText: {
    color: color.error,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    ...leafTypography.medium
  },
  helperText: {
    marginTop: 0,
    marginBottom: spacing.sm,
    color: color.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    ...leafTypography.regular
  },
  passwordMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5
  },
  passwordMatchText: {
    color: color.success,
    fontSize: 11,
    lineHeight: 14,
    ...leafTypography.medium
  },
  passwordMatchTextError: {
    color: color.error
  },
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.sm
  },
  legalLinkText: {
    fontSize: 11,
    lineHeight: 14,
    color: color.accent,
    textDecorationLine: 'underline',
    ...leafTypography.medium
  },
  consentsBlock: {
    marginTop: 0
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 5
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
    fontSize: 12,
    lineHeight: 16,
    color: color.textPrimary,
    ...leafTypography.medium
  },
  continueButton: {
    minHeight: 46,
    borderRadius: 23,
    marginTop: 'auto',
    shadowOpacity: 0,
    elevation: 0
  },
  continueButtonText: {
    fontSize: 12,
    lineHeight: 16,
    ...leafTypography.medium
  }
});

export default ProfileDataStep;
