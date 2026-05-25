import React from 'react';
import { View, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import onboardingTheme from './auth/common/onboardingTheme';
import ContinueButton from './auth/common/ContinueButton';

const { color, spacing } = onboardingTheme;

const OnboardingLayout = ({
  children,
  progress,
  onContinue,
  continueLabel = 'Continuar',
  continueDisabled = false,
}) => {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(spacing.lg, insets.bottom + spacing.sm);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <View pointerEvents="none" style={styles.backgroundCanvas}>
          <View style={[styles.routeLine, styles.routeLineTop]} />
          <View style={[styles.routeLine, styles.routeLineMiddle]} />
          <View style={[styles.routeLine, styles.routeLineBottom]} />
        </View>
        <View style={styles.content}>
          {children}
        </View>
        <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
          {progress ? <View style={styles.progressWrapper}>{progress}</View> : null}
          <ContinueButton
            onPress={onContinue}
            disabled={continueDisabled}
            text={continueLabel}
            style={styles.button}
          />
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
  backgroundCanvas: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden'
  },
  routeLine: {
    position: 'absolute',
    height: 2,
    borderRadius: 2,
    backgroundColor: color.mapLine
  },
  routeLineTop: {
    width: 360,
    top: 104,
    right: -128,
    transform: [{ rotate: '-21deg' }]
  },
  routeLineMiddle: {
    width: 460,
    top: 324,
    left: -160,
    backgroundColor: color.skyLine,
    transform: [{ rotate: '15deg' }]
  },
  routeLineBottom: {
    width: 340,
    bottom: 142,
    right: -104,
    transform: [{ rotate: '-18deg' }]
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: 16,
  },
  bottomArea: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    backgroundColor: 'transparent'
  },
  progressWrapper: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  button: {
    width: '100%',
    maxWidth: 360,
    marginTop: 0
  }
});

export default OnboardingLayout; 
