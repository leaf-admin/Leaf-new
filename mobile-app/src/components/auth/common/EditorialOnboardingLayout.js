import leafTypography from '../../prototype/LeafTypography';
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import onboardingTheme from './onboardingTheme';
import { LeafObjectIcon } from '../../prototype/LeafVisualElements';

const { color, spacing } = onboardingTheme;
const STICKY_FOOTER_MAX_FONT_SCALE = 1.4;
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
  headerTitle = 'Cadastro',
  leadObject = 'account',
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
  const { fontScale = 1 } = useWindowDimensions();
  const [stickyFooterHeight, setStickyFooterHeight] = React.useState(0);
  const meta = progressMeta || resolveEditorialProgressMeta(0, null);
  const Root = keyboard ? KeyboardAvoidingView : View;
  const stepNumber = String(meta.stepNumber || meta.activeStep || 1).padStart(2, '0');
  const useStickyFooter = stickyFooter && fontScale < STICKY_FOOTER_MAX_FONT_SCALE;
  const handleStickyFooterLayout = React.useCallback(({ nativeEvent }) => {
    const measuredHeight = Math.ceil(nativeEvent?.layout?.height || 0);
    setStickyFooterHeight((currentHeight) => (
      currentHeight === measuredHeight ? currentHeight : measuredHeight
    ));
  }, []);

  return (
    <Root
      style={styles.root}
      behavior={keyboard ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}
      keyboardVerticalOffset={keyboard && Platform.OS === 'ios' ? 10 : 0}
      testID={testID}
    >
      <View style={styles.keyboardContent}>
      <ScrollView
        style={styles.scroll}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 10, 44) },
          footer && useStickyFooter ? styles.scrollContentWithFooter : null,
          contentStyle,
          footer && useStickyFooter
            ? { paddingBottom: spacing.lg }
            : null
        ]}
        testID="editorial-onboarding-scroll"
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
              <Ionicons name="arrow-back" size={20} color={color.textPrimary} />
            </Pressable>
          ) : (
            <View style={styles.backButtonPlaceholder} />
          )}
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <Text style={styles.stepNumber}>{meta.activeStep} de {meta.totalSteps}</Text>
        </View>

        <View style={styles.lead}>
          <View style={styles.leadCopy}>
            <Text style={styles.title} accessibilityRole="header">{String(title || '').replace(/\n/g, ' ')}</Text>
            {description ? <Text style={styles.description}>{description}</Text> : null}
          </View>
          {leadObject ? <LeafObjectIcon name={leadObject} size={48} /> : null}
        </View>
        <View style={[styles.childrenWrap, childrenStyle]}>{children}</View>
      {footer && !useStickyFooter ? (
        <View
          style={[
            styles.inlineFooter,
            { paddingBottom: Math.max(insets.bottom + 18, Platform.OS === 'android' ? 26 : 22) },
            footerStyle
          ]}
          testID="editorial-onboarding-inline-footer"
        >
            {footer}
          </View>
        ) : null}
      </ScrollView>

      {footer && useStickyFooter ? (
        <View
          onLayout={handleStickyFooterLayout}
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom + 18, Platform.OS === 'android' ? 26 : 22) },
            footerStyle
          ]}
          testID="editorial-onboarding-sticky-footer"
        >
          {footer}
        </View>
      ) : null}
      </View>
    </Root>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.background
  },
  keyboardContent: {
    flex: 1,
    minHeight: 0
  },
  scroll: {
    flex: 1,
    backgroundColor: color.background
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: spacing.xl
  },
  scrollContentWithFooter: {
    paddingBottom: 128
  },
  topRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center'
  },
  backButtonPlaceholder: {
    display: 'none',
  },
  headerTitle: { ...leafTypography.semiBold, fontSize: 14, lineHeight: 20, color: color.textSecondary, flex: 1 },
  lead: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  leadCopy: { flex: 1, minWidth: 0 },
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
    color: color.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    ...leafTypography.medium,
    letterSpacing: 0
  },
  title: {
    color: color.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    ...leafTypography.semiBold,
    letterSpacing: -0.5
  },
  description: {
    marginTop: 8,
    color: color.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    ...leafTypography.regular,
    letterSpacing: 0
  },
  childrenWrap: {
    marginTop: 24
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: color.background
  },
  inlineFooter: {
    paddingTop: 12,
    backgroundColor: color.background
  }
});
