import React from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { Easing, FadeInUp } from "react-native-reanimated";
import { fonts } from "../../theme/runtimeTokens";
import robotaxiPrototypeTokens from "../design-system/robotaxiPrototypeTokens";

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
  placeholder = "Para onde?",
  onPress,
  editable = true,
  autoFocus = false,
  inputRef,
  onFocus,
  onBlur,
  rightIcon = "mic",
  onPressRightIcon,
  rightIconDisabled = false,
  rightIconLoading = false,
  testID,
  accessibilityLabel,
  rightIconTestID,
  rightIconAccessibilityLabel,
}) {
  const handlePress = React.useCallback(() => {
    onPress?.();
  }, [onPress]);

  const trailingIcon = (
    <View
      style={[
        styles.trailingButton,
        rightIconDisabled && styles.trailingButtonDisabled,
      ]}
    >
      {rightIconLoading ? (
        <ActivityIndicator size="small" color={color.accent.contrast} />
      ) : (
        <Ionicons name={rightIcon} size={18} color={color.accent.contrast} />
      )}
    </View>
  );

  const content = (
    <View style={styles.destinationInput}>
      <View style={styles.leadingIconWrap}>
        <Ionicons name="search" size={18} color={color.text.muted} />
      </View>
      {onPress ? (
        <View style={styles.destinationFieldStaticWrap} pointerEvents="none">
          <Text
            style={[
              styles.destinationFieldText,
              !value && styles.destinationPlaceholderText,
            ]}
            numberOfLines={1}
          >
            {value || placeholder}
          </Text>
        </View>
      ) : (
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={color.text.muted}
          style={styles.destinationField}
          editable={editable}
          autoFocus={autoFocus}
          onFocus={onFocus}
          onBlur={onBlur}
          pointerEvents={editable ? "auto" : "none"}
          testID={!onPress ? testID : undefined}
          accessibilityLabel={!onPress ? accessibilityLabel : undefined}
        />
      )}

      {typeof onPressRightIcon === "function" ? (
        <TouchableOpacity
          activeOpacity={0.86}
          onPress={onPressRightIcon}
          disabled={rightIconDisabled}
          style={styles.trailingButtonTouchArea}
          testID={rightIconTestID}
          accessibilityLabel={rightIconAccessibilityLabel}
        >
          {trailingIcon}
        </TouchableOpacity>
      ) : (
        trailingIcon
      )}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.9}
      accessible
      accessibilityRole="button"
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {content}
    </TouchableOpacity>
  );
}

export function PrototypePrimaryButton({
  label,
  onPress,
  icon,
  style,
  disabled = false,
  testID,
  accessibilityLabel,
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        disabled && styles.primaryButtonDisabled,
        style,
      ]}
      activeOpacity={disabled ? 1 : 0.86}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessible
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      focusable
      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {icon ? (
        <Ionicons name={icon} size={16} color={color.accent.contrast} />
      ) : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function CardHandle() {
  return <View style={styles.handle} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Platform.OS === "android" ? color.bg.panelSolid : color.bg.panel,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: color.border.strong,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.22,
    shadowRadius: 30,
    elevation: Platform.OS === "android" ? 0 : 15,
  },
  handle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(142,154,169,0.64)",
    alignSelf: "center",
    marginBottom: 10,
  },
  destinationInput: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  leadingIconWrap: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
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
    textAlignVertical: "center",
    includeFontPadding: false,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  destinationFieldStaticWrap: {
    flex: 1,
    marginLeft: 10,
    marginRight: 10,
    minHeight: 24,
    justifyContent: "center",
  },
  destinationFieldText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  destinationPlaceholderText: {
    color: color.text.muted,
  },
  trailingButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accent.primary,
    shadowColor: color.shadow.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
    elevation: 7,
  },
  trailingButtonTouchArea: {
    borderRadius: 24,
  },
  trailingButtonDisabled: {
    opacity: 0.68,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: color.accent.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: color.border.strong,
    minWidth: 0,
  },
  primaryButtonDisabled: {
    opacity: 0.56,
  },
  primaryButtonText: {
    color: color.accent.contrast,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    flexShrink: 1,
  },
});
