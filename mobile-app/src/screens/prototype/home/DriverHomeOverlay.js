import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import robotaxiPrototypeTokens from "../../../components/design-system/robotaxiPrototypeTokens";
import { fonts } from "../../../theme/runtimeTokens";
import { PrototypeCard } from "../../../components/prototype/PrototypeUI";

const { color } = robotaxiPrototypeTokens;
const DRIVER_BOTTOM_CTA_OFFSET = 56;
const DRIVER_GOAL_STORAGE_PREFIX = "@prototype_driver_daily_goal_";
const DEFAULT_DAILY_GOAL = 200;

function DriverSliderThumbGlyph({ online = false }) {
  if (online) {
    return (
      <View style={styles.driverBottomThumbCheckWrap}>
        <View style={styles.driverBottomThumbCheckStem} />
        <View style={styles.driverBottomThumbCheckArm} />
      </View>
    );
  }

  return (
    <View style={styles.driverBottomThumbChevronWrap}>
      <View style={styles.driverBottomThumbChevronTop} />
      <View style={styles.driverBottomThumbChevronBottom} />
    </View>
  );
}

function parseGoalInput(value) {
  const sanitized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function DriverHomeOverlay({
  driverId = "",
  insetsBottom = 0,
  driverOnline = false,
  driverOnlinePending = false,
  driverCanGoOnline = false,
  driverActivationResolved = false,
  ridesCount = 0,
  formattedDriverEarnings = "R$ 0,00",
  onToggleOnline,
  onOpenActivation,
  onCtaLayout,
}) {
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);
  const [sliderWidth, setSliderWidth] = useState(0);
  const isActivationBlocked =
    driverActivationResolved && !driverCanGoOnline && !driverOnline;
  const pendingOfflineActivation = driverOnlinePending && !driverOnline;
  const handleSliderPress = isActivationBlocked
    ? onOpenActivation
    : onToggleOnline;
  const sliderStatus = isActivationBlocked
    ? "blocked"
    : pendingOfflineActivation
      ? "pending"
      : driverOnline
        ? "online"
        : "offline";
  const sliderLabel = isActivationBlocked
    ? "Ativação pendente"
    : pendingOfflineActivation
      ? "Ativando..."
    : driverOnline
      ? "Online"
      : "Ficar online";
  const goalStorageKey = useMemo(
    () =>
      `${DRIVER_GOAL_STORAGE_PREFIX}${String(driverId || "anonymous").trim() || "anonymous"}`,
    [driverId],
  );
  const currentGoalProgressLabel =
    String(formattedDriverEarnings || "--,--").trim() || "--,--";
  const goalTargetLabel = String(
    Math.max(0, Math.round(Number(dailyGoal) || DEFAULT_DAILY_GOAL)),
  );
  const sliderProgress = useRef(
    new Animated.Value(driverOnline && !isActivationBlocked ? 1 : 0),
  ).current;
  const sliderTravel = Math.max(0, sliderWidth - 66);
  const sliderThumbTranslateX = sliderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, sliderTravel],
  });

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(goalStorageKey)
      .then((raw) => {
        if (!mounted) {
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          setDailyGoal(parsed);
        } else {
          setDailyGoal(DEFAULT_DAILY_GOAL);
        }
      })
      .catch(() => {
        if (mounted) {
          setDailyGoal(DEFAULT_DAILY_GOAL);
        }
      });

    return () => {
      mounted = false;
    };
  }, [goalStorageKey]);

  useEffect(() => {
    Animated.timing(sliderProgress, {
      toValue: driverOnline && !isActivationBlocked ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [driverOnline, isActivationBlocked, sliderProgress]);

  const handleOpenGoalModal = () => {
    setGoalInput(
      String(Math.max(0, Math.round(Number(dailyGoal) || DEFAULT_DAILY_GOAL))),
    );
    setGoalModalVisible(true);
  };

  const handleSaveGoal = async () => {
    const parsed = parseGoalInput(goalInput);
    if (!parsed) {
      Alert.alert("Meta diária", "Digite um valor válido para a meta.");
      return;
    }

    setDailyGoal(parsed);
    setGoalModalVisible(false);
    try {
      await AsyncStorage.setItem(goalStorageKey, String(parsed));
    } catch (_error) {
      // no-op: meta local, não bloquear UX
    }
  };

  return (
    <>
      <View
        onLayout={onCtaLayout}
        style={[
          styles.driverBottomCtaWrap,
          { bottom: insetsBottom + DRIVER_BOTTOM_CTA_OFFSET },
        ]}
      >
        <PrototypeCard style={styles.driverBottomCard}>
          <View style={styles.driverBottomStatsRow}>
            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.driverBottomGoalStatItem}
              onPress={handleOpenGoalModal}
            >
              <Text style={styles.driverBottomStatLabel}>Meta diária</Text>
              <View style={styles.driverBottomGoalValueRow}>
                <Text style={styles.driverBottomStatValuePrimary}>
                  {currentGoalProgressLabel}
                </Text>
                <Text style={styles.driverBottomStatValueSecondary}>
                  {" "}
                  / {goalTargetLabel}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.driverBottomStatDivider} />

            <View style={styles.driverBottomStatItem}>
              <Text style={styles.driverBottomStatLabel}>Corridas</Text>
              <Text style={styles.driverBottomTripsValue}>
                {Math.max(0, Number(ridesCount) || 0)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.88}
            onPress={handleSliderPress}
            testID="driver-home-toggle-online"
            accessibilityLabel={`driver-home-toggle-online-${sliderStatus}`}
            accessibilityValue={{ text: sliderStatus }}
            onLayout={(event) => {
              const nextWidth = event?.nativeEvent?.layout?.width;
              if (Number.isFinite(nextWidth) && nextWidth > 0) {
                setSliderWidth(nextWidth);
              }
            }}
            style={[
              styles.driverBottomSlider,
              isActivationBlocked
                ? styles.driverBottomSliderDisabled
                : driverOnline
                  ? styles.driverBottomSliderOnline
                  : styles.driverBottomSliderOffline,
            ]}
          >
            <Text
              style={[
                styles.driverBottomSliderText,
                driverOnline && !isActivationBlocked
                  ? styles.driverBottomSliderTextOnline
                  : styles.driverBottomSliderTextOffline,
              ]}
            >
              {sliderLabel}
            </Text>
            <Animated.View
              style={[
                styles.driverBottomSliderThumb,
                driverOnline && !isActivationBlocked
                  ? styles.driverBottomSliderThumbOnline
                  : styles.driverBottomSliderThumbOffline,
                { transform: [{ translateX: sliderThumbTranslateX }] },
                ]}
            >
              <DriverSliderThumbGlyph
                online={driverOnline && !isActivationBlocked}
              />
            </Animated.View>
          </TouchableOpacity>
        </PrototypeCard>
      </View>

      <Modal
        visible={goalModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGoalModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Meta diária</Text>
            <TextInput
              value={goalInput}
              onChangeText={setGoalInput}
              placeholder="Ex: 250,00"
              keyboardType="numeric"
              style={styles.modalInput}
              placeholderTextColor="rgba(33,41,53,0.45)"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.modalGhostButton}
                onPress={() => setGoalModalVisible(false)}
              >
                <Text style={styles.modalGhostButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.modalPrimaryButton}
                onPress={handleSaveGoal}
              >
                <Text style={styles.modalPrimaryButtonText}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export default memo(DriverHomeOverlay);

const styles = StyleSheet.create({
  driverBottomCtaWrap: {
    position: "absolute",
    width: "84%",
    alignSelf: "center",
    zIndex: 16,
  },
  driverBottomCard: {
    borderRadius: 32,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 10,
  },
  driverBottomStatsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  driverBottomStatItem: {
    flex: 0.62,
    minHeight: 48,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  driverBottomGoalStatItem: {
    flex: 1.52,
    minHeight: 48,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  driverBottomStatDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(55,68,84,0.12)",
    marginHorizontal: 8,
  },
  driverBottomStatLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    textAlign: "center",
  },
  driverBottomGoalValueRow: {
    marginTop: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  driverBottomStatValuePrimary: {
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.45,
  },
  driverBottomStatValueSecondary: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: -0.1,
  },
  driverBottomTripsValue: {
    marginTop: 0,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 36,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  driverBottomSlider: {
    minHeight: 68,
    borderRadius: 28,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    paddingHorizontal: 72,
  },
  driverBottomSliderOffline: {
    backgroundColor: "#D7DCE3",
    borderColor: "#C8D0DA",
  },
  driverBottomSliderOnline: {
    backgroundColor: color.accent.primary,
    borderColor: color.accent.primary,
  },
  driverBottomSliderDisabled: {
    backgroundColor: "#D7DCE3",
    borderColor: "#C8D0DA",
  },
  driverBottomSliderText: {
    fontFamily: fonts.SemiBold,
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: -0.15,
  },
  driverBottomSliderTextOnline: {
    color: "rgba(255,255,255,0.96)",
  },
  driverBottomSliderTextOffline: {
    color: "#44505C",
  },
  driverBottomSliderThumb: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  driverBottomSliderThumbOffline: {
    backgroundColor: "#314052",
  },
  driverBottomSliderThumbOnline: {
    backgroundColor: "#134E1F",
  },
  driverBottomThumbChevronWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  driverBottomThumbChevronTop: {
    position: "absolute",
    width: 11,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.96)",
    transform: [{ rotate: "45deg" }],
    top: 4,
    left: 3,
  },
  driverBottomThumbChevronBottom: {
    position: "absolute",
    width: 11,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.96)",
    transform: [{ rotate: "-45deg" }],
    bottom: 4,
    left: 3,
  },
  driverBottomThumbCheckWrap: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  driverBottomThumbCheckStem: {
    position: "absolute",
    width: 7,
    height: 2.8,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.96)",
    transform: [{ rotate: "45deg" }],
    left: 2,
    top: 9,
  },
  driverBottomThumbCheckArm: {
    position: "absolute",
    width: 12,
    height: 2.8,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.96)",
    transform: [{ rotate: "-45deg" }],
    left: 6,
    top: 7,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(8,11,18,0.36)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  modalCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  modalTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  modalInput: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 15,
  },
  modalActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  modalGhostButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.surface.secondary,
  },
  modalGhostButtonText: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
  },
  modalPrimaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accent.primary,
  },
  modalPrimaryButtonText: {
    color: color.accent.contrast,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
  },
});
