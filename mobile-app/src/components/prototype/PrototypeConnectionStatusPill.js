import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, radius, spacing, elevation, typography } =
  robotaxiPrototypeTokens;

const TONE_STYLES = {
  warning: {
    backgroundColor: 'rgba(245, 197, 24, 0.92)',
    borderColor: 'rgba(117, 88, 0, 0.22)',
    iconColor: '#4C3B00',
    titleColor: '#2A2100',
    messageColor: '#544200',
  },
  danger: {
    backgroundColor: 'rgba(190, 58, 58, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    iconColor: '#FFFFFF',
    titleColor: '#FFFFFF',
    messageColor: 'rgba(255,255,255,0.88)',
  },
  success: {
    backgroundColor: 'rgba(26, 51, 14, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    iconColor: '#FFFFFF',
    titleColor: '#FFFFFF',
    messageColor: 'rgba(255,255,255,0.84)',
  },
};

export default function PrototypeConnectionStatusPill({
  topOffset = 0,
  visible = false,
  tone = 'warning',
  icon = 'sync-outline',
  title = '',
  message = '',
  testID = 'prototype-connection-status-pill',
}) {
  if (!visible || !title) {
    return null;
  }

  const palette = TONE_STYLES[tone] || TONE_STYLES.warning;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { top: topOffset }]}
      testID={testID}
      accessibilityLabel={testID}
    >
      <View
        style={[
          styles.pill,
          {
            backgroundColor: palette.backgroundColor,
            borderColor: palette.borderColor,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={palette.iconColor}
          style={styles.icon}
        />

        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.titleColor }]}>
            {title}
          </Text>
          {message ? (
            <Text style={[styles.message, { color: palette.messageColor }]}>
              {message}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    left: spacing.lg,
    right: spacing.lg,
    position: 'absolute',
    zIndex: 35,
    alignItems: 'center',
  },
  pill: {
    minHeight: 54,
    maxWidth: 420,
    width: '100%',
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    ...elevation.soft,
  },
  icon: {
    marginRight: spacing.sm,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: 0.1,
  },
  message: {
    marginTop: 2,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
});
