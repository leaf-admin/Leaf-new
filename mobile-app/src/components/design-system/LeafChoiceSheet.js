import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { leafInk } from './leafTypeScale';
import leafTypography from '../prototype/LeafTypography';

// In-app bottom sheet for a question with a few answers. Replaces the system
// alert for ride decisions, so both platforms show the same Leaf surface.
//
//   const key = await showLeafChoiceSheet({ title, message, options });
//
// Resolves with the chosen option key, or null when dismissed. Without a
// mounted host (tests, early boot) it falls back to the system alert.

let presentRequest = null;

export function showLeafChoiceSheet({ title, message, options = [], dismissible = false } = {}) {
  return new Promise((resolve) => {
    if (presentRequest) {
      presentRequest({ title, message, options, dismissible, resolve });
      return;
    }
    Alert.alert(
      title,
      message,
      options.map((option) => ({
        text: option.label,
        style: option.tone === 'secondary' ? 'cancel' : 'default',
        onPress: () => resolve(option.key),
      })),
      {
        cancelable: dismissible,
        onDismiss: () => resolve(null),
        __skipFriendlyAlertPatch: true,
      },
    );
  });
}

export function LeafChoiceSheetHost() {
  // Mounted above the navigator, outside any SafeAreaProvider.
  const insets = initialWindowMetrics?.insets || { bottom: 0 };
  const [request, setRequest] = useState(null);
  const queueRef = useRef([]);
  const progress = useRef(new Animated.Value(0)).current;

  const open = useCallback((next) => {
    setRequest((current) => {
      if (current) {
        queueRef.current.push(next);
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    presentRequest = open;
    return () => {
      if (presentRequest === open) presentRequest = null;
    };
  }, [open]);

  useEffect(() => {
    if (!request) return;
    progress.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(progress, {
      toValue: 1,
      damping: 22,
      stiffness: 240,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [progress, request]);

  const close = useCallback((key) => {
    const current = request;
    if (!current) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      current.resolve(key);
      setRequest(queueRef.current.shift() || null);
    });
  }, [progress, request]);

  if (!request) return null;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => {
        if (request.dismissible) close(null);
      }}
    >
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (request.dismissible) close(null);
          }}
          accessible={false}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, 12) + 12,
            transform: [
              {
                translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }),
              },
            ],
          },
        ]}
        accessibilityViewIsModal
        testID="leaf-choice-sheet"
      >
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">{request.title}</Text>
        {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
        <View style={styles.options}>
          {request.options.map((option) => {
            const secondary = option.tone === 'secondary';
            return (
              <Pressable
                key={option.key}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  close(option.key);
                }}
                style={({ pressed }) => [
                  styles.option,
                  secondary ? styles.optionSecondary : styles.optionPrimary,
                  pressed && styles.optionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                testID={`leaf-choice-sheet-option-${option.key}`}
              >
                <Text style={[styles.optionLabel, secondary && styles.optionLabelSecondary]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,20,16,0.42)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    marginBottom: 18,
  },
  title: {
    ...leafTypography.bold,
    fontSize: 22,
    lineHeight: 28,
    color: leafInk.primary,
  },
  message: {
    ...leafTypography.regular,
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: leafInk.secondary,
  },
  options: {
    marginTop: 22,
    gap: 10,
  },
  option: {
    minHeight: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  optionPrimary: {
    backgroundColor: '#222222',
  },
  optionSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  optionPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
  },
  optionLabel: {
    ...leafTypography.semiBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  optionLabelSecondary: {
    color: leafInk.primary,
  },
});

export default LeafChoiceSheetHost;
