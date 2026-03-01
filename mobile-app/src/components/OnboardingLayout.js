import React from 'react';
import { View, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, TouchableOpacity, Text } from 'react-native';

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
    backgroundColor: '#F5F5F5',
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  bottomArea: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 16,
    backgroundColor: '#F5F5F5',
  },
  progressWrapper: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  button: {
    width: 185,
    backgroundColor: '#1A330E',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#F5F5F5',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default OnboardingLayout; 