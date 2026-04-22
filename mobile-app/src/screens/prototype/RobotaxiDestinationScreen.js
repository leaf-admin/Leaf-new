import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { Easing, FadeIn } from "react-native-reanimated";
import { useSelector } from "react-redux";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import PrototypeConnectionStatusPill from "../../components/prototype/PrototypeConnectionStatusPill";
import {
  CardHandle,
  DestinationInput,
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../components/prototype/PrototypeUI";
import WooviPaymentModal from "../../components/payment/WooviPaymentModal";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { isE2ETestBuild } from "../../config/runtimeAccessPolicy";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolvePassengerAutoRoute } from "./passengerFlowRouting";
import { resolveDestinationAutomationConfig } from "./destinationAutomationConfig";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import WebSocketManager from "../../services/WebSocketManager";
import {
  buildPrototypeConnectionIndicatorModel,
  resolvePrototypeConnectionAutomationConfig,
  shouldRunPrototypeConnectionAutomation,
} from "./prototypeConnectionStatus";

const { color, typography, touch, motion } = robotaxiPrototypeTokens;
const SEARCH_STEP = "search";
const QUOTE_STEP = "quote";
const SEARCH_RESULT_LIMIT = 3;
const SEARCH_BOTTOM_OFFSET = 116;
const SHEET_MIN_BOTTOM_MARGIN = 10;
const SEARCH_KEYBOARD_CLEARANCE = 64;
const SEARCH_FALLBACK_HEIGHT = 308;
const QUOTE_FALLBACK_HEIGHT = 500;
const PLAN_LIST_VIEWPORT_HEIGHT = 206;
const ORIGIN_ADDRESS = "1540 Mission St, San Francisco";
const stepEasing = Easing.bezier(...motion.bezier.snappy);

if (
  Platform.OS === "android" &&
  typeof UIManager.setLayoutAnimationEnabledExperimental === "function"
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DEFAULT_PLAN_RATE_CARDS = Object.freeze({
  plus: {
    name: "Leaf Plus",
    base_fare: 2.79,
    fixed_fee: 1.1,
    rate_per_hour: 15.6,
    rate_per_unit_distance: 1.53,
    min_fare: 8.5,
  },
  elite: {
    name: "Leaf Elite",
    base_fare: 4.98,
    fixed_fee: 1.8,
    rate_per_hour: 17.4,
    rate_per_unit_distance: 2.41,
    min_fare: 10.5,
  },
  moto: {
    name: "Leaf Moto",
    base_fare: 2.18,
    fixed_fee: 0.86,
    rate_per_hour: 12.17,
    rate_per_unit_distance: 1.19,
    min_fare: 6.9,
  },
});

function getPlanIdFromCarName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  if (normalized.includes("elite") || normalized === "premium") return "elite";
  if (
    normalized.includes("moto") ||
    normalized.includes("motorcycle") ||
    normalized.includes("bike")
  )
    return "moto";
  if (
    normalized.includes("plus") ||
    normalized.includes("standard") ||
    normalized.includes("econ") ||
    normalized === "basic"
  ) {
    return "plus";
  }
  return null;
}

function calculateBusinessFare(distanceKm, durationMin, rateCard) {
  const distance = Number(distanceKm) || 0;
  const durationHours = (Number(durationMin) || 0) / 60;

  const baseFare = Number(rateCard?.base_fare) || 0;
  const fixedFee = Number(rateCard?.fixed_fee) || 0;
  const ratePerKm = Number(rateCard?.rate_per_unit_distance) || 0;
  const ratePerHour = Number(rateCard?.rate_per_hour) || 0;
  const minFare = Number(rateCard?.min_fare) || 0;

  const subtotal =
    baseFare + fixedFee + distance * ratePerKm + durationHours * ratePerHour;
  return Number(Math.max(subtotal, minFare).toFixed(2));
}

function formatCurrency(value) {
  return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RobotaxiDestinationScreen({ navigation, route }) {
  const {
    bookingStatus,
    currentAddress,
    currentCoordinate,
    driverInfo,
    activeRole,
    connecting,
    profileUid,
    riderProfile,
    isSocketAuthenticated,
    isSocketConnected,
    selectedVehicle,
    selectedFare,
    selectedDestination: runtimeSelectedDestination,
    tripDistanceKm: runtimeTripDistanceKm,
    tripDurationMin: runtimeTripDurationMin,
    tripArrivalText: runtimeTripArrivalText,
    loadDestinationSuggestions,
    loadRecentDestinations,
    resolveDestinationInput,
    selectDestination,
    checkRideAvailability,
    requestRide,
    requestTripExtension,
    clearFlowPreview,
  } = usePrototypeRideRuntime();
  const catalogCars = useSelector((state) => state?.cartypes?.cars || []);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [step, setStep] = useState(SEARCH_STEP);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState("plus");
  const [isPixModalVisible, setPixModalVisible] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [checkingPlanAvailability, setCheckingPlanAvailability] =
    useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [planAvailabilityById, setPlanAvailabilityById] = useState({});
  const [submittingRide, setSubmittingRide] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(SEARCH_FALLBACK_HEIGHT);
  const [searchTopAnchor, setSearchTopAnchor] = useState(null);
  const [recentDestinations, setRecentDestinations] = useState([]);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [showRecoveredConnectionHint, setShowRecoveredConnectionHint] =
    useState(false);
  const [qaConnectionVisualState, setQaConnectionVisualState] = useState(null);
  const voiceAutoStartedRef = useRef(false);
  const lastAutoRouteRef = useRef("");
  const destinationInputRef = useRef(null);
  const lastConnectionHealthyRef = useRef(true);
  const connectionRecoveredTimerRef = useRef(null);
  const connectionAutomationExecutionRef = useRef("");
  const connectionAutomationTimersRef = useRef([]);
  const autoStartVoiceRequested =
    route?.params?.autoStartVoice === true ||
    route?.params?.autoStartVoice === "true" ||
    route?.params?.autoStartVoice === "1";
  const isExtensionFlow = route?.params?.mode === "extension";
  const automationConfig = useMemo(
    () =>
      resolveDestinationAutomationConfig(route?.params || {}, {
        isExtensionFlow,
        isDev: __DEV__,
        isE2E: isE2ETestBuild(),
      }),
    [isExtensionFlow, route?.params],
  );
  const qaAutoFlowMode = automationConfig.autoFlowMode;
  const qaAutoSelectFirst = automationConfig.autoSelectFirst;
  const qaAutoOpenPix = automationConfig.autoOpenPix;
  const qaAutoConfirmPix = automationConfig.autoConfirmPix;
  const qaAutomationNonce = automationConfig.nonce;
  const qaPresetQuery = automationConfig.presetQuery;
  const returnRouteName =
    route?.params?.returnRouteName || "RobotaxiPrototypeTrip";
  const qaAutoSelectStartedRef = useRef(false);
  const qaAutoPixOpenedRef = useRef(false);
  const qaAutoPixConfirmedRef = useRef(false);
  const submittingRideGuardRef = useRef(false);
  const lastHandledPaymentChargeIdRef = useRef("");
  const qaPresetQueryAppliedRef = useRef(false);
  const [qaPresetSearchCompleted, setQaPresetSearchCompleted] = useState(
    !automationConfig.presetQuery,
  );
  const passengerAutoRoute = useMemo(
    () => resolvePassengerAutoRoute(bookingStatus),
    [bookingStatus],
  );
  const qaAutomationExecutionKey = useMemo(
    () =>
      [
        automationConfig.automationEnabled ? "1" : "0",
        qaAutoFlowMode || "",
        qaPresetQuery || "",
        qaAutomationNonce || "",
        isExtensionFlow ? "extension" : "request",
      ].join("|"),
    [
      automationConfig.automationEnabled,
      isExtensionFlow,
      qaAutoFlowMode,
      qaAutomationNonce,
      qaPresetQuery,
    ],
  );
  const qaConnectionAutomationConfig = useMemo(
    () =>
      resolvePrototypeConnectionAutomationConfig(route?.params || {}, {
        activeRole: activeRole || "customer",
        isDev: __DEV__,
        isE2E: isE2ETestBuild(),
      }),
    [activeRole, route?.params],
  );
  const connectionIndicatorModel = useMemo(
    () =>
      buildPrototypeConnectionIndicatorModel({
        activeRole: activeRole || "customer",
        bookingStatus: "quote",
        driverOnline: false,
        driverOnlinePending: false,
        connecting,
        isSocketConnected,
        isSocketAuthenticated,
        requiresAuthentication: Boolean(profileUid),
        recentlyRecovered: showRecoveredConnectionHint,
      }),
    [
      activeRole,
      connecting,
      isSocketAuthenticated,
      isSocketConnected,
      profileUid,
      showRecoveredConnectionHint,
    ],
  );
  const effectiveConnectionIndicatorModel = useMemo(() => {
    if (!qaConnectionVisualState?.mode) {
      return connectionIndicatorModel;
    }

    const indicatorBase = {
      activeRole: activeRole || "customer",
      bookingStatus: "quote",
      driverOnline: false,
      driverOnlinePending: false,
      requiresAuthentication: Boolean(profileUid),
      forceVisible: true,
    };

    if (qaConnectionVisualState.mode === "lost") {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: false,
        isSocketConnected: false,
        isSocketAuthenticated: false,
        recentlyRecovered: false,
      });
    }

    if (qaConnectionVisualState.mode === "reconnecting") {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: true,
        isSocketConnected: false,
        isSocketAuthenticated: false,
        recentlyRecovered: false,
      });
    }

    if (qaConnectionVisualState.mode === "recovered") {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: false,
        isSocketConnected: true,
        isSocketAuthenticated: true,
        recentlyRecovered: true,
      });
    }

    return connectionIndicatorModel;
  }, [
    activeRole,
    connectionIndicatorModel,
    profileUid,
    qaConnectionVisualState?.mode,
  ]);
  const connectionIndicatorTopOffset = useMemo(() => insets.top + 14, [insets.top]);
  const searchContextualStrings = useMemo(
    () => [
      ...recentDestinations.map((item) => item?.name).filter(Boolean),
      ...recentDestinations.map((item) => item?.address).filter(Boolean),
      "Leaf Plus",
      "Leaf Elite",
      "Leaf Moto",
    ],
    [recentDestinations],
  );

  useEffect(() => {
    qaAutoSelectStartedRef.current = false;
    qaAutoPixOpenedRef.current = false;
    qaAutoPixConfirmedRef.current = false;
    qaPresetQueryAppliedRef.current = false;
    setQaPresetSearchCompleted(!qaPresetQuery);
  }, [qaAutomationExecutionKey, qaPresetQuery]);

  useEffect(() => {
    let cancelled = false;

    const hydrateRecentDestinations = async () => {
      try {
        const history = await loadRecentDestinations();
        if (cancelled) {
          return;
        }

        const safeHistory = Array.isArray(history)
          ? history.slice(0, SEARCH_RESULT_LIMIT)
          : [];
        setRecentDestinations(safeHistory);
        setResults((current) => (current.length > 0 ? current : safeHistory));
      } catch (_error) {
        if (!cancelled) {
          setRecentDestinations([]);
        }
      }
    };

    hydrateRecentDestinations();

    return () => {
      cancelled = true;
    };
  }, [loadRecentDestinations]);

  useEffect(() => {
    let cancelled = false;

    const executeSearch = async () => {
      const trimmedQuery = query.trim();
      const normalizedTrimmedQuery = trimmedQuery.toLowerCase();
      const normalizedPresetQuery = String(qaPresetQuery || "")
        .trim()
        .toLowerCase();
      const matchesPresetQuery =
        Boolean(normalizedPresetQuery) &&
        normalizedTrimmedQuery === normalizedPresetQuery;
      if (!trimmedQuery) {
        setSearching(false);
        setResults(recentDestinations);
        if (!normalizedPresetQuery) {
          setQaPresetSearchCompleted(true);
        }
        return;
      }

      try {
        setSearching(true);
        const response = await loadDestinationSuggestions(trimmedQuery);
        if (cancelled) {
          return;
        }

        if (Array.isArray(response) && response.length > 0) {
          setResults(response);
        } else {
          setResults([]);
        }
      } catch (error) {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
          if (matchesPresetQuery) {
            setQaPresetSearchCompleted(true);
          }
        }
      }
    };

    const timer = setTimeout(executeSearch, query.trim() ? 240 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadDestinationSuggestions, qaPresetQuery, query, recentDestinations]);

  useEffect(() => {
    if (!qaPresetQuery || qaPresetQueryAppliedRef.current) {
      return;
    }

    qaPresetQueryAppliedRef.current = true;
    setQaPresetSearchCompleted(false);
    setQuery(qaPresetQuery);

    const task = InteractionManager.runAfterInteractions(() => {
      destinationInputRef.current?.focus?.();
    });

    return () => {
      if (typeof task?.cancel === "function") {
        task.cancel();
      }
    };
  }, [qaPresetQuery]);

  useEffect(() => {
    const keyboardShowEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const keyboardHideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const handleKeyboardShow = (event) => {
      const nextKeyboardHeight = Math.max(
        0,
        Number(event?.endCoordinates?.height) || 0,
      );
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(nextKeyboardHeight);
    };

    const handleKeyboardHide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(0);
    };

    const showSubscription = Keyboard.addListener(
      keyboardShowEvent,
      handleKeyboardShow,
    );
    const hideSubscription = Keyboard.addListener(
      keyboardHideEvent,
      handleKeyboardHide,
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (step !== SEARCH_STEP || autoStartVoiceRequested) {
      return undefined;
    }

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      const timer = setTimeout(() => {
        if (!cancelled) {
          destinationInputRef.current?.focus?.();
        }
      }, 140);

      if (cancelled) {
        clearTimeout(timer);
      }
    });

    return () => {
      cancelled = true;
      interaction?.cancel?.();
    };
  }, [autoStartVoiceRequested, step]);

  useEffect(() => {
    const onResult = (event) => {
      const transcript = String(event?.results?.[0]?.transcript || "").trim();
      if (transcript) {
        setQuery(transcript);
        setVoiceError("");
      }

      if (event?.isFinal) {
        setVoiceListening(false);
        setVoiceStarting(false);
      }
    };

    const onStart = () => {
      setVoiceListening(true);
      setVoiceStarting(false);
      setVoiceError("");
    };

    const onEnd = () => {
      setVoiceListening(false);
      setVoiceStarting(false);
    };

    const onError = (event) => {
      const message = String(
        event?.message || "Não foi possível capturar voz agora.",
      );
      setVoiceListening(false);
      setVoiceStarting(false);
      setVoiceError(message);
    };

    const resultSubscription = ExpoSpeechRecognitionModule.addListener(
      "result",
      onResult,
    );
    const startSubscription = ExpoSpeechRecognitionModule.addListener(
      "start",
      onStart,
    );
    const endSubscription = ExpoSpeechRecognitionModule.addListener(
      "end",
      onEnd,
    );
    const errorSubscription = ExpoSpeechRecognitionModule.addListener(
      "error",
      onError,
    );

    return () => {
      resultSubscription?.remove();
      startSubscription?.remove();
      endSubscription?.remove();
      errorSubscription?.remove();
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        // no-op
      }
    };
  }, []);

  const handleToggleVoiceSearch = useCallback(async () => {
    if (voiceStarting) {
      return;
    }

    if (voiceListening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        setVoiceListening(false);
        setVoiceStarting(false);
      }
      return;
    }

    try {
      if (
        typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === "function"
      ) {
        const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (!available) {
          Alert.alert(
            "Reconhecimento de voz indisponível",
            "Este dispositivo não suporta captura de destino por voz no momento.",
          );
          return;
        }
      }

      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert(
          "Permissão necessária",
          "Autorize o microfone para preencher o destino por voz.",
        );
        return;
      }

      setVoiceStarting(true);
      setVoiceError("");
      ExpoSpeechRecognitionModule.start({
        lang: "pt-BR",
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        contextualStrings: searchContextualStrings,
      });
    } catch (error) {
      setVoiceListening(false);
      setVoiceStarting(false);
      setVoiceError(
        String(error?.message || "Não foi possível iniciar a captura por voz."),
      );
    }
  }, [searchContextualStrings, voiceListening, voiceStarting]);

  useEffect(() => {
    if (!autoStartVoiceRequested || voiceAutoStartedRef.current) {
      return;
    }

    voiceAutoStartedRef.current = true;
    const timer = setTimeout(() => {
      handleToggleVoiceSearch();
    }, 260);

    return () => clearTimeout(timer);
  }, [autoStartVoiceRequested, handleToggleVoiceSearch]);

  const visibleResults = useMemo(() => {
    return results.slice(0, SEARCH_RESULT_LIMIT);
  }, [results]);

  const destinationInfo = selectedDestination || visibleResults[0] || null;
  const originAddress =
    resolveMeaningfulAddress(currentAddress, ORIGIN_ADDRESS) || ORIGIN_ADDRESS;
  const destinationCoordinate =
    destinationInfo?.coordinate || selectedDestination?.coordinate || null;
  const livePreviewMatchesSelection = useMemo(() => {
    if (!selectedDestination?.coordinate || !runtimeSelectedDestination?.coordinate) {
      return false;
    }

    const localLatitude = Number(selectedDestination.coordinate.latitude);
    const localLongitude = Number(selectedDestination.coordinate.longitude);
    const runtimeLatitude = Number(runtimeSelectedDestination.coordinate.latitude);
    const runtimeLongitude = Number(
      runtimeSelectedDestination.coordinate.longitude,
    );

    if (
      !Number.isFinite(localLatitude) ||
      !Number.isFinite(localLongitude) ||
      !Number.isFinite(runtimeLatitude) ||
      !Number.isFinite(runtimeLongitude)
    ) {
      return false;
    }

    return (
      Math.abs(localLatitude - runtimeLatitude) < 0.000001 &&
      Math.abs(localLongitude - runtimeLongitude) < 0.000001
    );
  }, [runtimeSelectedDestination, selectedDestination]);
  const canRequestRide = Boolean(
    Number.isFinite(destinationCoordinate?.latitude) &&
    Number.isFinite(destinationCoordinate?.longitude),
  );

  const durationMin = useMemo(() => {
    const previewDuration = Number(runtimeTripDurationMin);
    if (
      livePreviewMatchesSelection &&
      Number.isFinite(previewDuration) &&
      previewDuration > 0
    ) {
      return Math.max(1, Math.round(previewDuration));
    }

    const value = Number.parseInt(destinationInfo?.eta || "8", 10);
    return Number.isFinite(value) ? Math.max(4, value + 4) : 9;
  }, [destinationInfo, livePreviewMatchesSelection, runtimeTripDurationMin]);

  const distanceKm = useMemo(() => {
    const previewDistance = Number(runtimeTripDistanceKm);
    if (
      livePreviewMatchesSelection &&
      Number.isFinite(previewDistance) &&
      previewDistance > 0
    ) {
      return Number(previewDistance.toFixed(1));
    }

    const estimate = durationMin * 0.52;
    return Math.max(1.2, Number(estimate.toFixed(1)));
  }, [durationMin, livePreviewMatchesSelection, runtimeTripDistanceKm]);

  const arrivalTime = useMemo(() => {
    const previewArrival = String(runtimeTripArrivalText || "").trim();
    if (livePreviewMatchesSelection && previewArrival) {
      return previewArrival;
    }

    const now = new Date();
    now.setMinutes(now.getMinutes() + durationMin);
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);
  }, [durationMin, livePreviewMatchesSelection, runtimeTripArrivalText]);

  const durationLabel = useMemo(() => {
    return `${durationMin} min`;
  }, [durationMin]);

  const distanceLabel = useMemo(() => {
    return `${Number(distanceKm).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }, [distanceKm]);

  const planRateCards = useMemo(() => {
    if (!Array.isArray(catalogCars) || catalogCars.length === 0) {
      return DEFAULT_PLAN_RATE_CARDS;
    }

    const merged = {
      plus: { ...DEFAULT_PLAN_RATE_CARDS.plus },
      elite: { ...DEFAULT_PLAN_RATE_CARDS.elite },
      moto: { ...DEFAULT_PLAN_RATE_CARDS.moto },
    };

    catalogCars.forEach((car) => {
      const planId = getPlanIdFromCarName(car?.name);
      if (!planId) return;

      merged[planId] = {
        ...merged[planId],
        ...car,
        name: car?.name || merged[planId].name,
      };
    });

    return merged;
  }, [catalogCars]);

  const plans = useMemo(() => {
    return [
      {
        id: "plus",
        title: planRateCards.plus?.name || "Leaf Plus",
        value: calculateBusinessFare(
          distanceKm,
          durationMin,
          planRateCards.plus,
        ),
      },
      {
        id: "elite",
        title: planRateCards.elite?.name || "Leaf Elite",
        value: calculateBusinessFare(
          distanceKm,
          durationMin,
          planRateCards.elite,
        ),
      },
      {
        id: "moto",
        title: planRateCards.moto?.name || "Leaf Moto",
        value: calculateBusinessFare(
          distanceKm,
          durationMin,
          planRateCards.moto,
        ),
      },
    ];
  }, [distanceKm, durationMin, planRateCards]);
  const selectedPlanData =
    plans.find((item) => item.id === selectedPlan) || plans[0];
  const extensionPlanId = useMemo(() => {
    const fromSelectedVehicle = getPlanIdFromCarName(selectedVehicle);
    if (fromSelectedVehicle) {
      return fromSelectedVehicle;
    }
    return selectedPlan;
  }, [selectedPlan, selectedVehicle]);
  const visiblePlans = useMemo(() => {
    if (!isExtensionFlow) {
      return plans;
    }
    return plans.filter((item) => item.id === extensionPlanId);
  }, [extensionPlanId, isExtensionFlow, plans]);
  const activePlanData =
    visiblePlans.find((item) => item.id === selectedPlan) ||
    visiblePlans[0] ||
    selectedPlanData;
  const visiblePlanSignature = useMemo(
    () => visiblePlans.map((item) => `${item.id}:${item.title}`).join("|"),
    [visiblePlans],
  );
  const selectedPlanAvailability =
    planAvailabilityById?.[selectedPlanData?.id] || null;
  const selectedPlanUnavailable = selectedPlanAvailability?.available === false;

  useEffect(() => {
    if (!isExtensionFlow) {
      return;
    }
    if (extensionPlanId && extensionPlanId !== selectedPlan) {
      setSelectedPlan(extensionPlanId);
    }
  }, [extensionPlanId, isExtensionFlow, selectedPlan]);

  const baseSearchBottomOffset = insets.bottom + SEARCH_BOTTOM_OFFSET;
  const quoteBottomFromSearchAnchor =
    searchTopAnchor == null
      ? baseSearchBottomOffset
      : windowHeight - searchTopAnchor - sheetHeight;
  const sheetBottomOffset =
    step === SEARCH_STEP
      ? baseSearchBottomOffset
      : Math.max(
          insets.bottom + SHEET_MIN_BOTTOM_MARGIN,
          quoteBottomFromSearchAnchor,
        );
  const effectiveSheetBottomOffset =
    step === SEARCH_STEP && keyboardHeight > 0
      ? Math.max(
          sheetBottomOffset,
          keyboardHeight -
            insets.bottom +
            SHEET_MIN_BOTTOM_MARGIN +
            SEARCH_KEYBOARD_CLEARANCE,
        )
      : sheetBottomOffset;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-destination",
    occludedBottom: effectiveSheetBottomOffset + sheetHeight,
  });

  const handleDismiss = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (_error) {
      // no-op
    }
    setVoiceListening(false);
    setVoiceStarting(false);
    setPixModalVisible(false);
    if (!isExtensionFlow) {
      clearFlowPreview();
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  }, [clearFlowPreview, isExtensionFlow, navigation]);

  const handleSelectDestination = useCallback(
    async (item) => {
      const resolved = isExtensionFlow
        ? await resolveDestinationInput(item)
        : await selectDestination(item);
      if (!resolved?.coordinate) {
        Alert.alert(
          "Destino indisponível",
          "Não foi possível carregar as coordenadas desse destino agora.",
        );
        return;
      }

      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        // no-op
      }
      destinationInputRef.current?.blur?.();
      Keyboard.dismiss();
      setVoiceListening(false);
      setVoiceStarting(false);
      setSelectedDestination(resolved);
      setQuery(resolved.name);
      setStep(QUOTE_STEP);
      setSheetHeight(QUOTE_FALLBACK_HEIGHT);
    },
    [isExtensionFlow, resolveDestinationInput, selectDestination],
  );

  const handleBackToSearch = useCallback(() => {
    setStep(SEARCH_STEP);
    setSheetHeight(SEARCH_FALLBACK_HEIGHT);
    setAvailabilityNotice("");
    setPlanAvailabilityById({});
    qaAutoPixOpenedRef.current = false;
    qaAutoPixConfirmedRef.current = false;
    if (!isExtensionFlow) {
      clearFlowPreview();
    }
  }, [clearFlowPreview, isExtensionFlow]);

  useEffect(() => {
    if (step !== QUOTE_STEP || visiblePlans.length === 0) {
      return;
    }

    let cancelled = false;

    const validateVisiblePlans = async () => {
      setCheckingPlanAvailability(true);
      setAvailabilityNotice("");

      const nextAvailability = {};

      for (const plan of visiblePlans) {
        try {
          const availability = await checkRideAvailability({
            destination: {
              name: destinationInfo?.name || "Destino",
              address: destinationInfo?.address || "",
              coordinate: destinationCoordinate,
            },
            vehicle: plan.title,
          });

          nextAvailability[plan.id] = {
            available: Boolean(availability?.available),
            message: availability?.available
              ? ""
              : availability?.message || "Não há motorista disponível",
            code: availability?.code || null,
          };
        } catch (error) {
          nextAvailability[plan.id] = {
            available: false,
            message:
              error?.message || "Não foi possível validar disponibilidade.",
            code: error?.code || "AVAILABILITY_CHECK_FAILED",
          };
        }

        if (cancelled) {
          return;
        }
      }

      setPlanAvailabilityById(nextAvailability);
      setCheckingPlanAvailability(false);
    };

    validateVisiblePlans().catch(() => {
      if (!cancelled) {
        setCheckingPlanAvailability(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    checkRideAvailability,
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.name,
    step,
    visiblePlanSignature,
    visiblePlans,
  ]);

  useEffect(() => {
    if (step !== QUOTE_STEP || visiblePlans.length === 0) {
      return;
    }

    const currentPlanState = planAvailabilityById?.[selectedPlan];
    if (currentPlanState?.available !== false) {
      return;
    }

    const firstAvailablePlan = visiblePlans.find(
      (item) => planAvailabilityById?.[item.id]?.available === true,
    );

    if (firstAvailablePlan && firstAvailablePlan.id !== selectedPlan) {
      setSelectedPlan(firstAvailablePlan.id);
    }
  }, [planAvailabilityById, selectedPlan, step, visiblePlans]);

  const handleCardLayout = useCallback(
    (event) => {
      const nextHeight = event?.nativeEvent?.layout?.height;
      if (Number.isFinite(nextHeight) && nextHeight > 0) {
        setSheetHeight(nextHeight);

        if (step === SEARCH_STEP) {
          const nextTopAnchor =
            windowHeight - baseSearchBottomOffset - nextHeight;
          if (Number.isFinite(nextTopAnchor) && nextTopAnchor > 0) {
            setSearchTopAnchor(nextTopAnchor);
          }
        }
      }
    },
    [baseSearchBottomOffset, step, windowHeight],
  );

  const handleOpenPixModal = useCallback(async () => {
    if (!canRequestRide) {
      Alert.alert(
        "Selecione um destino",
        "Defina um destino válido antes de solicitar.",
      );
      return;
    }

    if (checkingAvailability || submittingRide) {
      return;
    }

    if (isExtensionFlow) {
      try {
        setSubmittingRide(true);
        setAvailabilityNotice("");
        const result = await requestTripExtension({
          destination: {
            name: destinationInfo?.name || "Destino",
            address: destinationInfo?.address || "",
            coordinate: destinationCoordinate,
          },
          newFare: activePlanData?.value,
        });

        if (result?.directChange) {
          Alert.alert(
            "Destino atualizado",
            "O novo destino ficou registrado e a corrida seguirá com a nova rota.",
            [
              {
                text: "OK",
                onPress: () => navigation.navigate(returnRouteName),
              },
            ],
          );
          return;
        }

        Alert.alert(
          "Solicitação enviada",
          "O motorista foi avisado. Se ele aceitar, o complemento Pix será exibido na tela da corrida.",
          [
            {
              text: "OK",
              onPress: () => navigation.navigate(returnRouteName),
            },
          ],
        );
      } catch (error) {
        setAvailabilityNotice(
          error?.message ||
            "Não foi possível solicitar a alteração de destino agora.",
        );
      } finally {
        setSubmittingRide(false);
      }
      return;
    }

    try {
      setCheckingAvailability(true);
      setAvailabilityNotice("");

      if (selectedPlanUnavailable) {
        setAvailabilityNotice(
          selectedPlanAvailability?.message ||
            "Não há motorista disponível para essa categoria.",
        );
        return;
      }

      const availability = await checkRideAvailability({
        destination: {
          name: destinationInfo?.name || "Destino",
          address: destinationInfo?.address || "",
          coordinate: destinationCoordinate,
        },
        vehicle: selectedPlanData.title,
      });

      if (!availability?.available) {
        setAvailabilityNotice(
          availability?.message ||
            "Não há motorista disponível para essa categoria.",
        );
        return;
      }

      setPixModalVisible(true);
    } catch (error) {
      setAvailabilityNotice(
        error?.message || "Não foi possível validar disponibilidade agora.",
      );
    } finally {
      setCheckingAvailability(false);
    }
  }, [
    activePlanData?.value,
    canRequestRide,
    checkRideAvailability,
    checkingAvailability,
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.name,
    isExtensionFlow,
    navigation,
    requestTripExtension,
    returnRouteName,
    selectedPlanData.title,
    selectedPlanAvailability?.message,
    selectedPlanUnavailable,
    submittingRide,
  ]);

  const handleClosePixModal = useCallback(() => {
    if (submittingRide) {
      return;
    }
    setPixModalVisible(false);
  }, [submittingRide]);

  useEffect(() => {
    if (step === QUOTE_STEP) {
      setAvailabilityNotice("");
    }
  }, [selectedPlan, selectedDestination, step]);

  useEffect(() => {
    if (isExtensionFlow || !passengerAutoRoute) {
      lastAutoRouteRef.current = "";
      return;
    }

    const routeKey = `${passengerAutoRoute}:${bookingStatus || "idle"}:${
      destinationInfo?.name || ""
    }`;
    if (lastAutoRouteRef.current === routeKey) {
      return;
    }

    lastAutoRouteRef.current = routeKey;
    const commonParams = {
      destination: destinationInfo?.name || "Destino",
      destinationAddress:
        destinationInfo?.address || destinationInfo?.name || "Destino",
      originAddress,
      vehicle: selectedPlanData.title || selectedVehicle || "Leaf Plus",
    };

    if (passengerAutoRoute === "RobotaxiPrototypeReceipt") {
      navigation.replace("RobotaxiPrototypeReceipt", { fromTrip: true });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeTrip") {
      navigation.replace("RobotaxiPrototypeTrip", {
        ...commonParams,
        driverName: driverInfo?.name || "Motorista",
      });
      return;
    }

    navigation.replace("RobotaxiPrototypeDriverSearch", commonParams);
  }, [
    bookingStatus,
    destinationInfo?.address,
    destinationInfo?.name,
    driverInfo?.name,
    isExtensionFlow,
    navigation,
    originAddress,
    passengerAutoRoute,
    selectedPlanData.title,
    selectedVehicle,
  ]);

  const handlePixPaymentConfirmed = useCallback(
    async (paymentConfirmation = null) => {
      const confirmedChargeId = String(paymentConfirmation?.chargeId || "").trim();

      if (
        confirmedChargeId &&
        lastHandledPaymentChargeIdRef.current === confirmedChargeId
      ) {
        return;
      }

      if (submittingRideGuardRef.current || submittingRide) {
        return;
      }

      if (!canRequestRide) {
        Alert.alert(
          "Selecione um destino",
          "Defina um destino válido antes de confirmar o pagamento.",
        );
        return;
      }

      try {
        submittingRideGuardRef.current = true;
        if (confirmedChargeId) {
          lastHandledPaymentChargeIdRef.current = confirmedChargeId;
        }
        setSubmittingRide(true);
        setPixModalVisible(false);

        await requestRide({
          destination: {
            name: destinationInfo?.name || "Destino",
            address: destinationInfo?.address || "",
            coordinate: destinationCoordinate,
          },
          originAddress,
          vehicle: selectedPlanData.title,
          fare: selectedPlanData.value,
          paymentMethod: "pix",
          paymentConfirmation,
        });

        navigation.replace("RobotaxiPrototypePaymentSuccess", {
          destination: destinationInfo?.name || "Destino",
          destinationAddress:
            destinationInfo?.address || destinationInfo?.name || "Destino",
          originAddress,
          vehicle: selectedPlanData.title,
          autoAdvance: true,
        });
      } catch (error) {
        if (confirmedChargeId) {
          lastHandledPaymentChargeIdRef.current = "";
        }
        navigation.replace("RobotaxiPrototypePaymentFailed", {
          errorMessage:
            error?.message || "Falha ao enviar a corrida para o servidor.",
          retryRouteName: "RobotaxiPrototypeDestination",
          retryParams: {},
        });
      } finally {
        submittingRideGuardRef.current = false;
        setSubmittingRide(false);
      }
    },
    [
      canRequestRide,
      destinationCoordinate,
      destinationInfo?.address,
      destinationInfo?.name,
      navigation,
      requestRide,
      selectedPlanData.title,
      selectedPlanData.value,
      submittingRide,
    ],
  );

  useEffect(() => {
    if (!qaAutoSelectFirst || step !== SEARCH_STEP || qaAutoSelectStartedRef.current) {
      return;
    }

    if (qaPresetQuery && !qaPresetSearchCompleted) {
      return;
    }

    const firstResult = Array.isArray(visibleResults) ? visibleResults[0] : null;
    if (!firstResult?.id) {
      return;
    }

    qaAutoSelectStartedRef.current = true;
    const timer = setTimeout(() => {
      handleSelectDestination(firstResult).catch((error) => {
        console.warn(
          "[RobotaxiDestinationScreen] qaAutoSelectFirst failed",
          error?.message || error,
        );
        qaAutoSelectStartedRef.current = false;
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [
    handleSelectDestination,
    qaAutoSelectFirst,
    qaPresetQuery,
    qaPresetSearchCompleted,
    step,
    visibleResults,
  ]);

  useEffect(() => {
    if (
      !qaAutoOpenPix ||
      step !== QUOTE_STEP ||
      !canRequestRide ||
      checkingAvailability ||
      checkingPlanAvailability ||
      submittingRide ||
      qaAutoPixOpenedRef.current
    ) {
      return;
    }

    const timer = setTimeout(() => {
      qaAutoPixOpenedRef.current = true;
      Promise.resolve(handleOpenPixModal()).catch((error) => {
        qaAutoPixOpenedRef.current = false;
        console.warn(
          "[RobotaxiDestinationScreen] qaAutoOpenPix failed",
          error?.message || error,
        );
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [
    canRequestRide,
    checkingAvailability,
    checkingPlanAvailability,
    handleOpenPixModal,
    qaAutoOpenPix,
    step,
    submittingRide,
  ]);

  useEffect(() => {
    if (!qaAutoConfirmPix || !isPixModalVisible || submittingRide) {
      return;
    }

    qaAutoPixConfirmedRef.current = true;
  }, [isPixModalVisible, qaAutoConfirmPix, submittingRide]);

  useEffect(() => {
    const isHealthy =
      Boolean(isSocketConnected) && (!profileUid || isSocketAuthenticated);
    const wasHealthy = lastConnectionHealthyRef.current;

    if (typeof wasHealthy !== "boolean") {
      lastConnectionHealthyRef.current = isHealthy;
      return;
    }

    if (!wasHealthy && isHealthy) {
      if (
        qaConnectionVisualState?.mode === "lost" ||
        qaConnectionVisualState?.mode === "reconnecting"
      ) {
        setQaConnectionVisualState({ mode: "recovered" });
      }
      setShowRecoveredConnectionHint(true);
      if (connectionRecoveredTimerRef.current) {
        clearTimeout(connectionRecoveredTimerRef.current);
      }
      connectionRecoveredTimerRef.current = setTimeout(() => {
        setShowRecoveredConnectionHint(false);
        setQaConnectionVisualState((currentState) =>
          currentState?.mode === "recovered" ? null : currentState,
        );
      }, 2600);
    } else if (!isHealthy) {
      setShowRecoveredConnectionHint(false);
      if (connectionRecoveredTimerRef.current) {
        clearTimeout(connectionRecoveredTimerRef.current);
        connectionRecoveredTimerRef.current = null;
      }
    }

    lastConnectionHealthyRef.current = isHealthy;
  }, [
    isSocketAuthenticated,
    isSocketConnected,
    profileUid,
    qaConnectionVisualState?.mode,
  ]);

  useEffect(() => {
    if (
      !shouldRunPrototypeConnectionAutomation(qaConnectionAutomationConfig, {
        activeRole: activeRole || "customer",
        bookingStatus: "quote",
        driverOnline: false,
      })
    ) {
      return undefined;
    }

    const executionKey = [
      qaConnectionAutomationConfig.scenario,
      qaConnectionAutomationConfig.triggerState,
      qaConnectionAutomationConfig.role || activeRole || "customer",
      "quote",
      qaConnectionAutomationConfig.nonce || "default",
    ].join(":");

    if (connectionAutomationExecutionRef.current === executionKey) {
      return undefined;
    }

    connectionAutomationExecutionRef.current = executionKey;
    const socket = WebSocketManager.getInstance();
    const timers = [];
    const reconnectingLeadMs = Math.min(
      Math.max(
        1200,
        Math.round(qaConnectionAutomationConfig.recoveryMs * 0.22),
      ),
      4000,
    );

    timers.push(
      setTimeout(() => {
        setQaConnectionVisualState({ mode: "lost" });
        socket.disconnect();

        if (qaConnectionAutomationConfig.scenario === "drop_and_recover") {
          const reconnectingDelayMs = Math.max(
            0,
            qaConnectionAutomationConfig.recoveryMs - reconnectingLeadMs,
          );

          if (reconnectingDelayMs > 0) {
            timers.push(
              setTimeout(() => {
                setQaConnectionVisualState({ mode: "reconnecting" });
              }, reconnectingDelayMs),
            );
          }

          timers.push(
            setTimeout(() => {
              setQaConnectionVisualState({ mode: "reconnecting" });
              socket.connect().catch(() => {});
            }, qaConnectionAutomationConfig.recoveryMs),
          );
        }
      }, qaConnectionAutomationConfig.delayMs),
    );

    connectionAutomationTimersRef.current = timers;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      if (connectionAutomationTimersRef.current === timers) {
        connectionAutomationTimersRef.current = [];
      }
    };
  }, [activeRole, qaConnectionAutomationConfig]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />
        <PrototypeConnectionStatusPill
          topOffset={connectionIndicatorTopOffset}
          visible={Boolean(effectiveConnectionIndicatorModel)}
          tone={effectiveConnectionIndicatorModel?.tone}
          icon={effectiveConnectionIndicatorModel?.icon}
          title={effectiveConnectionIndicatorModel?.title}
          message={effectiveConnectionIndicatorModel?.message}
        />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[
            styles.sheetWrap,
            { bottom: effectiveSheetBottomOffset },
          ]}
          dragHandleZoneHeight={48}
        >
          {step === SEARCH_STEP ? (
            <PrototypeCard
              onLayout={handleCardLayout}
              style={styles.searchCard}
            >
              <CardHandle />

              <Animated.View
                key={SEARCH_STEP}
                entering={FadeIn.duration(motion.timing.standard).easing(
                  stepEasing,
                )}
                style={styles.contentWrap}
              >
                <DestinationInput
                  inputRef={destinationInputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Para onde você quer ir?"
                  autoFocus={!autoStartVoiceRequested}
                  rightIcon={voiceListening ? "stop-circle-outline" : "mic"}
                  onPressRightIcon={handleToggleVoiceSearch}
                  rightIconDisabled={voiceStarting}
                  rightIconLoading={voiceStarting}
                  testID="passenger-destination-search-input"
                  accessibilityLabel="passenger-destination-search-input"
                  rightIconTestID="passenger-destination-search-mic"
                  rightIconAccessibilityLabel="passenger-destination-search-mic"
                />
                <Text style={styles.voiceHint}>
                  {voiceListening
                    ? "Ouvindo... toque no microfone para finalizar."
                    : "Use o microfone para ditar o destino."}
                </Text>
                {voiceError ? (
                  <Text style={styles.voiceErrorText}>{voiceError}</Text>
                ) : null}

                <FlatList
                  data={visibleResults}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  style={styles.list}
                  keyboardShouldPersistTaps="always"
                  renderItem={({ item, index }) => {
                    return (
                      <TouchableOpacity
                        style={styles.destinationRow}
                        activeOpacity={0.88}
                        onPress={() => handleSelectDestination(item)}
                        testID={`passenger-destination-result-${index}`}
                        accessibilityLabel={`passenger-destination-result-${index}`}
                      >
                        <View style={styles.destinationIconWrap}>
                          <Ionicons
                            name="location-outline"
                            size={14}
                            color={color.text.primary}
                          />
                        </View>

                        <View style={styles.destinationTextWrap}>
                          <Text
                            numberOfLines={1}
                            style={styles.destinationName}
                          >
                            {item.name}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={styles.destinationAddress}
                          >
                            {item.address}
                          </Text>
                        </View>

                        <Text style={styles.destinationEta}>{item.eta}</Text>
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    searching ? (
                      <View style={styles.searchingWrap}>
                        <ActivityIndicator
                          size="small"
                          color={color.accent.primary}
                        />
                        <Text style={styles.searchingText}>
                          Buscando destinos…
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.emptyText}>
                        {query.trim()
                          ? "Nenhum destino encontrado."
                          : "Nenhum destino recente."}
                      </Text>
                    )
                  }
                />
              </Animated.View>
            </PrototypeCard>
          ) : (
            <Animated.View
              key={QUOTE_STEP}
              entering={FadeIn.duration(motion.timing.standard).easing(
                stepEasing,
              )}
              style={styles.quoteStack}
              onLayout={handleCardLayout}
            >
              <PrototypeCard style={[styles.searchCard, styles.quoteRouteCard]}>
                <CardHandle />
                <View style={styles.routeBlock}>
                  <View style={styles.routeRow}>
                    <Text style={styles.routeLabel}>Origem</Text>
                    <Text numberOfLines={2} style={styles.routeValue}>
                      {originAddress}
                    </Text>
                  </View>

                  <View style={styles.routeDivider} />

                  <View style={styles.routeRow}>
                    <Text style={styles.routeLabel}>Destino</Text>
                    <Text numberOfLines={2} style={styles.routeValue}>
                      {destinationInfo?.name || "Destino"}
                    </Text>
                    <Text numberOfLines={2} style={styles.routeSecondary}>
                      {destinationInfo?.address || ""}
                    </Text>
                  </View>
                </View>
              </PrototypeCard>

              <PrototypeCard style={[styles.searchCard, styles.quotePlanCard]}>
                <View style={styles.quoteHeader}>
                  <TouchableOpacity
                    style={styles.backButton}
                    activeOpacity={0.85}
                    onPress={handleBackToSearch}
                  >
                    <Ionicons
                      name="arrow-back"
                      size={17}
                      color={color.text.primary}
                    />
                  </TouchableOpacity>

                  <View style={styles.quoteHeaderText}>
                    <Text style={styles.quoteTitle}>
                      {isExtensionFlow
                        ? "Novo destino da corrida"
                        : "Confirme sua viagem"}
                    </Text>
                  </View>
                </View>

                <ScrollView
                  style={styles.planListScroll}
                  contentContainerStyle={styles.planListContent}
                  showsVerticalScrollIndicator={false}
                  scrollEnabled
                  nestedScrollEnabled
                  bounces
                  alwaysBounceVertical
                  keyboardShouldPersistTaps="handled"
                >
                  {visiblePlans.map((item) => {
                    const active = selectedPlan === item.id;
                    const planAvailability = planAvailabilityById?.[item.id];
                    const planUnavailable = planAvailability?.available === false;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.planRow,
                          planUnavailable && styles.planRowUnavailable,
                          active && styles.planRowActive,
                          active && styles.planRowExpanded,
                        ]}
                        activeOpacity={0.86}
                        onPress={() => {
                          if (!isExtensionFlow && !planUnavailable) {
                            setSelectedPlan(item.id);
                          }
                        }}
                        disabled={planUnavailable}
                        testID={`passenger-destination-plan-${item.id}`}
                        accessibilityLabel={`passenger-destination-plan-${item.id}`}
                      >
                        <View style={styles.planTextWrap}>
                          <Text
                            style={[
                              styles.planName,
                              active && styles.planNameActive,
                            ]}
                          >
                            {item.title}
                          </Text>
                          {active ? (
                            <View style={styles.planMetricsRow}>
                              <View style={styles.planMetric}>
                                <Ionicons
                                  name="time-outline"
                                  size={13}
                                  color="#4B5563"
                                />
                                <Text style={styles.planMetricText}>
                                  {durationLabel}
                                </Text>
                              </View>

                              <View style={styles.planMetric}>
                                <Ionicons
                                  name="map-outline"
                                  size={13}
                                  color="#4B5563"
                                />
                                <Text style={styles.planMetricText}>
                                  {distanceLabel}
                                </Text>
                              </View>
                            </View>
                          ) : null}
                          {planUnavailable ? (
                            <Text style={styles.planAvailabilityUnavailable}>
                              {planAvailability?.message ||
                                "Não há motorista disponível"}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.planRightWrap}>
                          <Text
                            style={[
                              styles.planValue,
                              active && styles.planValueActive,
                            ]}
                          >
                            {formatCurrency(item.value)}
                          </Text>
                          {planUnavailable ? (
                            <Text style={styles.planArrivalUnavailable}>
                              Indisponível
                            </Text>
                          ) : active ? (
                            <Text style={styles.planArrival}>
                              Chegada {arrivalTime}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <PrototypePrimaryButton
                  label={
                    isExtensionFlow
                      ? submittingRide
                        ? "Solicitando alteração..."
                        : `Solicitar novo destino`
                      : checkingPlanAvailability
                        ? "Verificando categorias..."
                        : checkingAvailability
                        ? "Verificando motoristas..."
                        : selectedPlanUnavailable
                          ? "Categoria indisponível"
                        : `Solicitar ${selectedPlanData.title}`
                  }
                  icon="car-sport-outline"
                  style={styles.submitButton}
                  onPress={
                    checkingAvailability ||
                    checkingPlanAvailability ||
                    submittingRide ||
                    selectedPlanUnavailable
                      ? undefined
                      : handleOpenPixModal
                  }
                  testID="passenger-destination-confirm-button"
                  accessibilityLabel="passenger-destination-confirm-button"
                />

                {availabilityNotice ? (
                  <Text
                    style={styles.availabilityNotice}
                    testID="passenger-destination-availability-notice"
                    accessibilityLabel="passenger-destination-availability-notice"
                  >
                    {availabilityNotice}
                  </Text>
                ) : null}
              </PrototypeCard>
            </Animated.View>
          )}
        </PrototypeDismissibleSheet>

        {!isExtensionFlow ? (
          <WooviPaymentModal
            visible={isPixModalVisible}
            onClose={handleClosePixModal}
            onPaymentConfirmed={handlePixPaymentConfirmed}
            tripData={{
              pickup: {
                add: originAddress,
                lat: currentCoordinate?.latitude,
                lng: currentCoordinate?.longitude,
              },
              drop: {
                add:
                  destinationInfo?.address ||
                  destinationInfo?.name ||
                  "Destino",
                lat: destinationCoordinate?.latitude,
                lng: destinationCoordinate?.longitude,
              },
              carType: selectedPlanData.title,
              estimatedFare: selectedPlanData.value,
            }}
            estimates={{ estimateFare: selectedPlanData.value }}
            passengerId={profileUid || "prototype-passenger"}
            passengerName={riderProfile?.name || "Passageira Leaf"}
            passengerEmail={riderProfile?.email || "passageiro@leaf.app.br"}
            qaAutoConfirm={qaAutoConfirmPix}
          />
        ) : null}
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  sheetWrap: {
    position: "absolute",
    left: 10,
    right: 10,
  },
  searchCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  contentWrap: {
    marginTop: 2,
  },
  voiceHint: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  voiceErrorText: {
    marginTop: 4,
    color: "#8A1F2B",
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  quoteStack: {
    gap: 8,
  },
  quoteRouteCard: {
    paddingBottom: 10,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderColor: "rgba(11,16,32,0.14)",
    shadowColor: "#0B1020",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 14,
  },
  quotePlanCard: {
    paddingTop: 12,
    height: 350,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderColor: "rgba(11,16,32,0.14)",
    shadowColor: "#0B1020",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 14,
  },
  list: {
    maxHeight: SEARCH_RESULT_LIMIT * 66 + 6,
    marginTop: 10,
  },
  listContent: {
    paddingBottom: 2,
  },
  destinationRow: {
    minHeight: 58,
    borderRadius: 14,
    marginBottom: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
  },
  destinationIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.surface.tertiary,
  },
  destinationTextWrap: {
    flex: 1,
    marginHorizontal: 10,
  },
  destinationName: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  destinationAddress: {
    color: color.text.secondary,
    marginTop: 1,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  destinationEta: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  emptyText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
    paddingVertical: 8,
  },
  searchingWrap: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  searchingText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  quoteHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  quoteHeaderText: {
    marginLeft: 8,
    flex: 1,
  },
  quoteTitle: {
    color: "#111827",
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
  },
  routeBlock: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(11,16,32,0.12)",
    backgroundColor: "#FFFFFF",
  },
  routeRow: {
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "center",
  },
  routeLabel: {
    color: "#000000",
    fontFamily: fonts.Bold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  routeValue: {
    marginTop: 2,
    color: "#111827",
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  routeSecondary: {
    marginTop: 1,
    color: "#6B7280",
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  routeDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border.separator,
  },
  planListScroll: {
    marginTop: 10,
    height: PLAN_LIST_VIEWPORT_HEIGHT,
  },
  planListContent: {
    paddingBottom: 10,
  },
  planRow: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(11,16,32,0.1)",
    backgroundColor: "#F5F7FA",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  planRowUnavailable: {
    borderColor: "rgba(185, 28, 28, 0.22)",
    backgroundColor: "#FEF2F2",
  },
  planRowActive: {
    borderColor: "#B8C2CF",
    backgroundColor: "#E7ECF3",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.11,
    shadowRadius: 12,
    elevation: 4,
  },
  planRowExpanded: {
    minHeight: 82,
    alignItems: "flex-start",
    paddingVertical: 10,
  },
  planTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  planName: {
    color: "#111827",
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  planNameActive: {
    color: "#0B1220",
  },
  planMetricsRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  planMetric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  planMetricText: {
    color: "#4B5563",
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  planAvailabilityUnavailable: {
    marginTop: 6,
    color: "#B91C1C",
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  planRightWrap: {
    minWidth: 104,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  planValue: {
    color: "#111827",
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  planValueActive: {
    color: "#0B1220",
  },
  planArrival: {
    marginTop: 4,
    color: "#4B5563",
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textAlign: "right",
  },
  planArrivalUnavailable: {
    marginTop: 4,
    color: "#B91C1C",
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textAlign: "right",
  },
  submitButton: {
    marginTop: 10,
    backgroundColor: "#111827",
    borderColor: "#0B1220",
    shadowColor: "#0B1220",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.26,
    shadowRadius: 14,
    elevation: 10,
  },
  availabilityNotice: {
    marginTop: 10,
    color: color.feedback.danger,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
});
