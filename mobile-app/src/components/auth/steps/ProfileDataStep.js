import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../theme/runtimeTokens';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';
import { AppConfig } from '../../../../config/AppConfig';

const { color, radius, spacing, elevation } = onboardingTheme;
const EMAIL_REGEX = /\S+@\S+\.\S+/;

const ProfileDataStep = ({ onSubmitted, onBack, initialData = {} }) => {
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
    if (!profileData.fullName?.trim()) {
      nextErrors.fullName = 'Nome completo é obrigatório';
    }

    if (!isDriver) {
	      if (!profileData.email?.trim()) {
	        nextErrors.email = 'E-mail é obrigatório';
	      } else if (!EMAIL_REGEX.test(profileData.email.trim())) {
	        nextErrors.email = 'E-mail inválido';
	      }

	      if (!profileData.password || profileData.password.length < 8) {
	        nextErrors.password = 'A senha deve ter pelo menos 8 caracteres.';
	      } else if (!/(?=.*[A-Za-z])(?=.*\d)/.test(profileData.password)) {
	        nextErrors.password = 'A senha deve conter letras e números.';
	      }

	      if (profileData.password !== profileData.confirmPassword) {
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
    if (!profileData.fullName?.trim()) {
      return false;
    }

    if (isDriver) {
      return true;
    }

	    return (
	      EMAIL_REGEX.test(profileData.email.trim()) &&
	      profileData.password.length >= 8 &&
	      /(?=.*[A-Za-z])(?=.*\d)/.test(profileData.password) &&
	      profileData.password === profileData.confirmPassword &&
	      profileData.acceptTerms &&
	      profileData.acceptPrivacy
	    );
	  }, [isDriver, profileData.acceptPrivacy, profileData.acceptTerms, profileData.confirmPassword, profileData.email, profileData.fullName, profileData.password]);

  const updateField = useCallback(
    async (field, value) => {
      const nextData = { ...profileData, [field]: value };
      setProfileData(nextData);
      await saveStepData('profile_data', nextData);

      if (errors[field]) {
        setErrors(previous => ({ ...previous, [field]: '' }));
      }
    },
    [errors, profileData]
  );

  const toggleConsent = useCallback((field) => {
    setProfileData(previous => ({ ...previous, [field]: !previous[field] }));
    if (errors[field]) {
      setErrors(previous => ({ ...previous, [field]: '' }));
    }
  }, [errors]);

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

    onSubmitted({
      fullName: profileData.fullName.trim(),
      ...(isDriver
        ? {}
        : {
	            email: profileData.email.trim().toLowerCase(),
	            password: profileData.password,
	            confirmPassword: profileData.confirmPassword,
	            acceptTerms: profileData.acceptTerms,
	            acceptPrivacy: profileData.acceptPrivacy
	          })
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Seus dados</Text>
      </View>

      <Text style={styles.subtitle}>
        {isDriver
          ? 'Informe seu nome para concluir o pré-cadastro de motorista.'
          : 'Informe seus dados básicos e aceite os termos para criar sua conta de passageiro.'}
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
	                  placeholder="Mínimo 8 caracteres"
	                  placeholderTextColor={color.textMuted}
	                  secureTextEntry={!showPassword}
	                  autoCapitalize="none"
	                  autoCorrect={false}
	                />
	                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(previous => !previous)}>
	                  <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={color.textMuted} />
	                </TouchableOpacity>
	              </View>
	              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
	            </View>

	            <View style={styles.fieldContainer}>
	              <Text style={styles.label}>Confirmar senha *</Text>
	              <View style={[styles.passwordContainer, errors.confirmPassword && styles.inputError]}>
	                <TextInput
	                  style={styles.passwordInput}
	                  value={profileData.confirmPassword}
	                  onChangeText={value => updateField('confirmPassword', value)}
	                  placeholder="Digite a senha novamente"
	                  placeholderTextColor={color.textMuted}
	                  secureTextEntry={!showConfirmPassword}
	                  autoCapitalize="none"
	                  autoCorrect={false}
	                />
	                <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword(previous => !previous)}>
	                  <Ionicons name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color={color.textMuted} />
	                </TouchableOpacity>
	              </View>
	              {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
	            </View>

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

      <ContinueButton onPress={handleSubmit} disabled={!isFormValid} text={isDriver ? 'Continuar' : 'Concluir cadastro'} />
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
    paddingHorizontal: spacing.lg
  },
  content: {
    paddingVertical: spacing.sm
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
    fontFamily: fonts.Bold,
    textAlign: 'left'
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: color.textSecondary,
    fontFamily: fonts.Regular,
    marginBottom: spacing.sm
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.glassStroke,
    backgroundColor: color.panelSoft,
    shadowColor: '#0E1522',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 9,
    padding: spacing.sm
  },
  fieldContainer: {
    marginBottom: spacing.sm
  },
  label: {
    fontSize: 13,
    color: color.textPrimary,
    fontFamily: fonts.SemiBold,
    marginBottom: 6
  },
	  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fonts.Medium,
    color: color.textPrimary,
	    backgroundColor: color.surfaceMuted
	  },
	  passwordContainer: {
	    flexDirection: 'row',
	    alignItems: 'center',
	    borderWidth: 1,
	    borderColor: color.border,
	    borderRadius: radius.md,
	    backgroundColor: color.surfaceMuted
	  },
	  passwordInput: {
	    flex: 1,
	    paddingHorizontal: 12,
	    paddingVertical: 11,
	    fontSize: 14,
	    lineHeight: 18,
	    fontFamily: fonts.Medium,
	    color: color.textPrimary
	  },
	  eyeButton: {
	    paddingHorizontal: 12,
	    paddingVertical: 10
	  },
	  inputError: {
	    borderColor: color.error
	  },
  errorText: {
    color: color.error,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    fontFamily: fonts.Medium
  },
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: spacing.sm
  },
  legalLinkText: {
    fontSize: 12,
    lineHeight: 16,
    color: color.accent,
    textDecorationLine: 'underline',
    fontFamily: fonts.Medium
  },
  consentsBlock: {
    marginTop: spacing.xs
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
  }
});

export default ProfileDataStep;
