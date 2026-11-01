import React, { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import LeafTouchable from "../../components/design-system/LeafTouchable";
import leafTypography from "../../components/prototype/LeafTypography";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleSummary,
  robotaxiLifecycleMetrics,
} from "../../components/prototype/RobotaxiLifecycleUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";

const { color } = robotaxiPrototypeTokens;

export const LOW_RATING_LIMIT = 3;
const PASSENGER_LOW_RATING_TAGS = ["Direção", "Atraso", "Veículo", "Comunicação"];
const DRIVER_LOW_RATING_TAGS = [
  "Atraso no embarque",
  "Comunicação",
  "Comportamento",
  "Cuidado com o veículo",
];
const CARD_TOP_RESERVE = 72;

// Etapas do fim de corrida: "air" (só passageiro), "rate" e "details". O recibo completo
// fica na tela do recibo; ao voltar dele o card reabre em "details".
export function resolveInitialClosingStage({ isDriver, airConditioningAnswered, rated, detailsOpened }) {
  if (detailsOpened || rated) return "details";
  if (!isDriver && !airConditioningAnswered) return "air";
  return "rate";
}

function animateNextLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export default function RideClosingCard({
  isDriver,
  amountCaption,
  amount,
  amountTestID,
  tripSummary,
  dateLabel,
  targetFirstName,
  pickupTitle,
  dropoffTitle,
  valueRows,
  canRate,
  airConditioningAnswered,
  rated,
  detailsOpened,
  onAnswerAirConditioning,
  onSubmitRating,
  onOpenDetails,
  onOpenFullReceipt,
  onDone,
  onLayout,
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const triggerHaptic = useHapticFeedback();
  const [stage, setStage] = useState(() =>
    resolveInitialClosingStage({ isDriver, airConditioningAnswered, rated, detailsOpened }),
  );
  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [airError, setAirError] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  const ratingAttemptsRef = useRef(0);
  const ratingSentRef = useRef(Boolean(rated));

  const goToStage = useCallback((next) => {
    animateNextLayout();
    setStage(next);
  }, []);

  const answerAirConditioning = useCallback(
    async (value) => {
      if (busy) return;
      triggerHaptic("tap");
      setBusy(true);
      setAirError(false);
      try {
        await onAnswerAirConditioning(value);
        goToStage("rate");
      } catch (_error) {
        setAirError(true);
      } finally {
        setBusy(false);
      }
    },
    [busy, goToStage, onAnswerAirConditioning, triggerHaptic],
  );

  // A nota sai uma vez, ao deixar a etapa. Sem estrelas não há o que enviar. Depois de
  // duas falhas o card deixa sair: o RatingService guarda a nota para reenviar.
  const leaveRating = useCallback(
    async (next) => {
      if (busy) return;
      if (rating === 0 || ratingSentRef.current) {
        next();
        return;
      }
      setBusy(true);
      setRatingError(false);
      try {
        ratingAttemptsRef.current += 1;
        await onSubmitRating({ rating, selectedOptions: selectedTags, comment: comment.trim() });
        ratingSentRef.current = true;
        next();
      } catch (_error) {
        if (ratingAttemptsRef.current >= 2) {
          next();
        } else {
          setRatingError(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, comment, onSubmitRating, rating, selectedTags],
  );

  const openDetails = useCallback(() => {
    onOpenDetails?.();
    goToStage("details");
  }, [goToStage, onOpenDetails]);

  const toggleTag = useCallback((tag) => {
    setSelectedTags((previous) =>
      previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag],
    );
  }, []);

  const lowRating = rating > 0 && rating <= LOW_RATING_LIMIT;
  const lowRatingTags = isDriver ? DRIVER_LOW_RATING_TAGS : PASSENGER_LOW_RATING_TAGS;
  const cardMaxHeight = Math.max(320, windowHeight - insets.top - CARD_TOP_RESERVE);

  const renderAmount = (subtitle) => (
    <RobotaxiLifecycleSummary
      eyebrow={amountCaption}
      title={amount}
      hero
      subtitle={subtitle}
      titleTestID={amountTestID}
    />
  );

  const renderAirStage = () => (
    <View testID="closing-air-conditioning-stage">
      <RobotaxiLifecycleSummary eyebrow="Corrida concluída" title="O ar ficou ligado a corrida toda?" />
      <View
        style={styles.actions}
        accessibilityLabel="O ar-condicionado ficou ligado durante toda a corrida?"
      >
        {[
          { value: true, label: "Sim", spoken: "Sim, o ar-condicionado ficou ligado", testID: "closing-air-conditioning-yes" },
          { value: false, label: "Não", spoken: "Não, o ar-condicionado não ficou ligado", testID: "closing-air-conditioning-no" },
        ].map((option) => (
          <RobotaxiLifecycleButton
            key={option.label}
            label={option.label}
            style={styles.action}
            disabled={busy}
            onPress={() => answerAirConditioning(option.value)}
            accessibilityLabel={option.spoken}
            testID={option.testID}
          />
        ))}
      </View>
      {airError ? (
        <>
          <Text style={styles.errorText} testID="closing-air-conditioning-error">
            Não conseguimos registrar. Toque de novo na resposta.
          </Text>
          <LeafTouchable
            style={styles.linkButton}
            activeOpacity={0.76}
            onPress={() => goToStage("rate")}
            accessibilityRole="button"
            accessibilityLabel="Continuar sem responder"
            testID="closing-air-conditioning-skip"
          >
            <Text style={styles.linkText}>Continuar sem responder</Text>
          </LeafTouchable>
        </>
      ) : null}
    </View>
  );

  const renderRateStage = () => (
    <View testID="closing-rate-stage">
      {renderAmount(tripSummary)}
      {canRate ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.prompt}>
            {targetFirstName ? `Como foi com ${targetFirstName}?` : "Como foi a corrida?"}
          </Text>
          <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Nota da avaliação">
            {[1, 2, 3, 4, 5].map((value) => {
              const active = value <= rating;
              return (
                <LeafTouchable
                  key={value}
                  style={styles.star}
                  testID={`rating-star-${value}`}
                  activeOpacity={0.86}
                  onPress={() => {
                    triggerHaptic("tap");
                    animateNextLayout();
                    setRating(value);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${value} ${value === 1 ? "estrela" : "estrelas"}`}
                  accessibilityState={{ checked: active }}
                >
                  <Ionicons
                    name={active ? "star" : "star-outline"}
                    size={34}
                    color={active ? color.accent.primary : color.border.strong}
                  />
                </LeafTouchable>
              );
            })}
          </View>
        </>
      ) : null}
      {lowRating ? (
        <View testID="closing-low-rating">
          <Text style={[styles.prompt, styles.lowRatingPrompt]}>O que aconteceu?</Text>
          <View style={styles.tags}>
            {lowRatingTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <LeafTouchable
                  key={tag}
                  style={[styles.tag, active && styles.tagActive]}
                  activeOpacity={0.86}
                  onPress={() => toggleTag(tag)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={tag}
                  accessibilityState={{ checked: active }}
                >
                  <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag}</Text>
                </LeafTouchable>
              );
            })}
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Conte mais, se quiser"
            placeholderTextColor={color.text.muted}
            style={styles.input}
            multiline
            maxLength={500}
            accessibilityLabel="Comentário sobre a corrida"
            testID="closing-rating-comment"
          />
        </View>
      ) : null}
      {ratingError ? (
        <Text style={styles.errorText} testID="closing-rating-error">
          Não conseguimos enviar sua nota. Toque de novo para tentar.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <RobotaxiLifecycleButton
          label="Ver recibo"
          style={styles.action}
          disabled={busy}
          onPress={() => leaveRating(openDetails)}
          testID="closing-view-receipt-button"
        />
        <RobotaxiLifecycleButton
          label={busy ? "Enviando" : "Concluir"}
          tone="primary"
          style={styles.action}
          disabled={busy}
          onPress={() => leaveRating(onDone)}
          testID="receipt-done-button"
          accessibilityLabel="Concluir"
        />
      </View>
    </View>
  );

  const renderDetailsStage = () => (
    <View testID="closing-details-stage">
      <View style={styles.detailsHeader}>
        <View style={styles.detailsAmount}>{renderAmount()}</View>
        {dateLabel ? <Text style={styles.detailsDate}>{dateLabel}</Text> : null}
      </View>
      <View style={styles.divider} />
      <View style={styles.stop}>
        <View style={styles.stopDot} />
        <Text style={styles.stopText} numberOfLines={1}>{pickupTitle}</Text>
      </View>
      <View style={styles.stop}>
        <View style={styles.stopSquare} />
        <Text style={styles.stopText} numberOfLines={1}>{dropoffTitle}</Text>
      </View>
      <View style={styles.divider} />
      {valueRows.map((row) => (
        <View key={row.label} style={styles.valueRow} testID={row.testID}>
          <Text style={styles.valueLabel}>{row.label}</Text>
          <Text style={styles.valueAmount} testID={row.valueTestID}>{row.value}</Text>
        </View>
      ))}
      <View style={styles.actions}>
        <RobotaxiLifecycleButton
          label="Recibo completo"
          style={styles.action}
          onPress={onOpenFullReceipt}
          testID="closing-full-receipt-button"
        />
        <RobotaxiLifecycleButton
          label="Concluir"
          tone="primary"
          style={styles.action}
          onPress={onDone}
          testID="receipt-done-button"
        />
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      pointerEvents="box-none"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.wrap, { bottom: robotaxiLifecycleMetrics.cardBottomGap + insets.bottom }]}
    >
      <RobotaxiLifecycleCard
        style={[styles.card, { maxHeight: cardMaxHeight }]}
        onLayout={onLayout}
        testID="ride-closing-card"
        accessibilityLabel={isDriver ? "Fim da corrida do motorista" : "Fim da corrida do passageiro"}
      >
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {stage === "air" ? renderAirStage() : null}
          {stage === "rate" ? renderRateStage() : null}
          {stage === "details" ? renderDetailsStage() : null}
        </ScrollView>
      </RobotaxiLifecycleCard>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border.subtle,
    marginVertical: 12,
  },
  prompt: {
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text.primary,
  },
  lowRatingPrompt: {
    marginTop: 12,
  },
  stars: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  star: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  tag: {
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
  },
  tagActive: {
    borderColor: color.border.strong,
    backgroundColor: color.surface.activeSoft,
  },
  tagText: {
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
    color: color.text.secondary,
  },
  tagTextActive: {
    color: color.text.primary,
  },
  input: {
    ...leafTypography.regular,
    minHeight: 48,
    maxHeight: 96,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    borderRadius: 12,
    backgroundColor: "#F5F5F5",
    fontSize: 15,
    lineHeight: 20,
    color: color.text.primary,
    textAlignVertical: "top",
  },
  errorText: {
    ...leafTypography.regular,
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: color.feedback.danger,
  },
  linkButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  linkText: {
    ...leafTypography.medium,
    fontSize: 14,
    color: color.text.secondary,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  action: {
    flex: 1,
  },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  detailsAmount: {
    flex: 1,
  },
  detailsDate: {
    ...leafTypography.regular,
    paddingBottom: 6,
    fontSize: 13,
    lineHeight: 18,
    color: color.text.secondary,
    textAlign: "right",
  },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 28,
  },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.text.primary,
  },
  stopSquare: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: color.text.primary,
  },
  stopText: {
    ...leafTypography.medium,
    flex: 1,
    fontSize: 15,
    color: color.text.primary,
  },
  valueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 28,
    alignItems: "center",
  },
  valueLabel: {
    ...leafTypography.regular,
    flexShrink: 1,
    fontSize: 15,
    color: color.text.primary,
  },
  valueAmount: {
    ...leafTypography.semiBold,
    fontSize: 15,
    color: color.text.primary,
    fontVariant: ["tabular-nums"],
  },
});
