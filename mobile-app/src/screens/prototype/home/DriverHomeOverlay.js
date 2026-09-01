import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import LeafCampaignCarousel from "../../../components/campaigns/LeafCampaignCarousel";
import robotaxiPrototypeTokens from "../../../components/design-system/robotaxiPrototypeTokens";
import { leafButtonMetrics } from "../../../components/prototype/LeafRideUI";
import { fonts } from "../../../theme/runtimeTokens";

const { color } = robotaxiPrototypeTokens;
const DRIVER_BOTTOM_CTA_OFFSET = 16;
const DRIVER_HOME_CARD_HEIGHT = 236;
const DRIVER_HOME_CARD_HORIZONTAL_INSET = 24;
const DRIVER_HOME_CARD_RADIUS = 32;
const DRIVER_HOME_PROMO_CARD_HEIGHT = 188;
const DRIVER_HOME_STACK_GAP = 12;
const DRIVER_GOAL_STORAGE_PREFIX = "@prototype_driver_daily_goal_";
const DRIVER_DAY_SUMMARY_STORAGE_PREFIX = "@prototype_driver_day_summary_seen_";
const DEFAULT_DAILY_GOAL = 200;
const COMPETITOR_REFERENCE_TAKE_RATE = 0.3;
const DRIVER_ONLINE_WARNING_MS = 10 * 60 * 60 * 1000;
const DRIVER_ONLINE_LIMIT_MS = 12 * 60 * 60 * 1000;
const DRIVER_DAY_SUMMARY_WINDOW_HOUR = 23;
const DRIVER_DAY_SUMMARY_WINDOW_MINUTE = 50;
const IS_TEST_ENV = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
const DRIVER_HOME_FALLBACK_CAMPAIGNS = Object.freeze([
  {
    id: "local_driver_leaf_day",
    name: "Leaf motorista",
    template: "home_banner_card",
    content: {
      eyebrow: "Hoje na Leaf",
      title: "Fique online quando estiver pronto",
      body: "Acompanhe seus ganhos, aceite corridas com calma e mantenha sua rotina no controle.",
      backgroundColor: "#FBFCF8",
      imageAlt: "Banner de boas-vindas da Leaf no Rio de Janeiro",
      displayMode: "text_overlay",
      hideTextOverlay: false,
      cta: { label: "Começar", action: "driver_go_online" },
    },
    rules: { autoRotateSeconds: 6 },
  },
]);
const DRIVER_HOME_COLOR = {
  sheet: "#FFFFFF",
  sheetSoft: "#FFFFFF",
  text: "#171412",
  secondary: "#756F68",
  muted: "#827B73",
  line: "#E9E2D8",
  leaf: "#1A330E",
  leafLight: "#F1F5EE",
  blue: "#F2F4EF",
  blueText: "#514B45",
  warning: "#F8F6F1",
  warningText: "#7A6337",
};

function parseMoneyLabel(value) {
  const cleaned = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!cleaned) {
    return 0;
  }
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatCurrencyBR(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  return `R$ ${safeValue.toFixed(2).replace(".", ",")}`;
}

function roundMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(2));
}

function resolveTimestampMs(value) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getLocalDayKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isNearEndOfLocalDay(nowMs = Date.now()) {
  const date = new Date(nowMs);
  return (
    date.getHours() === DRIVER_DAY_SUMMARY_WINDOW_HOUR &&
    date.getMinutes() >= DRIVER_DAY_SUMMARY_WINDOW_MINUTE
  );
}

function msUntilNextDaySummaryWindow(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const target = new Date(nowMs);
  target.setHours(
    DRIVER_DAY_SUMMARY_WINDOW_HOUR,
    DRIVER_DAY_SUMMARY_WINDOW_MINUTE,
    0,
    0,
  );

  if (target.getTime() <= nowMs) {
    target.setDate(target.getDate() + 1);
  }

  return Math.max(1000, target.getTime() - now.getTime());
}

function hasDriverOnlineActivityForCurrentDay({
  driverOnline,
  driverOnlineStartedAt,
  driverOnlineDaily,
  nowMs = Date.now(),
}) {
  if (driverOnline) {
    return true;
  }

  const daily = driverOnlineDaily && typeof driverOnlineDaily === "object"
    ? driverOnlineDaily
    : null;
  const effectiveMs = Number(daily?.effectiveMs);
  const totalMs = Number(daily?.totalMs);
  const sessionStartedAtMs = Number(daily?.sessionStartedAtMs);
  if (
    (Number.isFinite(effectiveMs) && effectiveMs > 0) ||
    (Number.isFinite(totalMs) && totalMs > 0) ||
    (Number.isFinite(sessionStartedAtMs) && sessionStartedAtMs > 0)
  ) {
    return true;
  }

  const startedAtMs = resolveTimestampMs(driverOnlineStartedAt);
  return Boolean(startedAtMs && getLocalDayKey(startedAtMs) === getLocalDayKey(nowMs));
}

function shouldShowDriverDaySummaryNow({
  driverOnline,
  driverOnlineStartedAt,
  driverOnlineDaily,
  nowMs = Date.now(),
}) {
  return (
    isNearEndOfLocalDay(nowMs) &&
    hasDriverOnlineActivityForCurrentDay({
      driverOnline,
      driverOnlineStartedAt,
      driverOnlineDaily,
      nowMs,
    })
  );
}

function formatOnlineDurationMs(durationMs) {
  const elapsedMinutes = Math.max(0, Math.floor((Number(durationMs) || 0) / 60000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;

  if (hours <= 0) {
    return `${minutes}min`;
  }

  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function resolveDriverOnlineDailyDisplay({
  driverOnline,
  driverOnlineStartedAt,
  driverOnlineDaily,
  fallbackStartedAtMs,
  nowMs,
}) {
  const daily = driverOnlineDaily && typeof driverOnlineDaily === "object"
    ? driverOnlineDaily
    : null;
  const dailyTotalMs = Number(daily?.totalMs);
  const dailySessionStartedAtMs = Number(daily?.sessionStartedAtMs);
  const warningMs = Number(daily?.warningMs);
  const limitMs = Number(daily?.limitMs);

  if (daily) {
    const baseTotalMs = Number.isFinite(dailyTotalMs) && dailyTotalMs > 0
      ? dailyTotalMs
      : 0;
    const sessionElapsedMs =
      driverOnline &&
      Number.isFinite(dailySessionStartedAtMs) &&
      dailySessionStartedAtMs > 0
        ? Math.max(0, nowMs - dailySessionStartedAtMs)
        : 0;
    const effectiveMs = Math.max(
      0,
      baseTotalMs + sessionElapsedMs,
      Number(daily.effectiveMs) || 0,
    );
    const resolvedWarningMs =
      Number.isFinite(warningMs) && warningMs > 0
        ? warningMs
        : DRIVER_ONLINE_WARNING_MS;
    const resolvedLimitMs =
      Number.isFinite(limitMs) && limitMs > 0
        ? limitMs
        : DRIVER_ONLINE_LIMIT_MS;

    return {
      label: formatOnlineDurationMs(effectiveMs),
      nearLimit: effectiveMs >= resolvedWarningMs || daily.nearLimit === true,
      limitReached: effectiveMs >= resolvedLimitMs || daily.limitReached === true,
    };
  }

  if (!driverOnline) {
    return {
      label: "--",
      nearLimit: false,
      limitReached: false,
    };
  }

  const startedAtMs = fallbackStartedAtMs || resolveTimestampMs(driverOnlineStartedAt);
  const elapsedMs = startedAtMs ? Math.max(0, nowMs - startedAtMs) : 0;
  return {
    label: startedAtMs ? formatOnlineDurationMs(elapsedMs) : "--",
    nearLimit: elapsedMs >= DRIVER_ONLINE_WARNING_MS,
    limitReached: elapsedMs >= DRIVER_ONLINE_LIMIT_MS,
  };
}

function parseTripDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = new Date(value > 1000000000000 ? value : value * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const directDate = new Date(text);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const match = text.match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText] = match;
  const today = new Date();
  const year = yearText
    ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
    : today.getFullYear();
  const parsed = new Date(year, Number(monthText) - 1, Number(dayText));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function resolveTripNetAmount(item = {}) {
  const explicitNet = Number(item?.driverNetAmount ?? item?.netAmount);
  if (Number.isFinite(explicitNet)) {
    return Math.max(0, explicitNet);
  }

  const gross = Number(
    item?.grossAmount ??
      item?.finalFare ??
      item?.fare ??
      item?.amount ??
      parseMoneyLabel(item?.value),
  );
  const fees = Number(item?.totalFees ?? item?.feeAmount);
  if (Number.isFinite(gross) && Number.isFinite(fees)) {
    return Math.max(0, gross - fees);
  }

  return 0;
}

function resolveGoalStreakDays(history = [], dailyGoal = DEFAULT_DAILY_GOAL, todayNet = 0) {
  const target = Number(dailyGoal) || DEFAULT_DAILY_GOAL;
  if (!Number.isFinite(target) || target <= 0) {
    return 0;
  }

  const buckets = new Map();
  const today = new Date();
  const todayKey = toDateKey(today);

  buckets.set(todayKey, roundMoney(Number(todayNet) || 0));

  (Array.isArray(history) ? history : []).forEach((item) => {
    const parsedDate =
      parseTripDate(item?.completedAt) ||
      parseTripDate(item?.createdAt) ||
      parseTripDate(item?.updatedAt) ||
      parseTripDate(item?.date);
    const key = toDateKey(parsedDate);
    if (!key) {
      return;
    }
    if (key === todayKey && Number(todayNet) > 0) {
      return;
    }
    buckets.set(key, roundMoney((buckets.get(key) || 0) + resolveTripNetAmount(item)));
  });

  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let index = 0; index < 60; index += 1) {
    const key = toDateKey(cursor);
    if ((buckets.get(key) || 0) < target) {
      break;
    }
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
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

function isDriverWorkLocked(value) {
  return Boolean(value);
}

function resolveBlockedActivationLabel(remoteActivation) {
  const activationState = String(
    remoteActivation?.activationState || remoteActivation?.state || "",
  )
    .trim()
    .toUpperCase();
  const hasFailedDocument = Object.values(
    remoteActivation?.documents || {},
  ).some((document) =>
    ["failed", "rejected", "denied"].includes(
      String(document?.status || "").trim().toLowerCase(),
    ),
  );

  if (
    hasFailedDocument ||
    ["REJECTED", "SUSPENDED", "BLOCKED"].includes(activationState)
  ) {
    return "Ação necessária";
  }

  return "Em análise";
}

export function isDriverIdentitySupportRequired(remoteActivation) {
  const activationState = String(
    remoteActivation?.activationState || remoteActivation?.state || "",
  )
    .trim()
    .toUpperCase();
  const kycStatus = String(remoteActivation?.kyc?.status || "")
    .trim()
    .toLowerCase();
  const kycBlocked =
    remoteActivation?.kyc?.blocked === true ||
    ["blocked", "rejected", "failed", "denied"].includes(kycStatus);
  const blockingReason = String(remoteActivation?.blockingReason || "")
    .trim()
    .toUpperCase();
  const hasFailedDocument = Object.values(
    remoteActivation?.documents || {},
  ).some((document) =>
    ["failed", "rejected", "denied"].includes(
      String(document?.status || "").trim().toLowerCase(),
    ),
  );
  const canonicalIdentityRejection =
    activationState === "REJECTED" &&
    blockingReason.includes("KYC") &&
    !hasFailedDocument;

  return (
    canonicalIdentityRejection ||
    (
      kycBlocked &&
      ["REJECTED", "SUSPENDED", "BLOCKED"].includes(activationState)
    )
  );
}

function DriverHomeOverlay({
  driverId = "",
  insetsBottom = 0,
  driverOnline = false,
  driverOnlinePending = false,
  driverOnlineStartedAt = null,
  driverOnlineDaily = null,
  driverRealtimeAuthenticated = true,
  driverCanGoOnline = false,
  driverActivationResolved = false,
  driverActivationRemote = null,
  driverIdentitySupportRequired = false,
  driverWorkInProgress = false,
  suppressDaySummary = false,
  ridesCount = 0,
  formattedDriverEarnings = "R$ 0,00",
  driverGrossAmount = 0,
  driverFeeAmount = 0,
  driverFinancialHistory = [],
  driverDestinationMode = null,
  onToggleOnline,
  onOpenActivation,
  onOpenIdentitySupport,
  onOpenEarnings,
  onSaveDestinationMode,
  onCtaLayout,
}) {
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);
  const [destinationInput, setDestinationInput] = useState("");
  const [destinationModeEnabled, setDestinationModeEnabled] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [daySummaryVisible, setDaySummaryVisible] = useState(false);
  const [onlineClockTick, setOnlineClockTick] = useState(Date.now());
  const [displayedEarningsAmount, setDisplayedEarningsAmount] = useState(
    parseMoneyLabel(formattedDriverEarnings),
  );
  const [displayedGoalRatio, setDisplayedGoalRatio] = useState(
    Math.min(1, parseMoneyLabel(formattedDriverEarnings) / DEFAULT_DAILY_GOAL),
  );
  const onlineStartedAtRef = useRef(null);
  const hasDriverWorkInProgress = isDriverWorkLocked(driverWorkInProgress);
  const identitySupportRequired =
    driverIdentitySupportRequired === true ||
    isDriverIdentitySupportRequired(driverActivationRemote);
  const driverCanAttemptOnline =
    driverActivationRemote?.canAttemptOnline === true;
  const isReadyForIdentityGate =
    driverActivationResolved &&
    !identitySupportRequired &&
    !driverCanGoOnline &&
    driverCanAttemptOnline &&
    !driverOnline &&
    !hasDriverWorkInProgress;
  const shouldShowWelcomePromo = !hasDriverWorkInProgress &&
    !hasDriverOnlineActivityForCurrentDay({
      driverOnline,
      driverOnlineStartedAt,
      driverOnlineDaily,
      nowMs: onlineClockTick,
    }) &&
    Number(ridesCount || 0) <= 0;
  const earningsAnimation = useRef(
    new Animated.Value(parseMoneyLabel(formattedDriverEarnings)),
  ).current;
  const goalProgressAnimation = useRef(
    new Animated.Value(
      Math.min(1, parseMoneyLabel(formattedDriverEarnings) / DEFAULT_DAILY_GOAL),
    ),
  ).current;
  const isActivationBlocked =
    driverActivationResolved &&
    !driverCanGoOnline &&
    !driverCanAttemptOnline &&
    !driverOnline &&
    !hasDriverWorkInProgress;
  const pendingOfflineActivation =
    driverOnlinePending && !driverOnline && !hasDriverWorkInProgress;
  const pendingOnlineRealtime =
    driverOnline && !driverRealtimeAuthenticated && !hasDriverWorkInProgress;
  const handleSliderPress = hasDriverWorkInProgress
    ? undefined
    : identitySupportRequired
      ? onOpenIdentitySupport
      : isActivationBlocked
      ? onOpenActivation
      : onToggleOnline;
  const sliderStatus = hasDriverWorkInProgress
    ? "ride"
    : identitySupportRequired
    ? "identity-support"
    : isActivationBlocked
    ? "blocked"
    : pendingOfflineActivation || pendingOnlineRealtime
      ? "pending"
      : driverOnline
        ? "online"
        : isReadyForIdentityGate
          ? "ready"
        : "offline";
  const sliderLabel = hasDriverWorkInProgress
    ? "Em corrida"
    : identitySupportRequired
    ? "Falar com suporte"
    : isActivationBlocked
    ? resolveBlockedActivationLabel(driverActivationRemote)
    : pendingOfflineActivation || pendingOnlineRealtime
      ? pendingOnlineRealtime
        ? "Reconectando"
        : "Ativando..."
    : driverOnline
      ? "Online"
      : "Ficar online";
  const goalStorageKey = useMemo(
    () =>
      `${DRIVER_GOAL_STORAGE_PREFIX}${String(driverId || "anonymous").trim() || "anonymous"}`,
    [driverId],
  );
  const daySummaryStorageKey = useMemo(
    () =>
      `${DRIVER_DAY_SUMMARY_STORAGE_PREFIX}${String(driverId || "anonymous").trim() || "anonymous"}`,
    [driverId],
  );
  const currentGoalAmount = parseMoneyLabel(formattedDriverEarnings);
  const currentGoalProgressLabel = formatCurrencyBR(displayedEarningsAmount);
  const goalTargetLabel = String(
    Math.max(0, Math.round(Number(dailyGoal) || DEFAULT_DAILY_GOAL)),
  );
  const goalProgressRatio = Math.min(
    1,
    Math.max(0, currentGoalAmount / (Number(dailyGoal) || DEFAULT_DAILY_GOAL)),
  );
  const goalProgressPercent = `${Math.round(displayedGoalRatio * 100)}%`;
  const onlineDurationStartedAt =
    onlineStartedAtRef.current || resolveTimestampMs(driverOnlineStartedAt);
  const onlineDurationDisplay = resolveDriverOnlineDailyDisplay({
    driverOnline,
    driverOnlineStartedAt,
    driverOnlineDaily,
    fallbackStartedAtMs: onlineDurationStartedAt,
    nowMs: onlineClockTick,
  });
  const onlineDurationLabel = onlineDurationDisplay.label;
  const resolvedOnlineDurationLabel =
    pendingOnlineRealtime && !driverOnlineDaily ? "--" : onlineDurationLabel;
  const onlineLimitHintVisible =
    driverOnline &&
    (onlineDurationDisplay.nearLimit || onlineDurationDisplay.limitReached);
  const safeDriverGrossAmount =
    Number.isFinite(Number(driverGrossAmount)) && Number(driverGrossAmount) > 0
      ? Number(driverGrossAmount)
      : currentGoalAmount + Math.max(0, Number(driverFeeAmount) || 0);
  const safeDriverFeeAmount =
    Number.isFinite(Number(driverFeeAmount)) && Number(driverFeeAmount) >= 0
      ? Number(driverFeeAmount)
      : Math.max(0, safeDriverGrossAmount - currentGoalAmount);
  const competitorEstimatedNet = roundMoney(
    safeDriverGrossAmount * (1 - COMPETITOR_REFERENCE_TAKE_RATE),
  );
  const leafAdvantage = roundMoney(currentGoalAmount - competitorEstimatedNet);
  const goalStreakDays = resolveGoalStreakDays(
    driverFinancialHistory,
    dailyGoal,
    currentGoalAmount,
  );
  const summaryHeadline =
    currentGoalAmount >= Number(dailyGoal || DEFAULT_DAILY_GOAL)
      ? "Meta batida hoje"
      : "Dia salvo";
  const destinationModeLabel =
    String(
      driverDestinationMode?.destinationName ||
        driverDestinationMode?.destination?.name ||
        driverDestinationMode?.destinationAddress ||
        driverDestinationMode?.destination?.address ||
        "",
    ).trim();
  const hasActiveDestinationMode =
    driverDestinationMode?.active === true && Boolean(destinationModeLabel);
  const sliderProgress = useRef(
    new Animated.Value(driverOnline && !isActivationBlocked ? 1 : 0),
  ).current;
  const sliderTravel = Math.max(0, sliderWidth - 58);
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
    if (IS_TEST_ENV) {
      sliderProgress.setValue(driverOnline && !isActivationBlocked ? 1 : 0);
      return undefined;
    }

    Animated.timing(sliderProgress, {
      toValue: driverOnline && !isActivationBlocked ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [driverOnline, isActivationBlocked, sliderProgress]);

  useEffect(() => {
    const animationId = earningsAnimation.addListener(({ value }) => {
      setDisplayedEarningsAmount(roundMoney(value));
    });

    return () => {
      earningsAnimation.removeListener(animationId);
    };
  }, [earningsAnimation]);

  useEffect(() => {
    const animationId = goalProgressAnimation.addListener(({ value }) => {
      setDisplayedGoalRatio(Math.min(1, Math.max(0, Number(value) || 0)));
    });

    return () => {
      goalProgressAnimation.removeListener(animationId);
    };
  }, [goalProgressAnimation]);

  useEffect(() => {
    if (IS_TEST_ENV) {
      earningsAnimation.setValue(currentGoalAmount);
      goalProgressAnimation.setValue(goalProgressRatio);
      setDisplayedEarningsAmount(roundMoney(currentGoalAmount));
      setDisplayedGoalRatio(goalProgressRatio);
      return undefined;
    }

    Animated.parallel([
      Animated.timing(earningsAnimation, {
        toValue: currentGoalAmount,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(goalProgressAnimation, {
        toValue: goalProgressRatio,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [
    currentGoalAmount,
    earningsAnimation,
    goalProgressAnimation,
    goalProgressRatio,
  ]);

  useEffect(() => {
    const shouldSuppressSummary =
      Boolean(suppressDaySummary) || hasDriverWorkInProgress;
    let cancelled = false;
    let timerId = null;

    if (shouldSuppressSummary) {
      setDaySummaryVisible(false);
      return undefined;
    }

    const evaluateDaySummaryWindow = async () => {
      const nowMs = Date.now();
      if (
        shouldShowDriverDaySummaryNow({
          driverOnline,
          driverOnlineStartedAt,
          driverOnlineDaily,
          nowMs,
        })
      ) {
        const todayKey = getLocalDayKey(nowMs);
        const storedDayKey = await AsyncStorage.getItem(daySummaryStorageKey);
        if (!cancelled && storedDayKey !== todayKey) {
          await AsyncStorage.setItem(daySummaryStorageKey, todayKey);
          if (!cancelled) {
            setDaySummaryVisible(true);
          }
        }
      }

      if (!cancelled) {
        timerId = setTimeout(
          evaluateDaySummaryWindow,
          msUntilNextDaySummaryWindow(Date.now()),
        );
      }
    };

    evaluateDaySummaryWindow();

    return () => {
      cancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [
    daySummaryStorageKey,
    driverOnline,
    driverOnlineDaily,
    driverOnlineStartedAt,
    hasDriverWorkInProgress,
    suppressDaySummary,
  ]);

  useEffect(() => {
    if (!driverOnline) {
      onlineStartedAtRef.current = null;
      setOnlineClockTick(Date.now());
      return undefined;
    }

    const resolvedStartedAt = resolveTimestampMs(driverOnlineStartedAt);
    onlineStartedAtRef.current =
      resolvedStartedAt || onlineStartedAtRef.current || Date.now();
    setOnlineClockTick(Date.now());

    const interval = setInterval(() => {
      setOnlineClockTick(Date.now());
    }, 60000);

    return () => clearInterval(interval);
  }, [driverOnline, driverOnlineStartedAt]);

  const handleOpenGoalModal = () => {
    setGoalInput(
      String(Math.max(0, Math.round(Number(dailyGoal) || DEFAULT_DAILY_GOAL))),
    );
    setDestinationInput(destinationModeLabel);
    setDestinationModeEnabled(Boolean(hasActiveDestinationMode));
    setGoalModalVisible(true);
  };

  const handleSavePreferences = async () => {
    const parsed = parseGoalInput(goalInput);
    if (!parsed) {
      Alert.alert("Meus ganhos", "Digite um valor válido para a meta.");
      return;
    }
    if (destinationModeEnabled && String(destinationInput || "").trim().length < 3) {
      Alert.alert(
        "Destino de caminho",
        "Informe o destino para receber corridas no caminho.",
      );
      return;
    }

    setSavingPreferences(true);
    try {
      await AsyncStorage.setItem(goalStorageKey, String(parsed));
      if (typeof onSaveDestinationMode === "function") {
        await onSaveDestinationMode({
          enabled: destinationModeEnabled,
          query: destinationInput,
        });
      }
      setDailyGoal(parsed);
      setGoalModalVisible(false);
    } catch (_error) {
      Alert.alert(
        "Preferências",
        "Não foi possível salvar suas preferências agora.",
      );
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleCloseDaySummary = () => {
    setDaySummaryVisible(false);
  };

  const handleOpenEarningsFromSummary = () => {
    setDaySummaryVisible(false);
    if (typeof onOpenEarnings === "function") {
      onOpenEarnings();
    }
  };

  return (
    <>
      <View
        onLayout={onCtaLayout}
        style={[
          styles.driverHomeStack,
          { bottom: safeBottom + DRIVER_BOTTOM_CTA_OFFSET },
        ]}
      >
        <View style={styles.driverBottomCard}>
          <View style={styles.driverBottomStatsRow}>
            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.earningsBlock}
              onPress={onOpenEarnings || handleOpenGoalModal}
            >
              <View style={styles.driverGoalHeaderRow}>
                <Text style={styles.driverBottomStatLabel}>Meus ganhos</Text>
              </View>
              <View style={styles.driverGoalValueRow}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  style={styles.driverBottomStatValuePrimary}
                >
                  {currentGoalProgressLabel}
                </Text>
                <Text style={styles.driverBottomStatValueSecondary}>
                  {" "}
                  / R$ {goalTargetLabel}
                </Text>
              </View>
              <View style={styles.driverGoalProgressTrack}>
                <View
                  style={[
                    styles.driverGoalProgressFill,
                    { width: goalProgressPercent },
                  ]}
                />
              </View>
              <View style={styles.driverGoalProgressCaptionRow}>
                <Text style={styles.driverGoalProgressCaption}>
                  Progresso da meta
                </Text>
                <Text style={styles.driverGoalProgressPercentText}>
                  {goalProgressPercent}
                </Text>
              </View>
              <View style={styles.driverStreakInline}>
                <Ionicons
                  name="flame-outline"
                  size={13}
                  color={DRIVER_HOME_COLOR.warningText}
                />
                <Text style={styles.driverStreakInlineText} numberOfLines={1}>
                  {goalStreakDays > 0
                    ? `${goalStreakDays} ${goalStreakDays === 1 ? "dia" : "dias"} batendo meta`
                    : "Meta pronta para hoje"}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.driverStatsVerticalDivider} />

            <View style={styles.driverSideStats}>
              <View style={styles.driverSideStatItem}>
                <Text style={styles.driverSideStatValue}>
                  {Math.max(0, Number(ridesCount) || 0)}
                </Text>
                <Text style={styles.driverSideStatLabel}>corridas</Text>
              </View>
              <View style={styles.driverSideStatItem}>
                <Text
                  style={[
                    styles.driverSideStatValue,
                    onlineLimitHintVisible && styles.driverSideStatValueWarning,
                  ]}
                >
                  {resolvedOnlineDurationLabel}
                </Text>
                <Text style={styles.driverSideStatLabel}>online</Text>
                {onlineLimitHintVisible ? (
                  <Text style={styles.driverOnlineLimitHint}>
                    Próximo ao limite
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.driverBottomDivider} />

          <View style={styles.driverBottomActions}>
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={handleSliderPress}
              disabled={hasDriverWorkInProgress}
              testID="driver-home-toggle-online"
              accessibilityRole="button"
              accessibilityLabel={`driver-home-toggle-online-${sliderStatus}`}
              accessibilityHint={
                driverOnline
                  ? "Toca para sair do modo online"
                  : identitySupportRequired
                    ? "Toca para falar com o suporte sobre sua identidade"
                  : isReadyForIdentityGate
                    ? "Toca para confirmar sua identidade e ficar online"
                  : "Toca para ficar online e receber corridas"
              }
              accessibilityValue={{ text: sliderStatus }}
              onLayout={(event) => {
                const nextWidth = event?.nativeEvent?.layout?.width;
                if (Number.isFinite(nextWidth) && nextWidth > 0) {
                  setSliderWidth(nextWidth);
                }
              }}
              style={[
                styles.driverBottomSlider,
                (sliderStatus === "online" || sliderStatus === "ride") &&
                  styles.driverBottomSliderOnline,
                (sliderStatus === "blocked" ||
                  sliderStatus === "identity-support") &&
                  styles.driverBottomSliderBlocked,
                sliderStatus === "pending" && styles.driverBottomSliderPending,
              ]}
            >
              {identitySupportRequired ? (
                <View
                  pointerEvents="none"
                  style={styles.driverBottomSliderReadyContent}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.driverBottomSliderReadyStatus,
                      styles.driverBottomSliderIdentityStatus,
                    ]}
                  >
                    Identidade não confirmada
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.driverBottomSliderText,
                      styles.driverBottomSliderTextBlocked,
                    ]}
                  >
                    Falar com suporte
                  </Text>
                </View>
              ) : isReadyForIdentityGate ? (
                <View
                  pointerEvents="none"
                  style={styles.driverBottomSliderReadyContent}
                >
                  <Text
                    numberOfLines={1}
                    style={styles.driverBottomSliderReadyStatus}
                  >
                    Pronto para ficar online
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={styles.driverBottomSliderText}
                  >
                    Ficar online
                  </Text>
                </View>
              ) : (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  style={[
                    styles.driverBottomSliderText,
                    (sliderStatus === "online" || sliderStatus === "ride") &&
                      styles.driverBottomSliderTextOnline,
                    (sliderStatus === "blocked" ||
                      sliderStatus === "identity-support") &&
                      styles.driverBottomSliderTextBlocked,
                    sliderStatus === "pending" &&
                      styles.driverBottomSliderTextPending,
                  ]}
                >
                  {sliderLabel}
                </Text>
              )}
              <Animated.View
                style={[
                  styles.driverBottomSliderThumb,
                  (sliderStatus === "online" || sliderStatus === "ride") &&
                    styles.driverBottomSliderThumbOnline,
                  (sliderStatus === "blocked" ||
                    sliderStatus === "identity-support") &&
                    styles.driverBottomSliderThumbBlocked,
                  sliderStatus === "pending" && styles.driverBottomSliderThumbPending,
                  { transform: [{ translateX: sliderThumbTranslateX }] },
                ]}
              >
                <Ionicons
                  name={
                    sliderStatus === "online"
                      ? "checkmark"
                      : sliderStatus === "ride"
                        ? "navigate-outline"
                      : sliderStatus === "identity-support"
                        ? "chatbubble-ellipses-outline"
                      : sliderStatus === "blocked"
                        ? "time-outline"
                        : sliderStatus === "pending"
                          ? "ellipsis-horizontal"
                          : "chevron-forward"
                  }
                  size={21}
                  color={
                    sliderStatus === "online" || sliderStatus === "ride"
                      ? DRIVER_HOME_COLOR.leaf
                      : "#FFFFFF"
                  }
                />
              </Animated.View>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={handleOpenGoalModal}
              testID="driver-home-preferences-button"
              accessibilityLabel="driver-home-preferences-button"
              style={styles.driverPreferencesAction}
            >
              <Ionicons
                name="settings-outline"
                size={21}
                color={DRIVER_HOME_COLOR.leaf}
              />
            </TouchableOpacity>
          </View>
        </View>

        {shouldShowWelcomePromo ? (
          <LeafCampaignCarousel
            userId={driverId}
            role="driver"
            surface="driver_home"
            placement="below_home_card"
            limit={3}
            height={DRIVER_HOME_PROMO_CARD_HEIGHT}
            borderRadius={DRIVER_HOME_CARD_RADIUS}
            fallbackCampaigns={DRIVER_HOME_FALLBACK_CAMPAIGNS}
            style={styles.driverPromoCard}
            testID="driver-home-promo-carousel"
          />
        ) : null}
      </View>

      <Modal
        visible={goalModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGoalModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Preferências de trabalho</Text>
            <Text style={styles.modalLabel}>Meta do dia</Text>
            <TextInput
              value={goalInput}
              onChangeText={setGoalInput}
              placeholder="Ex: 250,00"
              keyboardType="numeric"
              style={styles.modalInput}
              placeholderTextColor="rgba(33,41,53,0.45)"
            />
            <TouchableOpacity
              activeOpacity={0.84}
              style={styles.destinationModeRow}
              onPress={() => setDestinationModeEnabled((current) => !current)}
              testID="driver-destination-mode-toggle"
              accessibilityRole="switch"
              accessibilityState={{ checked: destinationModeEnabled }}
            >
              <View style={styles.destinationModeCopy}>
                <Text style={styles.destinationModeTitle}>Destino de caminho</Text>
                <Text style={styles.destinationModeSubtitle}>
                  Use um destino do dia para receber corridas que aproximem você do caminho.
                </Text>
              </View>
              <View
                style={[
                  styles.destinationModeSwitch,
                  destinationModeEnabled && styles.destinationModeSwitchActive,
                ]}
              >
                <View
                  style={[
                    styles.destinationModeSwitchKnob,
                    destinationModeEnabled && styles.destinationModeSwitchKnobActive,
                  ]}
                />
              </View>
            </TouchableOpacity>
            <TextInput
              value={destinationInput}
              onChangeText={setDestinationInput}
              placeholder="Ex: Shopping Leblon"
              editable={destinationModeEnabled}
              style={[
                styles.modalInput,
                !destinationModeEnabled && styles.modalInputDisabled,
              ]}
              placeholderTextColor="rgba(33,41,53,0.45)"
              testID="driver-destination-mode-input"
            />
            {hasActiveDestinationMode ? (
              <Text style={styles.destinationModeActiveHint} numberOfLines={2}>
                Ativo para {destinationModeLabel}. A preferência expira automaticamente.
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.modalGhostButton}
                onPress={() => setGoalModalVisible(false)}
                disabled={savingPreferences}
              >
                <Text style={styles.modalGhostButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.modalPrimaryButton}
                onPress={handleSavePreferences}
                disabled={savingPreferences}
                testID="driver-preferences-save"
              >
                <Text style={styles.modalPrimaryButtonText}>
                  {savingPreferences ? "Salvando..." : "Salvar"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={daySummaryVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseDaySummary}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryHero}>
              <Text style={styles.summaryEyebrow}>Resumo do dia</Text>
              <Text style={styles.summaryTitle}>{summaryHeadline}</Text>
              <Text style={styles.summarySubtitle}>
                Fechamento do dia disponível para acompanhar seus ganhos.
              </Text>
            </View>

            <View style={styles.summaryMetricsRow}>
              <View style={styles.summaryMetric}>
                <Text style={styles.summaryMetricLabel}>Você recebeu</Text>
                <Text style={styles.summaryMetricValue}>
                  {formatCurrencyBR(currentGoalAmount)}
                </Text>
              </View>
              <View style={styles.summaryMetric}>
                <Text style={styles.summaryMetricLabel}>Taxas</Text>
                <Text style={styles.summaryMetricValue}>
                  {formatCurrencyBR(safeDriverFeeAmount)}
                </Text>
              </View>
            </View>

            <View style={styles.summaryComparison}>
              <View style={styles.summaryComparisonIcon}>
                <Ionicons
                  name="swap-vertical-outline"
                  size={18}
                  color={DRIVER_HOME_COLOR.leaf}
                />
              </View>
              <View style={styles.summaryComparisonCopy}>
                <Text style={styles.summaryComparisonTitle}>
                  Comparativo direto
                </Text>
                <Text style={styles.summaryComparisonText}>
                  Em uma plataforma com 30% de comissão, a estimativa seria {formatCurrencyBR(competitorEstimatedNet)}.
                </Text>
                <Text
                  style={[
                    styles.summaryComparisonDelta,
                    leafAdvantage < 0 && styles.summaryComparisonDeltaMuted,
                  ]}
                >
                  {leafAdvantage >= 0
                    ? `Você ficou com ${formatCurrencyBR(leafAdvantage)} a mais.`
                    : `Diferença de ${formatCurrencyBR(Math.abs(leafAdvantage))} para revisar.`}
                </Text>
              </View>
            </View>

            <View style={styles.summaryStreakCard}>
              <View style={styles.summaryStreakBadge}>
                <Text style={styles.summaryStreakNumber}>
                  {goalStreakDays}
                </Text>
              </View>
              <View style={styles.summaryStreakCopy}>
                <Text style={styles.summaryStreakTitle}>
                  Sequência de meta
                </Text>
                <Text style={styles.summaryStreakText}>
                  {goalStreakDays > 0
                    ? "Continue nesse ritmo para manter sua sequência ativa."
                    : "Bata a meta de hoje para iniciar sua sequência."}
                </Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.modalGhostButton}
                onPress={handleOpenEarningsFromSummary}
              >
                <Text style={styles.modalGhostButtonText}>Ver ganhos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.modalPrimaryButton}
                onPress={handleCloseDaySummary}
                testID="driver-day-summary-close"
              >
                <Text style={styles.modalPrimaryButtonText}>Fechar</Text>
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
  driverHomeStack: {
    position: "absolute",
    left: DRIVER_HOME_CARD_HORIZONTAL_INSET,
    right: DRIVER_HOME_CARD_HORIZONTAL_INSET,
    alignSelf: "center",
    zIndex: 16,
  },
  driverBottomCard: {
    minHeight: DRIVER_HOME_CARD_HEIGHT,
    borderRadius: DRIVER_HOME_CARD_RADIUS,
    paddingHorizontal: 28,
    paddingTop: 21,
    paddingBottom: 18,
    backgroundColor: DRIVER_HOME_COLOR.sheetSoft,
    borderWidth: 1,
    borderColor: "#ECE5DC",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.12,
    shadowRadius: 17,
    elevation: Platform.OS === "android" ? 0 : 12,
  },
  driverPromoCard: {
    marginTop: DRIVER_HOME_STACK_GAP,
  },
  driverBottomStatsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 122,
  },
  earningsBlock: {
    flex: 1,
    minHeight: 118,
    justifyContent: "flex-start",
    alignItems: "flex-start",
    paddingRight: 13,
  },
  driverStatsVerticalDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: "#E9E2D8",
    marginLeft: 3,
    marginRight: 13,
  },
  driverSideStats: {
    width: 82,
    minHeight: 118,
    justifyContent: "center",
    alignItems: "stretch",
    gap: 13,
    paddingVertical: 4,
  },
  driverSideStatItem: {
    minHeight: 39,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  driverBottomStatLabel: {
    color: DRIVER_HOME_COLOR.muted,
    fontFamily: fonts.Medium,
    fontSize: 10.5,
    lineHeight: 14,
  },
  driverGoalHeaderRow: {
    width: "100%",
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  driverBottomStatValuePrimary: {
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 26,
    lineHeight: 32,
    marginTop: 0,
    maxWidth: 128,
  },
  driverBottomStatValueSecondary: {
    color: DRIVER_HOME_COLOR.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 20,
    flexShrink: 0,
  },
  driverGoalValueRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "flex-end",
    maxWidth: "100%",
  },
  driverGoalProgressTrack: {
    width: "100%",
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: DRIVER_HOME_COLOR.line,
    marginTop: 8,
  },
  driverGoalProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: DRIVER_HOME_COLOR.leaf,
  },
  driverGoalProgressCaptionRow: {
    marginTop: 5,
    width: "100%",
    minHeight: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  driverGoalProgressCaption: {
    color: DRIVER_HOME_COLOR.secondary,
    fontFamily: fonts.Medium,
    fontSize: 10.5,
    lineHeight: 14,
  },
  driverGoalProgressPercentText: {
    color: DRIVER_HOME_COLOR.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 10.5,
    lineHeight: 14,
  },
  driverStreakInline: {
    marginTop: 8,
    minHeight: 22,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(248,245,239,0.88)",
    borderWidth: 1,
    borderColor: "rgba(233,226,216,0.86)",
  },
  driverStreakInlineText: {
    flexShrink: 1,
    color: DRIVER_HOME_COLOR.warningText,
    fontFamily: fonts.SemiBold,
    fontSize: 10.5,
    lineHeight: 13,
  },
  driverSideStatValue: {
    marginTop: 0,
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
    minWidth: 30,
    textAlign: "left",
  },
  driverSideStatValueWarning: {
    color: DRIVER_HOME_COLOR.warningText,
  },
  driverSideStatLabel: {
    color: DRIVER_HOME_COLOR.muted,
    fontFamily: fonts.Medium,
    fontSize: 10.5,
    lineHeight: 14,
    textAlign: "left",
  },
  driverOnlineLimitHint: {
    marginTop: 1,
    color: DRIVER_HOME_COLOR.warningText,
    fontFamily: fonts.Medium,
    fontSize: 9.5,
    lineHeight: 12,
    textAlign: "left",
  },
  driverBottomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: DRIVER_HOME_COLOR.line,
    marginTop: 6,
    marginBottom: 15,
  },
  driverBottomActions: {
    marginTop: 0,
    flexDirection: "row",
    gap: 10,
  },
  driverBottomSlider: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E2DAD0",
    backgroundColor: "#F8F6F1",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 64,
  },
  driverBottomSliderOnline: {
    backgroundColor: DRIVER_HOME_COLOR.leaf,
    borderColor: DRIVER_HOME_COLOR.leaf,
  },
  driverBottomSliderBlocked: {
    backgroundColor: "rgba(243,241,234,0.96)",
    borderColor: "#DDD3BE",
  },
  driverBottomSliderPending: {
    backgroundColor: "rgba(239,244,243,0.96)",
    borderColor: "#D3DFDD",
  },
  driverBottomSliderText: {
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: "center",
  },
  driverBottomSliderReadyContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  driverBottomSliderReadyStatus: {
    color: DRIVER_HOME_COLOR.leaf,
    fontFamily: fonts.Medium,
    fontSize: 10.5,
    lineHeight: 13,
    textAlign: "center",
  },
  driverBottomSliderIdentityStatus: {
    color: DRIVER_HOME_COLOR.warningText,
  },
  driverBottomSliderTextOnline: {
    color: "#FFFFFF",
  },
  driverBottomSliderTextBlocked: {
    color: DRIVER_HOME_COLOR.warningText,
  },
  driverBottomSliderTextPending: {
    color: DRIVER_HOME_COLOR.blueText,
  },
  driverBottomSliderThumb: {
    position: "absolute",
    left: 6,
    top: 5,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DRIVER_HOME_COLOR.text,
    shadowColor: "#0F172A",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  driverBottomSliderThumbOnline: {
    backgroundColor: "#FFFFFF",
  },
  driverBottomSliderThumbBlocked: {
    backgroundColor: DRIVER_HOME_COLOR.warningText,
  },
  driverBottomSliderThumbPending: {
    backgroundColor: DRIVER_HOME_COLOR.blueText,
  },
  driverPreferencesAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E2DAD0",
    backgroundColor: DRIVER_HOME_COLOR.sheet,
    alignItems: "center",
    justifyContent: "center",
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
  summaryCard: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(207,216,205,0.92)",
    backgroundColor: DRIVER_HOME_COLOR.sheet,
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 26,
    elevation: Platform.OS === "android" ? 0 : 14,
  },
  summaryHero: {
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DRIVER_HOME_COLOR.line,
  },
  summaryEyebrow: {
    color: DRIVER_HOME_COLOR.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  summaryTitle: {
    marginTop: 4,
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 24,
    lineHeight: 30,
  },
  summarySubtitle: {
    marginTop: 4,
    color: DRIVER_HOME_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryMetricsRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  summaryMetric: {
    flex: 1,
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: DRIVER_HOME_COLOR.line,
    backgroundColor: DRIVER_HOME_COLOR.leafLight,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: "space-between",
  },
  summaryMetricLabel: {
    color: DRIVER_HOME_COLOR.muted,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  summaryMetricValue: {
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  summaryComparison: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: DRIVER_HOME_COLOR.line,
    backgroundColor: DRIVER_HOME_COLOR.sheet,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 10,
  },
  summaryComparisonIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DRIVER_HOME_COLOR.leafLight,
  },
  summaryComparisonCopy: {
    flex: 1,
    minWidth: 0,
  },
  summaryComparisonTitle: {
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryComparisonText: {
    marginTop: 3,
    color: DRIVER_HOME_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  summaryComparisonDelta: {
    marginTop: 5,
    color: DRIVER_HOME_COLOR.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  summaryComparisonDeltaMuted: {
    color: DRIVER_HOME_COLOR.warningText,
  },
  summaryStreakCard: {
    marginTop: 12,
    minHeight: 68,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(236,220,199,0.96)",
    backgroundColor: "rgba(248,245,239,0.82)",
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryStreakBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DRIVER_HOME_COLOR.text,
  },
  summaryStreakNumber: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  summaryStreakCopy: {
    flex: 1,
    minWidth: 0,
  },
  summaryStreakTitle: {
    color: DRIVER_HOME_COLOR.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryStreakText: {
    marginTop: 2,
    color: DRIVER_HOME_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  modalTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  modalLabel: {
    marginTop: 14,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  modalInput: {
    marginTop: 8,
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
  modalInputDisabled: {
    opacity: 0.54,
  },
  destinationModeRow: {
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.subtle,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  destinationModeCopy: {
    flex: 1,
    minWidth: 0,
  },
  destinationModeTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  destinationModeSubtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  destinationModeActiveHint: {
    marginTop: 8,
    color: DRIVER_HOME_COLOR.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  destinationModeSwitch: {
    width: 42,
    height: 24,
    borderRadius: 12,
    padding: 3,
    backgroundColor: "#E9E2D8",
  },
  destinationModeSwitchActive: {
    backgroundColor: DRIVER_HOME_COLOR.leaf,
  },
  destinationModeSwitchKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },
  destinationModeSwitchKnobActive: {
    transform: [{ translateX: 18 }],
  },
  modalActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  modalGhostButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
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
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
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
