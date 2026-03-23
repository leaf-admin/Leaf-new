import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../../common-local/font';
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={22} color={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Contato por e-mail</Text>
      </View>

      <Text style={styles.subtitle}>
        Adicione seu e-mail para recibos de saque, notificações do sistema e informe de rendimentos. Você pode pular e preencher depois.
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
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <ContinueButton onPress={() => handleSubmit(false)} disabled={!isEmailValid} text="Finalizar cadastro" />
      <TouchableOpacity style={styles.skipButton} onPress={() => handleSubmit(true)} activeOpacity={0.86}>
        <Text style={styles.skipLabel}>Preencher depois</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg
  },
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm
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
    padding: spacing.sm,
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
