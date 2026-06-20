import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import {
  CardHandle,
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../components/prototype/PrototypeUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import RatingService from "../../services/RatingService";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 336;

const PASSENGER_REVIEW_TAGS = [
  "Condução segura",
  "Pontualidade",
  "Veículo limpo",
  "Boa comunicação",
];
const DRIVER_REVIEW_TAGS = [
  "Pontualidade",
  "Embarque rápido",
  "Boa comunicação",
  "Respeitou o veículo",
];

function normalizeReviewerType(rawReviewerType, activeRole) {
  const normalized = String(rawReviewerType || activeRole || "")
    .trim()
    .toLowerCase();

  if (normalized === "driver" || normalized === "motorista") {
    return "driver";
  }

  return "passenger";
}

function isTruthyRouteParam(value) {
  if (value === true) {
    return true;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeAutoBoolean(value, fallback = null) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "nao", "não"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export default function RobotaxiRatingScreen({ navigation, route }) {
  const {
    activeRole,
    profile,
    driverInfo,
    lastReceipt,
    markTripRating,
    dismissCompletedReceipt,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const reviewerType = normalizeReviewerType(
    route?.params?.reviewerType,
    activeRole,
  );
  const reviewTargetLabel =
    reviewerType === "driver" ? "passageiro" : "motorista";
  const receipt = route?.params?.receipt || lastReceipt || null;
  const targetUserId =
    route?.params?.targetUserId ||
    (reviewerType === "driver"
      ? receipt?.passengerId
      : receipt?.driverId || driverInfo?.id) ||
    null;
  const targetName =
    route?.params?.targetName ||
    (reviewerType === "driver"
      ? receipt?.passengerName || "Passageiro Leaf"
      : receipt?.driverName || driverInfo?.name || "Motorista Leaf");
  const tripId = route?.params?.tripId || receipt?.id || null;
  const quickTags =
    reviewerType === "driver" ? DRIVER_REVIEW_TAGS : PASSENGER_REVIEW_TAGS;
  const [selectedTags, setSelectedTags] = useState(() =>
    reviewerType === "driver" ? ["Pontualidade"] : ["Condução segura"],
  );
  const [airConditioningOk, setAirConditioningOk] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const qaAutoSubmitStartedRef = useRef(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const cardMaxHeight = Math.max(
    340,
    windowHeight - insets.top - insets.bottom - 86,
  );
  const fromReceipt = Boolean(route?.params?.fromReceipt);
  const qaAutoSubmit = isTruthyRouteParam(
    route?.params?.qaAutoSubmit || route?.params?.autoSubmit,
  );
  const qaAutoComment = String(
    route?.params?.qaComment || route?.params?.comment || "",
  ).trim();
  const qaAutoAirConditioningOk = normalizeAutoBoolean(
    route?.params?.qaAirConditioningOk || route?.params?.airConditioningOk,
    true,
  );
  const qaAutoSubmitDelayMs = Math.max(
    250,
    Number(route?.params?.qaAutoSubmitDelayMs || route?.params?.autoSubmitDelayMs) || 1200,
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-rating",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    if (fromReceipt) {
      navigation.navigate("RobotaxiPrototypeReceipt", {
        fromTrip: true,
        fromRating: true,
      });
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  };

  const toggleTag = useCallback((tag) => {
    setSelectedTags((previous) => {
      if (previous.includes(tag)) {
        return previous.filter((item) => item !== tag);
      }

      return [...previous, tag];
    });
  }, []);

  const summary = useMemo(() => {
    if (reviewerType === "driver") {
      if (selectedTags.length === 0) {
        return comment.trim();
      }
      return [...selectedTags, comment.trim()].filter(Boolean).join(" | ");
    }
    const acLine =
      airConditioningOk === null
        ? ""
        : `Ar-condicionado ligado durante toda a corrida: ${airConditioningOk ? "Sim" : "Não"}`;
    if (selectedTags.length === 0) {
      return [acLine, comment.trim()].filter(Boolean).join(" | ");
    }
    return [...selectedTags, acLine, comment.trim()]
      .filter(Boolean)
      .join(" | ");
  }, [airConditioningOk, comment, reviewerType, selectedTags]);

  const handleSubmit = useCallback(async () => {
    if (!tripId) {
      Alert.alert(
        "Corrida indisponível",
        "Não encontramos a corrida para registrar esta avaliação.",
      );
      return;
    }

    if (!profile?.uid) {
      Alert.alert(
        "Sessão indisponível",
        "Faça login novamente para enviar a avaliação.",
      );
      return;
    }

    if (!targetUserId) {
      Alert.alert(
        "Avaliação indisponível",
        `Não encontramos os dados do ${reviewTargetLabel} para registrar esta avaliação.`,
      );
      return;
    }

    if (reviewerType === "passenger" && airConditioningOk === null) {
      Alert.alert(
        "Confirmação necessária",
        "Informe se o ar-condicionado permaneceu ligado durante toda a corrida antes de enviar.",
      );
      return;
    }

    try {
      setIsSubmitting(true);

      const selectedOptions =
        reviewerType === "driver"
          ? selectedTags
          : [
              ...selectedTags,
              ...(airConditioningOk === null
                ? []
                : [`Ar-condicionado: ${airConditioningOk ? "Sim" : "Não"}`]),
            ];

      await RatingService.submitRating({
        tripId,
        userId: profile.uid,
        reviewerId: profile.uid,
        reviewerType,
        userType: reviewerType,
        targetUserId,
        ...(reviewerType === "driver"
          ? { passengerId: targetUserId }
          : { driverId: targetUserId }),
        rating,
        comment: comment.trim(),
        selectedOptions,
        tripData:
          reviewerType === "driver"
            ? { passengerId: targetUserId, passenger: targetUserId }
            : { driverId: targetUserId, driver: targetUserId },
      });

      markTripRating(
        tripId,
        reviewerType === "driver"
          ? {
              driverRatedPassengerAt: new Date().toISOString(),
              driverRatedPassengerValue: rating,
              driverRatedPassengerComment: comment.trim(),
            }
          : {
              passengerRatedDriverAt: new Date().toISOString(),
              passengerRatedDriverValue: rating,
              passengerRatedDriverComment: comment.trim(),
            },
      );

      dismissCompletedReceipt();
      navigation.navigate("RobotaxiPrototype");
      Alert.alert(
        "Avaliação enviada",
        `Sua nota para ${targetName} foi registrada com sucesso.`,
      );
    } catch (error) {
      Alert.alert(
        "Não foi possível enviar",
        error?.message || "Tivemos um problema ao registrar a avaliação agora.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    airConditioningOk,
    comment,
    dismissCompletedReceipt,
    markTripRating,
    navigation,
    profile?.uid,
    rating,
    reviewerType,
    reviewTargetLabel,
    selectedTags,
    targetName,
    targetUserId,
    tripId,
  ]);

  useEffect(() => {
    if (!qaAutoSubmit || isSubmitting || qaAutoSubmitStartedRef.current) {
      return;
    }

    if (qaAutoComment && comment !== qaAutoComment) {
      setComment(qaAutoComment);
      return;
    }

    if (reviewerType === "passenger" && airConditioningOk === null) {
      setAirConditioningOk(qaAutoAirConditioningOk);
      return;
    }

    qaAutoSubmitStartedRef.current = true;
    const timer = setTimeout(() => {
      handleSubmit();
    }, qaAutoSubmitDelayMs);

    return () => clearTimeout(timer);
  }, [
    airConditioningOk,
    comment,
    handleSubmit,
    isSubmitting,
    qaAutoAirConditioningOk,
    qaAutoComment,
    qaAutoSubmit,
    qaAutoSubmitDelayMs,
    reviewerType,
  ]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />

        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Math.max(0, insets.top - 4)}
          style={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard
            onLayout={handleCardLayout}
            style={[styles.card, { maxHeight: cardMaxHeight }]}
            testID={
              reviewerType === "driver"
                ? "driver-rating-screen"
                : "passenger-rating-screen"
            }
            accessibilityLabel={
              reviewerType === "driver"
                ? "driver-rating-screen"
                : "passenger-rating-screen"
            }
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.cardScroll}
            >
              <CardHandle />

              <Text style={styles.title}>
              {reviewerType === "driver"
                ? "Avalie o passageiro"
                : "Avalie a viagem"}
              </Text>
              <Text style={styles.subtitle}>
              {reviewerType === "driver"
                ? `Seu feedback sobre ${targetName} ajuda a melhorar a comunidade Leaf.`
                : "Sua opinião ajuda a melhorar a próxima viagem."}
              </Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((value) => {
                const active = value <= rating;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setRating(value)}
                    activeOpacity={0.86}
                  >
                    <Ionicons
                      name={active ? "star" : "star-outline"}
                      size={30}
                      color={active ? color.accent.primary : color.border.strong}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.tagsWrap}>
              {quickTags.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.tagChip, active && styles.tagChipActive]}
                    activeOpacity={0.86}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text
                      style={[styles.tagText, active && styles.tagTextActive]}
                    >
                      {tag}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder={
                reviewerType === "driver"
                  ? "Comentário opcional sobre o passageiro"
                  : "Comentário opcional"
              }
              placeholderTextColor={color.text.muted}
              style={styles.input}
              multiline
            />

            {reviewerType === "passenger" ? (
              <View style={styles.airConditioningCard}>
                <Text style={styles.airConditioningTitle}>
                  O ar-condicionado permaneceu ligado durante toda a corrida?
                </Text>
                <View style={styles.airConditioningActions}>
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={[
                      styles.airConditioningButton,
                      airConditioningOk === true &&
                        styles.airConditioningButtonActive,
                    ]}
                    onPress={() => setAirConditioningOk(true)}
                    testID="passenger-rating-air-conditioning-yes"
                    accessibilityLabel="passenger-rating-air-conditioning-yes"
                  >
                    <Text
                      style={[
                        styles.airConditioningButtonText,
                        airConditioningOk === true &&
                          styles.airConditioningButtonTextActive,
                      ]}
                    >
                      Sim
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={[
                      styles.airConditioningButton,
                      airConditioningOk === false &&
                        styles.airConditioningButtonActive,
                    ]}
                    onPress={() => setAirConditioningOk(false)}
                    testID="passenger-rating-air-conditioning-no"
                    accessibilityLabel="passenger-rating-air-conditioning-no"
                  >
                    <Text
                      style={[
                        styles.airConditioningButtonText,
                        airConditioningOk === false &&
                          styles.airConditioningButtonTextActive,
                      ]}
                    >
                      Não
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <Text numberOfLines={1} style={styles.summaryText}>
              {summary
                ? `Resumo: ${summary}`
                : "Selecione uma opção ou escreva um comentário."}
            </Text>

            <PrototypePrimaryButton
              label={isSubmitting ? "Enviando..." : "Enviar avaliação"}
              icon="checkmark-outline"
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={styles.submitButton}
              testID="passenger-rating-submit-button"
              accessibilityLabel="passenger-rating-submit-button"
            />
            </ScrollView>
          </PrototypeCard>
        </KeyboardAvoidingView>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F6F1",
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
  },
  cardScroll: {
    paddingBottom: 2,
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
  starsRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  tagsWrap: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  tagChip: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tagChipActive: {
    borderColor: color.border.strong,
    backgroundColor: color.surface.activeSoft,
  },
  tagText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  tagTextActive: {
    color: color.text.primary,
  },
  input: {
    marginTop: 10,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: color.text.primary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlignVertical: "top",
  },
  airConditioningCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  airConditioningTitle: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  airConditioningActions: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  airConditioningButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  airConditioningButtonActive: {
    borderColor: color.border.strong,
    backgroundColor: color.surface.activeSoft,
  },
  airConditioningButtonText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  airConditioningButtonTextActive: {
    color: color.text.primary,
  },
  summaryText: {
    marginTop: 8,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  submitButton: {
    marginTop: 10,
  },
});
