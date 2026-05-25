import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../theme/runtimeTokens';
import ContinueButton from '../common/ContinueButton';
import onboardingTheme from '../common/onboardingTheme';

const { color, radius, spacing } = onboardingTheme;
const EMAIL_REGEX = /\S+@\S+\.\S+/;

const DriverEmailStep = ({ onSubmitted, onBack, initialData = {} }) => {
  const [email, setEmail] = useState(initialData.email || '');
  const [error, setError] = useState('');

  const isEmailValid = useMemo(() => {
    const clean = String(email || '').trim();
    if (!clean) return true;
    return EMAIL_REGEX.test(clean);
  }, [email]);

  const handleSubmit = (skip = false) => {
    const clean = String(email || '').trim().toLowerCase();
    if (!skip && clean && !EMAIL_REGEX.test(clean)) {
      setError('E-mail inválido');
      return;
    }

    setError('');
    onSubmitted({
      email: skip ? '' : clean,
      skipped: skip || !clean
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Contato por e-mail</Text>

      <Text style={styles.subtitle}>
        Adicione para recibos, notificações do sistema e informe de rendimentos. Você pode pular e preencher depois.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>E-mail (opcional por agora)</Text>
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={email}
          onChangeText={value => {
            setEmail(value);
            if (error) setError('');
          }}
          placeholder="seu@email.com"
          placeholderTextColor={color.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="driver-email-input"
          accessibilityLabel="driver-email-input"
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <ContinueButton
        onPress={() => handleSubmit(false)}
        disabled={!isEmailValid}
        text="Finalizar cadastro"
        testID="driver-email-continue-btn"
        accessibilityLabel="driver-email-continue-btn"
      />
      <TouchableOpacity
        style={styles.skipButton}
        onPress={() => handleSubmit(true)}
        activeOpacity={0.86}
        testID="driver-email-skip-btn"
        accessibilityLabel="driver-email-skip-btn"
      >
        <Text style={styles.skipLabel}>Preencher depois</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm
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
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.glassStroke,
    backgroundColor: color.panel,
    shadowColor: color.accent,
    ...onboardingTheme.elevation.soft,
    padding: spacing.sm,
    marginBottom: 'auto'
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
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: fonts.Medium,
    color: color.textPrimary,
    backgroundColor: color.surfaceMuted
  },
  inputError: {
    borderColor: color.error
  },
  errorText: {
    marginTop: 4,
    color: color.error,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.Medium
  },
  skipButton: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10
  },
  skipLabel: {
    color: color.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Medium
  }
});

export default DriverEmailStep;
