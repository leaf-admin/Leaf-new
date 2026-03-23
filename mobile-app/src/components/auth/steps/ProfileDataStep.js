import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../common-local/font';
import { saveStepData } from '../../../utils/secureOnboardingStorage';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';

const { color, radius, spacing, elevation } = onboardingTheme;

const ProfileDataStep = ({ onSubmitted, onBack, initialData = {} }) => {
  const [profileData, setProfileData] = useState({
    fullName: initialData.fullName || [initialData.firstName, initialData.lastName].filter(Boolean).join(' ').trim()
  });
  const [errors, setErrors] = useState({});

  const isDriver = useMemo(() => initialData?.profileSelection?.userType === 'driver', [initialData?.profileSelection?.userType]);

  const validateFields = useCallback(() => {
    const nextErrors = {};
    if (!profileData.fullName?.trim()) {
      nextErrors.fullName = 'Nome completo é obrigatório';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [profileData.fullName]);

  const isFormValid = useMemo(() => Boolean(profileData.fullName?.trim()), [profileData.fullName]);

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

  const handleSubmit = () => {
    if (!validateFields()) {
      return;
    }

    onSubmitted({
      fullName: profileData.fullName.trim()
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
          : 'Informe seu nome para criar sua conta de passageiro.'}
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
      </View>

      <ContinueButton onPress={handleSubmit} disabled={!isFormValid} text="Continuar" />
    </ScrollView>
  );
};

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
    marginBottom: 2
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
  inputError: {
    borderColor: color.error
  },
  errorText: {
    color: color.error,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    fontFamily: fonts.Medium
  }
});

export default ProfileDataStep;
