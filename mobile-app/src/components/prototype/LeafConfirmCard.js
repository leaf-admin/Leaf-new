import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import leafTypography from "./LeafTypography";
import { LeafButton } from "./LeafRideUI";
import { LeafObjectIcon } from "./LeafVisualElements";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";

// Confirmação no padrão do app: card flutuante que sobe do rodapé, fundo escurece de leve.
// Substitui o Alert nativo, que no Android abre a janela cinza do sistema.
export default function LeafConfirmCard({
  visible,
  icon = "logout",
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  bottomInset = 0,
  testID = "leaf-confirm-card",
}) {
  const reduceMotion = useReducedMotion();
  const haptic = useHapticFeedback();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(Boolean(visible));

  useEffect(() => {
    if (visible) {
      setMounted(true);
      haptic("tap");
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        damping: 22,
        stiffness: 260,
        mass: 0.9,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : 160,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [haptic, progress, reduceMotion, visible]);

  if (!mounted) return null;

  const cardStyle = {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 28, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.97, 1] }) },
    ],
  };

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.root} testID={testID}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel={cancelLabel} />
        </Animated.View>
        <Animated.View style={[styles.card, { marginBottom: Math.max(16, bottomInset + 12) }, cardStyle]}>
          <View style={styles.header}>
            <LeafObjectIcon name={icon} size={44} />
            <View style={styles.copy}>
              <Text style={styles.title}>{title}</Text>
              {message ? <Text style={styles.message}>{message}</Text> : null}
            </View>
          </View>
          <View style={styles.actions}>
            <LeafButton
              label={cancelLabel}
              tone="ghost"
              style={styles.action}
              onPress={onCancel}
              testID={`${testID}-cancel`}
            />
            <LeafButton
              label={confirmLabel}
              tone="primary"
              style={styles.action}
              onPress={() => {
                haptic("medium");
                onConfirm?.();
              }}
              testID={`${testID}-confirm`}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 12,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 20, 8, 0.28)",
  },
  card: {
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    padding: 20,
    shadowColor: "#0E1F12",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  copy: {
    flex: 1,
  },
  title: {
    ...leafTypography.semiBold,
    fontSize: 18,
    color: "#11210C",
  },
  message: {
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(17, 33, 12, 0.64)",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  action: {
    flex: 1,
  },
});
