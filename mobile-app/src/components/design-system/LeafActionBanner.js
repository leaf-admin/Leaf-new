import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing as ReanimatedEasing, FadeInUp, FadeOutUp, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import leafTypography from '../prototype/LeafTypography';
import { LEAF_MOTION_BEZIER, LEAF_MOTION_DURATION } from './leafMotion';

// Layout animations run on the UI thread: the easing must be Reanimated's (a worklet).
// React Native's Easing here crashed the release app when the banner appeared.
const BANNER_EASING = ReanimatedEasing.bezier(...LEAF_MOTION_BEZIER);

// Banner com ação (canvas de UI/UX, estudo 5.3, aprovado em 2026-10-29): sempre no topo,
// sempre branco; o ícone muda de cor pelo tipo e a ação fica no próprio banner.
// Erro não é banner: fica no card, perto do que deu errado.
export const LEAF_BANNER_TONES = Object.freeze({
  action: { iconBackground: '#003002', iconColor: '#D4E84A', actionBackground: '#1A330E', actionColor: '#FFFFFF' },
  info: { iconBackground: '#F1F5EE', iconColor: '#1A330E', actionBackground: '#F1F5EE', actionColor: '#1A330E' },
  success: { iconBackground: '#D4E84A', iconColor: '#003002', actionBackground: '#F5F6F5', actionColor: '#222222' },
  warning: { iconBackground: '#F5F1E6', iconColor: '#7A6337', actionBackground: '#F5F1E6', actionColor: '#7A6337' },
});

const DEFAULT_ICONS = Object.freeze({
  action: 'notifications-outline',
  info: 'information-circle-outline',
  success: 'checkmark',
  warning: 'alert-outline',
});

export default function LeafActionBanner({
  tone = 'info',
  icon,
  title,
  message,
  actionLabel,
  onAction,
  onPress,
  top = 0,
  testID = 'leaf-action-banner',
}) {
  const reduceMotion = useReducedMotion();
  const palette = LEAF_BANNER_TONES[tone] || LEAF_BANNER_TONES.info;
  // Motion level 2: comes down calmly and leaves upward, no bounce.
  const entering = reduceMotion ? undefined : FadeInUp.duration(LEAF_MOTION_DURATION.enter).easing(BANNER_EASING);
  const exiting = reduceMotion ? undefined : FadeOutUp.duration(LEAF_MOTION_DURATION.standard);
  const Body = onPress ? Pressable : View;

  return (
    <Reanimated.View entering={entering} exiting={exiting} pointerEvents="box-none" style={[styles.layer, { top }]}>
      <Body
        onPress={onPress}
        style={styles.banner}
        testID={testID}
        accessibilityRole={onPress ? 'button' : 'alert'}
        accessibilityLiveRegion="polite"
        accessibilityLabel={[title, message].filter(Boolean).join('. ')}
      >
        <View style={[styles.icon, { backgroundColor: palette.iconBackground }]}>
          <Ionicons name={icon || DEFAULT_ICONS[tone] || DEFAULT_ICONS.info} size={20} color={palette.iconColor} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {message ? <Text style={styles.message} numberOfLines={2}>{message}</Text> : null}
        </View>
        {actionLabel && onAction ? (
          <Pressable
            onPress={onAction}
            hitSlop={8}
            style={[styles.action, { backgroundColor: palette.actionBackground }]}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            testID={`${testID}-action`}
          >
            <Text style={[styles.actionText, { color: palette.actionColor }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </Body>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 12, right: 12, zIndex: 40 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFEFEF',
    shadowColor: '#0B120A',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { ...leafTypography.semiBold, fontSize: 15, lineHeight: 20, color: '#222222' },
  message: { ...leafTypography.regular, fontSize: 13, lineHeight: 18, color: '#6A6A6A', marginTop: 1 },
  action: { height: 34, paddingHorizontal: 13, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...leafTypography.semiBold, fontSize: 13.5, lineHeight: 18 },
});
