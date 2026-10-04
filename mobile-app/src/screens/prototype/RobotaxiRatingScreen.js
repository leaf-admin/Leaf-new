import leafTypography from '../../components/prototype/LeafTypography';
import { RobotaxiLifecycleSummary } from '../../components/prototype/RobotaxiLifecycleUI';
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
import { StackActions } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  robotaxiLifecycleMetrics,
} from "../../components/prototype/RobotaxiLifecycleUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
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

function resolveSubmittedRatingValue(result, fallbackRating) {
  const rawRating =
    result?.rating && typeof result.rating === "object"
      ? result.rating.rating
      : result?.rating;
  const numeric = Number(rawRating);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric;
  }
  return fallbackRating;
}

function resolveSubmittedComment(result, fallbackComment) {
  const rawComment =
    result?.rating && typeof result.rating === "object"
      ? result.rating.comment
      : result?.comment;
  if (typeof rawComment === "string") {
    return rawComment.trim();
  }
  return fallbackComment.trim();
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
  const triggerHaptic = useHapticFeedback();
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
  const [secondaryActionsVisible, setSecondaryActionsVisible] = useState(false);
  const qaAutoSubmitStartedRef = useRef(false);
  const sheetBottom =
    SHEET_BOTTOM_OFFSET + robotaxiLifecycleMetrics.cardBottomGap;
  const cardMaxHeight = Math.max(
    340,
    windowHeight - insets.top - insets.bottom - 86,
  );
  const qaAutoSubmit = isTruthyRouteParam(
    route?.params?.qaAutoSubmit || route?.params?.autoSubmit,
  );
  const terminalExitRef = useRef(false);
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

  const replaceWithPrototypeHome = useCallback(() => {
    terminalExitRef.current = true;
    const resetParams = {
      resetPassengerHomeSearch: true,
      resetPassengerHomeSearchAt: new Date().toISOString(),
      source: "rating_completed",
    };

    if (typeof navigation.replace === "function") {
      navigation.replace("RobotaxiPrototype", resetParams);
      return;
    }

    if (typeof navigation.dispatch === "function") {
      navigation.dispatch(StackActions.replace("RobotaxiPrototype", resetParams));
      return;
    }

    navigation.navigate("RobotaxiPrototype", resetParams);
  }, [navigation]);

  const handleDismiss = useCallback(() => {
    dismissCompletedReceipt();
    replaceWithPrototypeHome();
  }, [dismissCompletedReceipt, replaceWithPrototypeHome]);

  useEffect(() => {
    if (typeof navigation?.addListener !== "function") {
      return undefined;
    }

    const unsubscribe = navigation.addListener("beforeRemove", event => {
      if (terminalExitRef.current) {
        terminalExitRef.current = false;
        return;
      }

      event?.preventDefault?.();
      handleDismiss();
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [handleDismiss, navigation]);

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

      const submitResult = await RatingService.submitRating({
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
      const committedRating = resolveSubmittedRatingValue(submitResult, rating);
      const committedComment = resolveSubmittedComment(submitResult, comment);

      markTripRating(
        tripId,
        reviewerType === "driver"
          ? {
              driverRatedPassengerAt: new Date().toISOString(),
              driverRatedPassengerValue: committedRating,
              driverRatedPassengerComment: committedComment,
            }
          : {
              passengerRatedDriverAt: new Date().toISOString(),
              passengerRatedDriverValue: committedRating,
              passengerRatedDriverComment: committedComment,
            },
      );

      dismissCompletedReceipt();
      replaceWithPrototypeHome();
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
    profile?.uid,
    rating,
    replaceWithPrototypeHome,
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
    <PrototypeScreenTransition direction="up">
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
          <RobotaxiLifecycleCard
            onLayout={handleCardLayout}
            style={[styles.card, { maxHeight: cardMaxHeight, paddingBottom: robotaxiLifecycleMetrics.cardPaddingBottom + insets.bottom }]}
            testID={
              reviewerType === "driver"
                ? "driver-rating-screen"
                : "passenger-rating-screen"
            }
            accessibilityLabel={
              reviewerType === "driver"
                ? "Avaliação do passageiro"
                : "Avaliação da viagem"
            }
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.cardScroll}
            >
              <RobotaxiLifecycleSummary
                title={reviewerType === "driver"
                ? "Avalie o passageiro"
                : "Avalie a viagem"}
                subtitle={reviewerType === "driver"
                ? `Seu feedback sobre ${targetName} ajuda a melhorar a comunidade Leaf.`
                : "Sua opinião ajuda a melhorar a próxima viagem."}
                object="account"
              />

            <View
              style={styles.starsRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Nota da avaliação"
            >
              {[1, 2, 3, 4, 5].map((value) => {
                const active = value <= rating;
                return (
                  <TouchableOpacity
                    key={value}
                    testID={`rating-star-${value}`}
                    onPress={() => {
                      triggerHaptic("tap");
                      setRating(value);
                    }}
                    activeOpacity={0.86}
                    accessibilityRole="radio"
                    accessibilityLabel={`${value} ${value === 1 ? "estrela" : "estrelas"}`}
                    accessibilityHint="Seleciona a nota da avaliação."
                    accessibilityState={{ checked: active }}
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
                    accessibilityRole="checkbox"
                    accessibilityLabel={tag}
                    accessibilityHint="Inclui ou remove este marcador da avaliação."
                    accessibilityState={{ checked: active }}
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
              accessibilityLabel={
                reviewerType === "driver"
                  ? "Comentário sobre o passageiro"
                  : "Comentário sobre a viagem"
              }
              accessibilityHint="Comentário opcional."
            />

            {reviewerType === "passenger" ? (
              <View style={styles.airConditioningCard}>
                <Text style={styles.airConditioningTitle}>
                  O ar-condicionado permaneceu ligado durante toda a corrida?
                </Text>
                <View
                  style={styles.airConditioningActions}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="O ar-condicionado permaneceu ligado durante toda a corrida?"
                >
                  <TouchableOpacity
                    activeOpacity={0.86}
                    style={[
                      styles.airConditioningButton,
                      airConditioningOk === true &&
                        styles.airConditioningButtonActive,
                    ]}
                    onPress={() => setAirConditioningOk(true)}
                    testID="passenger-rating-air-conditioning-yes"
                    accessibilityRole="radio"
                    accessibilityLabel="Sim, o ar-condicionado permaneceu ligado"
                    accessibilityState={{ checked: airConditioningOk === true }}
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
                    accessibilityRole="radio"
                    accessibilityLabel="Não, o ar-condicionado não permaneceu ligado"
                    accessibilityState={{ checked: airConditioningOk === false }}
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

            <RobotaxiLifecycleButton
              label={isSubmitting ? "Enviando avaliação" : "Enviar avaliação"}
              icon="checkmark-outline"
              tone="primary"
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={styles.submitButton}
              testID="passenger-rating-submit-button"
              accessibilityLabel={isSubmitting ? "Enviando avaliação" : "Enviar avaliação"}
            />
            <RobotaxiLifecycleDisclosure
              expanded={secondaryActionsVisible}
              onPress={() => setSecondaryActionsVisible((visible) => !visible)}
              style={styles.ratingMoreOptions}
              label="Mais opções"
              expandedLabel="Ocultar opções"
              testID="rating-more-options-button"
            />
            {secondaryActionsVisible ? (
              <RobotaxiLifecycleButton
                label="Agora não"
                disabled={isSubmitting}
                onPress={handleDismiss}
                style={styles.skipButton}
                testID="rating-skip-to-map-button"
                accessibilityLabel="Agora não"
                accessibilityHint="Pula a avaliação e retorna ao mapa."
              />
            ) : null}
            </ScrollView>
          </RobotaxiLifecycleCard>
        </KeyboardAvoidingView>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
  },
  cardScroll: {
    paddingBottom: 2,
  },
  title: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'left',
  },
  subtitle: {
    marginTop: 2,
    color: color.text.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'left',
  },
  starsRow: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: 12,
  },
  tagsWrap: {
    marginTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 8,
  },
  tagChip: {
    minHeight: 44,
    borderRadius: 12,
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
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  tagTextActive: {
    color: color.text.primary,
  },
  input: {
    marginTop: 10,
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: color.text.primary,
    ...leafTypography.regular,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  airConditioningCard: {
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 0,
    paddingVertical: 16,
  },
  airConditioningTitle: {
    color: color.text.primary,
    ...leafTypography.medium,
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
    minHeight: 44,
    borderRadius: 12,
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
    ...leafTypography.medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  airConditioningButtonTextActive: {
    color: color.text.primary,
  },
  summaryText: {
    marginTop: 8,
    color: color.text.secondary,
    ...leafTypography.regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  submitButton: {
    marginTop: 10,
  },
  ratingMoreOptions: {
    marginTop: 8,
  },
  skipButton: {
    marginTop: 8,
  },
});
