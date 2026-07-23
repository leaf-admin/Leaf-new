import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fonts } from '../../../theme/runtimeTokens';
import onboardingTheme from './onboardingTheme';

const { color, spacing } = onboardingTheme;
const defaultInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const FallbackSafeAreaInsetsContext = React.createContext(defaultInsets);

function normalizeUserType(userType) {
  if (userType === 'passenger') return 'customer';
  return userType;
}

export function resolveEditorialProgressMeta(stepIndex = 0, userType = null) {
  const normalizedUserType = normalizeUserType(userType);
  const isDriver = normalizedUserType === 'driver';
  const isCustomer = normalizedUserType === 'customer';

  if (isDriver) {
    const stepMap = {
      0: 1,
      1: 2,
      2: 3,
      4: 4,
      5: 5,
      6: 6
    };
    const stepNumber = stepMap[stepIndex] || Math.min(Math.max(stepIndex + 1, 1), 6);
    return {
      totalSteps: 6,
      activeStep: stepNumber,
      stepNumber
    };
  }

  if (isCustomer) {
    const stepNumber = Math.min(Math.max(stepIndex + 1, 1), 4);
    return {
      totalSteps: 4,
      activeStep: stepNumber,
      stepNumber
    };
  }

  const stepNumber = Math.min(Math.max(stepIndex + 1, 1), 3);
  return {
    totalSteps: 3,
    activeStep: stepNumber,
    stepNumber
  };
}

export function EditorialProgress({ totalSteps = 3, activeStep = 1 }) {
  const segments = Array.from({ length: totalSteps });
  return (
    <View style={styles.progressRow} accessibilityElementsHidden pointerEvents="none">
      {segments.map((_, index) => (
        <View
          key={`segment-${index}`}
          style={[
            styles.progressSegment,
            index < activeStep ? styles.progressSegmentActive : styles.progressSegmentInactive
          ]}
        />
      ))}
    </View>
  );
}

export default function EditorialOnboardingScreen({
  children,
  footer = null,
  title,
  description,
  onBack,
  showBack = true,
  backTestID,
  backAccessibilityLabel = 'Voltar',
  progressMeta,
  keyboard = false,
  scrollEnabled = true,
  contentStyle,
  childrenStyle,
  footerStyle,
  stickyFooter = true,
  testID
}) {
  const insets = React.useContext(SafeAreaInsetsContext || FallbackSafeAreaInsetsContext) || defaultInsets;
  const meta = progressMeta || resolveEditorialProgressMeta(0, null);
  const Root = keyboard ? KeyboardAvoidingView : View;
  const stepNumber = String(meta.stepNumber || meta.activeStep || 1).padStart(2, '0');

  return (
    <Root
      style={styles.root}
      behavior={keyboard && Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboard && Platform.OS === 'ios' ? 10 : 0}
      testID={testID}
    >
      <ScrollView
        style={styles.scroll}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 18, 54) },
          footer && stickyFooter ? styles.scrollContentWithFooter : null,
          contentStyle
        ]}
      >
        <View style={styles.topRow}>
          {showBack ? (
            <Pressable
              style={styles.backButton}
              onPress={onBack}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={backAccessibilityLabel}
              testID={backTestID}
            >
              <Ionicons name="chevron-back" size={21} color={color.textPrimary} />
            </Pressable>
          ) : (
            <View style={styles.backButtonPlaceholder} />
          )}
        </View>

        <EditorialProgress totalSteps={meta.totalSteps} activeStep={meta.activeStep} />
        <View style={styles.editorialRule} />
        <Text style={styles.stepNumber}>{stepNumber}</Text>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
        <View style={[styles.childrenWrap, childrenStyle]}>{children}</View>
        {footer && !stickyFooter ? (
          <View
            style={[
              styles.inlineFooter,
              { paddingBottom: Math.max(insets.bottom + 18, Platform.OS === 'android' ? 26 : 22) },
              footerStyle
            ]}
          >
            {footer}
          </View>
        ) : null}
      </ScrollView>

      {footer && stickyFooter ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom + 18, Platform.OS === 'android' ? 26 : 22) },
            footerStyle
          ]}
        >
          {footer}
        </View>
      ) : null}
    </Root>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.background
  },
  scroll: {
    flex: 1,
    backgroundColor: color.background
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingBottom: spacing.xl
  },
  scrollContentWithFooter: {
    paddingBottom: 128
  },
  topRow: {
    minHeight: 38,
    justifyContent: 'center'
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center'
  },
  backButtonPlaceholder: {
    width: 38,
    height: 38
  },
  progressRow: {
    height: 4,
    flexDirection: 'row',
    gap: 6,
    marginTop: 16
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 999
  },
  progressSegmentActive: {
    backgroundColor: color.accent
  },
  progressSegmentInactive: {
    backgroundColor: color.border
  },
  editorialRule: {
    height: 2,
    borderRadius: 999,
    backgroundColor: color.accent,
    marginTop: 26
  },
  stepNumber: {
    marginTop: 24,
    color: color.accent,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: fonts.Bold,
    letterSpacing: 0
  },
  title: {
    marginTop: 22,
    color: color.textPrimary,
    fontSize: 39,
    lineHeight: 45,
    fontFamily: fonts.Bold,
    letterSpacing: 0
  },
  description: {
    marginTop: 14,
    color: color.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fonts.Regular,
    letterSpacing: 0
  },
  childrenWrap: {
    marginTop: 34
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    paddingTop: 12,
    backgroundColor: color.background
  },
  inlineFooter: {
    paddingTop: 12,
    backgroundColor: color.background
  }
});
