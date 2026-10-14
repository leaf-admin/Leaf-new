import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Reanimated, { FadeIn, FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import leafTypography from '../prototype/LeafTypography';
import { LeafAnimatedPressable } from '../prototype/LeafRideUI';
import LeafLineIcon from '../design-system/LeafLineIcon';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';

// Kit do onboarding na identidade Leaf: uma moldura só (voltar, progresso, título, conteúdo e
// botão sempre no mesmo lugar), campos e botões com as mesmas animações em todas as etapas.

export const ONB = {
  ink: '#11210C',
  inkSoft: 'rgba(17,33,12,0.62)',
  inkMuted: 'rgba(17,33,12,0.42)',
  leaf: '#1A330E',
  leafDeep: '#003002',
  surface: '#FFFFFF',
  surfaceSoft: '#F4F6F2',
  line: 'rgba(17,33,12,0.10)',
  lineStrong: 'rgba(17,33,12,0.22)',
  danger: '#B4232F',
  dangerSoft: '#FFF1F2',
  success: '#2E8B4A',
  action: '#191B18',
};

export function OnboardingProgress({ step, total }) {
  const progress = useRef(new Animated.Value(total > 0 ? step / total : 0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: total > 0 ? step / total : 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, step, total]);
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
      <Animated.View
        style={[styles.progressFill, {
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]}
      />
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled = false, loading = false, tone = 'dark', testID }) {
  const haptic = useHapticFeedback();
  const light = tone === 'light';
  return (
    <LeafAnimatedPressable
      onPress={disabled || loading ? undefined : () => { haptic('tap'); onPress?.(); }}
      disabled={disabled || loading}
      activeScale={0.98}
      style={[styles.primary, light && styles.primaryLight, (disabled || loading) && styles.primaryDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
    >
      {loading ? <LoadingDots color={light ? ONB.leafDeep : '#FFFFFF'} /> : (
        <Text style={[styles.primaryText, light && styles.primaryTextLight]}>{label}</Text>
      )}
    </LeafAnimatedPressable>
  );
}

export function TextLink({ label, onPress, testID, tone = 'ink' }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} testID={testID} accessibilityRole="button">
      {({ pressed }) => (
        <Text style={[styles.link, tone === 'light' && styles.linkLight, pressed && { opacity: 0.55 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function LoadingDots({ color }) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(140, dots.map((dot) => Animated.sequence([
      Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0.3, duration: 280, useNativeDriver: true }),
    ]))));
    loop.start();
    return () => loop.stop();
  }, [dots]);
  return (
    <View style={styles.dots}>
      {dots.map((dot, i) => <Animated.View key={i} style={[styles.dot, { backgroundColor: color, opacity: dot }]} />)}
    </View>
  );
}

export function OnboardingField({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize = 'sentences', error, hint,
  autoFocus = false, prefix, testID, maxLength, textContentType, autoComplete, editable = true, rightAccessory,
}) {
  const [focused, setFocused] = useState(false);
  const focus = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(focus, { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [focus, focused]);
  const borderColor = error
    ? ONB.danger
    : focus.interpolate({ inputRange: [0, 1], outputRange: [ONB.line, ONB.ink] });
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Animated.View style={[styles.field, { borderColor }, !editable && styles.fieldReadOnly]}>
        {prefix ? <Text style={styles.fieldPrefix}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={ONB.inkMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.fieldInput}
          testID={testID}
          maxLength={maxLength}
          textContentType={textContentType}
          autoComplete={autoComplete}
          editable={editable}
        />
        {rightAccessory}
      </Animated.View>
      {error ? (
        <Reanimated.Text entering={FadeIn.duration(160)} style={styles.fieldError}>{error}</Reanimated.Text>
      ) : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// Moldura de toda etapa. `stepKey` muda a cada etapa e anima a troca de conteúdo.
export function OnboardingShell({
  stepKey, step, total, onBack, title, subtitle, children, footer, scroll = true, testID,
}) {
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID={testID}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        {onBack ? (
          <LeafAnimatedPressable onPress={onBack} style={styles.back} accessibilityLabel="Voltar" accessibilityRole="button">
            <LeafLineIcon name="back" size={20} color={ONB.ink} />
          </LeafAnimatedPressable>
        ) : <View style={styles.backPlaceholder} />}
        {total ? <View style={styles.progressWrap}><OnboardingProgress step={step} total={total} /></View> : null}
        <View style={styles.backPlaceholder} />
      </View>
      <Body
        style={styles.body}
        contentContainerStyle={scroll ? styles.bodyContent : undefined}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Reanimated.View key={stepKey} entering={FadeInRight.duration(260)} exiting={FadeOutLeft.duration(160)} style={!scroll && styles.flex}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <View style={styles.content}>{children}</View>
        </Reanimated.View>
      </Body>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ONB.surface },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  back: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ONB.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: ONB.line,
    shadowColor: '#0E1F12', shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  backPlaceholder: { width: 44, height: 44 },
  progressWrap: { flex: 1 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: ONB.surfaceSoft, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: ONB.ink },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  title: { ...leafTypography.semiBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.4, color: ONB.ink },
  subtitle: { ...leafTypography.regular, fontSize: 16, lineHeight: 23, color: ONB.inkSoft, marginTop: 8 },
  content: { marginTop: 28 },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 14, alignItems: 'center' },
  primary: {
    alignSelf: 'stretch', height: 56, borderRadius: 28, backgroundColor: ONB.action,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryLight: { backgroundColor: '#FFFFFF' },
  primaryDisabled: { opacity: 0.32 },
  primaryText: { ...leafTypography.semiBold, fontSize: 17, color: '#FFFFFF' },
  primaryTextLight: { color: ONB.leafDeep },
  link: { ...leafTypography.medium, fontSize: 15, color: ONB.ink, textDecorationLine: 'underline' },
  linkLight: { color: 'rgba(255,255,255,0.82)' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  fieldWrap: { marginBottom: 18 },
  fieldLabel: { ...leafTypography.medium, fontSize: 13, color: ONB.inkSoft, marginBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, borderRadius: 16, borderWidth: 1.5,
    paddingHorizontal: 16, backgroundColor: ONB.surface,
  },
  fieldReadOnly: { backgroundColor: ONB.surfaceSoft },
  fieldPrefix: { ...leafTypography.semiBold, fontSize: 18, color: ONB.ink, marginRight: 10 },
  fieldInput: { flex: 1, ...leafTypography.regular, fontSize: 18, color: ONB.ink, paddingVertical: 14 },
  fieldError: { ...leafTypography.medium, fontSize: 13, color: ONB.danger, marginTop: 8 },
  fieldHint: { ...leafTypography.regular, fontSize: 13, color: ONB.inkMuted, marginTop: 8 },
});
