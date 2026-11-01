import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import leafTypography from '../../../components/prototype/LeafTypography';
import LeafTouchable from '../../../components/design-system/LeafTouchable';
import { LEAF_MOTION_BEZIER, LEAF_MOTION_DURATION } from '../../../components/design-system/leafMotion';
import { robotaxiPrototypeTokens } from '../../../components/design-system/robotaxiPrototypeTokens';
import { formatCents } from '../../../config/driverFeePolicy';
import { buildDriverPromoTimeline, buildOdometerColumns } from './driverPromoCelebration';

const LIME = robotaxiPrototypeTokens.color.brand.lime;
const NIGHT = robotaxiPrototypeTokens.color.accent.dark;
const PAPER = robotaxiPrototypeTokens.colorDark.text.primary;
const NIGHT_SOFT = robotaxiPrototypeTokens.colorDark.surface.activeSoft;
const LIME_SOFT = robotaxiPrototypeTokens.colorDark.accent.strong;

const CARD_HEIGHT = 310;
const CARD_HEIGHT_WITH_TOLL = 350;
const DIGIT_HEIGHT = 76;
const LABEL_HEIGHT = 24;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const REEL_DURATION_MS = 1000;
const REEL_STAGGER_MS = 80;
const WIPE_DURATION_MS = LEAF_MOTION_DURATION.milestone;
const FILL_DURATION_MS = 2500;
const calm = Easing.bezier(...LEAF_MOTION_BEZIER);

function OdometerColumn({ column, order, reduceMotion, inkStyle, fontSize }) {
  const offset = useSharedValue(0);

  useEffect(() => {
    const target = -DIGIT_HEIGHT * column.digit;
    offset.value = reduceMotion
      ? target
      : withDelay(order * REEL_STAGGER_MS, withTiming(target, { duration: REEL_DURATION_MS, easing: calm }));
  }, [column.digit, offset, order, reduceMotion]);

  const reelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return (
    <View style={[styles.column, column.hidden && styles.hidden]}>
      <Animated.View style={reelStyle}>
        {DIGITS.map((digit) => (
          <Animated.Text key={digit} allowFontScaling={false} style={[styles.digit, { fontSize }, inkStyle]}>
            {digit}
          </Animated.Text>
        ))}
      </Animated.View>
    </View>
  );
}

// Card que conta a corrida antes do recibo: valor pago, taxa e o que ficou com o
// motorista. Com pedágio, ele soma o repasse primeiro para a conta ficar à vista.
export default function DriverPromoCelebrationCard({ celebration, bottomOffset = 24, onFinish }) {
  const reduceMotion = useReducedMotion();
  const { paidCents, tollCents, feeCents, netCents } = celebration;
  const hasToll = tollCents > 0;
  const timeline = useMemo(() => buildDriverPromoTimeline(celebration), [celebration]);
  const lastStep = timeline.steps[timeline.steps.length - 1];
  const [stepIndex, setStepIndex] = useState(reduceMotion ? timeline.steps.length - 1 : -1);
  const [buttonVisible, setButtonVisible] = useState(reduceMotion);
  const finishedRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const entrance = useSharedValue(reduceMotion ? 1 : 0);
  const turn = useSharedValue(reduceMotion ? 1 : 0);
  const wipe = useSharedValue(reduceMotion ? 1 : 0);
  const labelOffset = useSharedValue(reduceMotion ? -LABEL_HEIGHT * lastStep.labelIndex : 0);
  const fill = useSharedValue(0);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishRef.current?.();
  };

  useEffect(() => {
    const timers = [];
    if (!reduceMotion) {
      entrance.value = withTiming(1, { duration: LEAF_MOTION_DURATION.enter, easing: calm });
      timeline.steps.forEach((step, index) => {
        timers.push(setTimeout(() => setStepIndex(index), step.atMs));
      });
      timers.push(setTimeout(() => setButtonVisible(true), timeline.buttonAtMs));
    }
    const fillStartMs = reduceMotion ? 0 : timeline.finishAtMs - FILL_DURATION_MS;
    fill.value = withDelay(fillStartMs, withTiming(1, { duration: FILL_DURATION_MS, easing: Easing.linear }));
    timers.push(setTimeout(finish, reduceMotion ? FILL_DURATION_MS : timeline.finishAtMs));
    return () => timers.forEach(clearTimeout);
    // A linha do tempo é fixa enquanto o card existe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reached = timeline.steps.slice(0, stepIndex + 1);
  const valueCents = reached.reduce((value, step) => step.valueCents ?? value, 0);
  const labelIndex = reached.reduce((value, step) => step.labelIndex ?? value, 0);
  const showToll = reached.some((step) => step.showToll) || (reduceMotion && hasToll);
  const showFee = reached.some((step) => step.showFee);
  const turned = reached.some((step) => step.turned);

  useEffect(() => {
    if (reduceMotion) return;
    labelOffset.value = withTiming(-LABEL_HEIGHT * labelIndex, { duration: LEAF_MOTION_DURATION.enter, easing: calm });
  }, [labelIndex, labelOffset, reduceMotion]);

  useEffect(() => {
    if (!turned || reduceMotion) return;
    wipe.value = withTiming(1, { duration: WIPE_DURATION_MS, easing: calm });
    turn.value = withTiming(1, { duration: LEAF_MOTION_DURATION.enter });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [reduceMotion, turn, turned, wipe]);

  const cardHeight = hasToll ? CARD_HEIGHT_WITH_TOLL : CARD_HEIGHT;
  const widestCents = Math.max(paidCents, netCents);
  const columns = buildOdometerColumns(valueCents, widestCents);
  const digitFontSize = columns.length > 5 ? 54 : 66;

  const cardStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * 48 }],
  }));
  const wipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - wipe.value) * cardHeight }],
  }));
  const inkStyle = useAnimatedStyle(() => ({
    color: interpolateColor(turn.value, [0, 1], [PAPER, NIGHT]),
  }));
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(turn.value, [0, 1], [NIGHT_SOFT, NIGHT]),
  }));
  const pillTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(turn.value, [0, 1], [LIME_SOFT, LIME]),
  }));
  const labelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: labelOffset.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <Animated.View
      testID="driver-promo-celebration-card"
      accessibilityLiveRegion="polite"
      style={[styles.card, { bottom: bottomOffset, height: cardHeight }, cardStyle]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wipe, wipeStyle]} />
      <View style={styles.content}>
        <Animated.Text style={[styles.kicker, inkStyle]}>Corrida concluída</Animated.Text>

        <View style={styles.labelWindow}>
          <Animated.View style={labelStyle}>
            {timeline.labels.map((label) => (
              <Animated.Text key={label} style={[styles.label, inkStyle]}>
                {label}
              </Animated.Text>
            ))}
          </Animated.View>
        </View>

        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${timeline.labels[labelIndex]}: ${formatCents(valueCents)}`}
          style={styles.amountRow}
        >
          <Animated.Text style={[styles.currency, inkStyle]}>R$</Animated.Text>
          <View style={styles.odometer}>
            {columns.map((column, index) =>
              column.isComma ? (
                <Animated.Text key={column.key} allowFontScaling={false} style={[styles.digit, { fontSize: digitFontSize }, inkStyle]}>
                  ,
                </Animated.Text>
              ) : (
                <OdometerColumn
                  key={column.key}
                  column={column}
                  order={columns.length - index}
                  reduceMotion={reduceMotion}
                  inkStyle={inkStyle}
                  fontSize={digitFontSize}
                />
              ),
            )}
          </View>
        </View>

        <View style={[styles.pills, hasToll && styles.pillsWithToll]}>
          {showToll ? (
            <Animated.View style={[styles.pill, pillStyle]}>
              <Animated.Text style={[styles.pillText, pillTextStyle]}>{`+ ${formatCents(tollCents)} de pedágio`}</Animated.Text>
            </Animated.View>
          ) : null}
          {showFee ? (
            <Animated.View style={[styles.pill, pillStyle]}>
              <Animated.Text style={[styles.pillText, pillTextStyle]}>{`A taxa foi apenas ${formatCents(feeCents)}`}</Animated.Text>
            </Animated.View>
          ) : null}
        </View>

        <View style={[styles.buttonSlot, !buttonVisible && styles.hidden]}>
          <LeafTouchable
            testID="driver-promo-celebration-receipt"
            accessibilityRole="button"
            onPress={finish}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Ver recibo</Text>
            <Animated.View style={[styles.buttonFill, fillStyle]} />
          </LeafTouchable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 60,
    elevation: 12,
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: NIGHT,
  },
  wipe: {
    backgroundColor: LIME,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  kicker: {
    ...leafTypography.semiBold,
    fontSize: 14,
  },
  labelWindow: {
    height: LABEL_HEIGHT,
    marginTop: 14,
    overflow: 'hidden',
  },
  label: {
    ...leafTypography.semiBold,
    height: LABEL_HEIGHT,
    fontSize: 18,
    lineHeight: LABEL_HEIGHT,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  currency: {
    ...leafTypography.semiBold,
    fontSize: 24,
    marginRight: 8,
    paddingBottom: 10,
  },
  odometer: {
    flexDirection: 'row',
    height: DIGIT_HEIGHT,
    overflow: 'hidden',
  },
  column: {
    height: DIGIT_HEIGHT,
    overflow: 'hidden',
  },
  digit: {
    ...leafTypography.bold,
    height: DIGIT_HEIGHT,
    lineHeight: DIGIT_HEIGHT,
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  pills: {
    height: 38,
    marginTop: 10,
    alignItems: 'flex-start',
  },
  pillsWithToll: {
    height: 80,
  },
  pill: {
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  pillText: {
    ...leafTypography.semiBold,
    fontSize: 15,
  },
  buttonSlot: {
    marginTop: 'auto',
  },
  button: {
    height: 48,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: NIGHT,
  },
  buttonText: {
    ...leafTypography.semiBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  buttonFill: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: LIME,
  },
  hidden: {
    opacity: 0,
  },
});
