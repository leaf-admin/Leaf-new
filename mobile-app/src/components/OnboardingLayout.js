import React from 'react';
import { View, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, TouchableOpacity, Text } from 'react-native';
import onboardingTheme from './auth/common/onboardingTheme';

const { color, radius, spacing } = onboardingTheme;

const OnboardingLayout = ({
  children,
  progress,
  onContinue,
  continueLabel = 'Continuar',
  continueDisabled = false,
}) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <View style={styles.content}>
          {children}
        </View>
        <View style={styles.bottomArea}>
          {progress ? <View style={styles.progressWrapper}>{progress}</View> : null}
          <TouchableOpacity
            style={[styles.button, continueDisabled && styles.buttonDisabled]}
            onPress={onContinue}
            disabled={continueDisabled}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{continueLabel}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 16,
  },
  bottomArea: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: color.panel,
    borderTopWidth: 1,
    borderTopColor: color.borderStrong
  },
  progressWrapper: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  button: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: color.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    minHeight: 52,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonDisabled: {
    backgroundColor: color.accentSoft,
    borderColor: color.border
  },
  buttonText: {
    color: color.accentText,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default OnboardingLayout; 
