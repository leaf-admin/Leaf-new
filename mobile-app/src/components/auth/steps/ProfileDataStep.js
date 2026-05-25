import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../theme/runtimeTokens';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import { AppConfig } from '../../../../config/AppConfig';

const { color, radius, spacing, elevation } = onboardingTheme;
const EMAIL_REGEX = /\S+@\S+\.\S+/;
const PASSWORD_REGEX = /(?=.*[A-Za-z])(?=.*\d)/;

const ProfileDataStep = ({ onSubmitted, onBack, initialData = {} }) => {
  const insets = useSafeAreaInsets();
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
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Complete seu cadastro</Text>

      <Text style={styles.subtitle}>
        Confirme seus dados antes de entrar.
      </Text>

      <View style={styles.card}>
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Nome completo *</Text>
          <TextInput
            style={[styles.input, errors.fullName && styles.inputError]}
            value={profileData.fullName}
            onChangeText={value => updateField('fullName', value)}
            placeholder="Digite seu nome completo"
            placeholderTextColor={color.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}
        </View>

        {!isDriver ? (
          <>
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>E-mail *</Text>
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                value={profileData.email}
                onChangeText={value => updateField('email', value)}
                placeholder="voce@exemplo.com"
                placeholderTextColor={color.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.label}>Senha *</Text>
              <View style={[styles.passwordContainer, errors.password && styles.inputError]}>
                <TextInput
                  style={styles.passwordInput}
                  value={profileData.password}
                  onChangeText={value => updateField('password', value)}
                  placeholder="Mín. 8 caracteres"
                  placeholderTextColor={color.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(previous => !previous)}>
                  <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={18} color={color.textMuted} />
                </TouchableOpacity>
              </View>
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
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
                  style={styles.passwordInput}
                  value={profileData.confirmPassword}
                  onChangeText={value => updateField('confirmPassword', value)}
                  placeholder="Repita sua senha"
                  placeholderTextColor={color.textMuted}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword(previous => !previous)}>
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
                  >
                    {passwordMatchState.text}
                  </Text>
                </View>
              ) : null}
              {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
            </View>
            <Text style={styles.helperText}>Você continuará entrando pelo telefone. A senha ajuda nos próximos acessos e na recuperação da conta.</Text>

	            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={() => openLegalLink(AppConfig.terms_of_service_url, 'Termos de Uso')}>
                <Text style={styles.legalLinkText}>Ler Termos de Uso</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openLegalLink(AppConfig.privacy_policy_url, 'Política de Privacidade')}>
                <Text style={styles.legalLinkText}>Ler Política de Privacidade</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.consentsBlock}>
              <ConsentRow
                checked={profileData.acceptTerms}
                label="Aceito os Termos de Uso *"
                onPress={() => toggleConsent('acceptTerms')}
              />
              {errors.acceptTerms ? <Text style={styles.errorText}>{errors.acceptTerms}</Text> : null}

              <ConsentRow
                checked={profileData.acceptPrivacy}
                label="Aceito a Política de Privacidade *"
                onPress={() => toggleConsent('acceptPrivacy')}
              />
              {errors.acceptPrivacy ? <Text style={styles.errorText}>{errors.acceptPrivacy}</Text> : null}
            </View>
          </>
        ) : null}
      </View>

      <ContinueButton
        onPress={handleSubmit}
        disabled={!isFormValid}
        text="Salvar e entrar"
        textStyle={styles.continueButtonText}
        style={[
          styles.continueButton,
          {
            marginBottom:
            Platform.OS === 'android'
              ? Math.max(spacing.xl, insets.bottom + spacing.lg)
              : Math.max(spacing.md, insets.bottom + spacing.sm)
          }
        ]}
      />
    </View>
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
    fontSize: 18,
    lineHeight: 24,
    color: '#102018',
    fontFamily: fonts.Medium,
    textAlign: 'left',
    letterSpacing: 0
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#66756B',
    fontFamily: fonts.Regular,
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
    fontSize: 11,
    lineHeight: 15,
    color: '#5F6B62',
    fontFamily: fonts.Medium,
    marginBottom: 8
  },
	  input: {
    borderWidth: 1,
    borderColor: '#DFE8E1',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 0,
    minHeight: 52,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fonts.Regular,
    color: '#101C14',
	    backgroundColor: '#FFFFFF'
	  },
	  passwordContainer: {
	    flexDirection: 'row',
	    alignItems: 'center',
	    borderWidth: 1,
	    borderColor: '#DFE8E1',
	    borderRadius: 18,
	    backgroundColor: '#FFFFFF',
      minHeight: 52
	  },
	  passwordInput: {
	    flex: 1,
	    paddingHorizontal: 10,
	    paddingVertical: 9,
	    fontSize: 14,
	    lineHeight: 18,
	    fontFamily: fonts.Regular,
	    color: '#101C14'
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
    fontFamily: fonts.Medium
  },
  helperText: {
    marginTop: 0,
    marginBottom: spacing.sm,
    color: color.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fonts.Regular
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
    fontFamily: fonts.Medium
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
    fontFamily: fonts.Medium
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
    fontFamily: fonts.Medium
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
    fontFamily: fonts.Medium
  }
});

export default ProfileDataStep;
