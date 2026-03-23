import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeInUp } from 'react-native-reanimated';
import { fonts } from '../../common-local/font';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, typography, motion } = robotaxiPrototypeTokens;
const cardEnterEasing = Easing.bezier(...motion.bezier.snappy);

export function PrototypeCard({ style, children, ...viewProps }) {
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.timing.standard)
        .easing(cardEnterEasing)
        .withInitialValues({ transform: [{ translateY: 16 }], opacity: 0.96 })}
      style={[styles.card, style]}
      {...viewProps}
    >
      {children}
    </Animated.View>
  );
}

export function DestinationInput({
  value,
  onChangeText,
  placeholder = 'Para onde?',
  onPress,
  editable = true,
  rightIcon = 'mic'
}) {
  const content = (
    <View style={styles.destinationInput}>
      <View style={styles.leadingIconWrap}>
        <Ionicons name="search" size={18} color={color.text.muted} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.text.muted}
        style={styles.destinationField}
        editable={editable}
        pointerEvents={editable ? 'auto' : 'none'}
      />

      <View style={styles.trailingButton}>
        <Ionicons name={rightIcon} size={18} color={color.accent.contrast} />
      </View>
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
      {content}
    </TouchableOpacity>
  );
}

export function PrototypePrimaryButton({ label, onPress, icon, style }) {
  return (
    <TouchableOpacity style={[styles.primaryButton, style]} activeOpacity={0.86} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={16} color={color.accent.contrast} /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function CardHandle() {
  return <View style={styles.handle} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.bg.panel,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: color.border.strong,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.22,
    shadowRadius: 30,
    elevation: 15
  },
  handle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(142,154,169,0.64)',
    alignSelf: 'center',
    marginBottom: 10
  },
  destinationInput: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10
  },
  leadingIconWrap: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center'
  },
  destinationField: {
    flex: 1,
    marginLeft: 10,
    marginRight: 10,
    height: 24,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: 'center',
    includeFontPadding: false,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0
  },
  trailingButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent.primary,
    shadowColor: color.shadow.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
    elevation: 7
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: color.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: color.border.strong
  },
  primaryButtonText: {
    color: color.accent.contrast,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  }
});
