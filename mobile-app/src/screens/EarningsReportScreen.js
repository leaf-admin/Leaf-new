import Logger from '../utils/Logger';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import DatePicker from 'react-native-date-picker';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/runtimeTokens';
import { fonts } from '../theme/runtimeTokens';
import { LoadingSpinner } from '../components/LoadingStates';
import robotaxiPrototypeTokens from '../components/design-system/robotaxiPrototypeTokens';
import PrototypeDismissibleSheet from '../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuStatRow,
  PrototypeMenuSurface,
} from '../components/prototype/PrototypeMenuSurface';
import KYCCameraScreen from '../components/KYC/KYCCameraScreen';
import AWSLivenessWebViewScreen from '../components/KYC/AWSLivenessWebViewScreen';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { getPilotLaunchFeatureSnapshot } from '../config/pilotLaunchProfile';
import useFeatureFlag from '../hooks/useFeatureFlag';
import DriverBalanceService from '../services/DriverBalanceService';
import kycService from '../services/KYCService';
import { usePrototypeMapOcclusion } from './prototype/prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototype/prototypeRideRuntime';
import {
  buildRuntimeHistorySeries,
  buildTripFinancialTotals,
} from './prototype/tripFinancialSummary';

const MAIN_COLOR = colors.TAXIPRIMARY;
const { color: tokenColor, elevation: tokenElevation } = robotaxiPrototypeTokens;
const FILTER_PRESETS = [
  { key: 'today', label: 'Hoje', mode: 'today' },
  { key: 'yesterday', label: 'Ontem', mode: 'yesterday' },
  { key: 'd3', label: '3 dias', mode: 'last', days: 3 },
  { key: 'd7', label: '7 dias', mode: 'last', days: 7 },
  { key: 'd30', label: '30 dias', mode: 'last', days: 30 }
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCurrency(value) {
  const numeric = toNumber(value, 0);
  return numeric
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatCurrencyCompact(value) {
  const numeric = toNumber(value, 0);
  if (numeric >= 1000) {
    const compact = (numeric / 1000).toFixed(1).replace('.', ',');
    return `R$ ${compact}k`;
  }
  return `R$ ${formatCurrency(numeric)}`;
}

function parseDateFlexible(rawValue) {
  if (!rawValue && rawValue !== 0) {
    return null;
  }

  if (rawValue instanceof Date) {
    return Number.isNaN(rawValue.getTime()) ? null : rawValue;
  }

  if (typeof rawValue === 'number') {
    const ms = rawValue > 1000000000000 ? rawValue : rawValue * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(rawValue).trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateISO) {
  const date = parseDateFlexible(dateISO);
  if (!date) {
    return '--/--';
  }
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatWeekdayLabel(dateISO) {
  const date = parseDateFlexible(dateISO);
  if (!date) {
    return '--';
  }
  return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
}

function normalizeDailySeries(report) {
  const sourceSeries = Array.isArray(report?.dailySeries) ? report.dailySeries : [];
  if (sourceSeries.length > 0) {
    const mapped = sourceSeries
      .map((item, index) => {
        const parsedDate = parseDateFlexible(item?.date || item?.createdAt || item?.dayDate);
        if (!parsedDate) {
          return null;
        }

        const netAmount = toNumber(item?.amount ?? item?.netAmount ?? item?.driverNetAmount, 0);
        const feeAmount = toNumber(item?.feeAmount ?? item?.totalFees, 0);
        const rawGrossAmount = toNumber(item?.grossAmount ?? item?.totalAmount ?? item?.fare, NaN);
        const grossAmount = Number.isFinite(rawGrossAmount) ? rawGrossAmount : Math.max(0, netAmount + feeAmount);

        return {
          key: `${toISODate(parsedDate)}-${index}`,
          date: toISODate(parsedDate),
          label: formatDateLabel(parsedDate),
          netAmount,
          grossAmount,
          feeAmount,
          completedCount: Math.max(0, Math.round(toNumber(item?.completedCount ?? item?.ridesCompleted, 0))),
          cancelledCount: Math.max(0, Math.round(toNumber(item?.cancelledCount ?? item?.cancellations, 0)))
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (mapped.length > 0) {
      return mapped;
    }
  }

  const fallbackDaily = Array.isArray(report?.dailyEarnings) ? report.dailyEarnings : [];
  const today = startOfDay(new Date());

  return fallbackDaily
    .map((item, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (fallbackDaily.length - 1 - index));
      const netAmount = toNumber(item?.amount, 0);
      const feeAmount = toNumber(item?.feeAmount ?? item?.totalFees, 0);
      const rawGrossAmount = toNumber(item?.grossAmount ?? item?.totalAmount ?? item?.fare, NaN);
      const grossAmount = Number.isFinite(rawGrossAmount) ? rawGrossAmount : Math.max(0, netAmount + feeAmount);
      return {
        key: `${toISODate(date)}-${index}`,
        date: toISODate(date),
        label: formatDateLabel(date),
        netAmount,
        grossAmount,
        feeAmount,
        completedCount: 0,
        cancelledCount: 0
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function applySeriesFilter(series, activeFilterKey, customRange) {
  if (!Array.isArray(series) || series.length === 0) {
    return [];
  }

  const today = startOfDay(new Date());
  const todayISO = toISODate(today);

  if (activeFilterKey === 'today') {
    return series.filter(item => item.date === todayISO);
  }

  if (activeFilterKey === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = toISODate(yesterday);
    return series.filter(item => item.date === yesterdayISO);
  }

  if (activeFilterKey === 'custom_range' || activeFilterKey === 'custom') {
    const fallbackEnd = startOfDay(new Date());
    const fallbackStart = new Date(fallbackEnd);
    fallbackStart.setDate(fallbackStart.getDate() - 13);

    const parsedStart = parseDateFlexible(customRange?.startDate) || fallbackStart;
    const parsedEnd = parseDateFlexible(customRange?.endDate) || fallbackEnd;

    const normalizedStart = startOfDay(parsedStart);
    const normalizedEnd = startOfDay(parsedEnd);

    const startISO = toISODate(normalizedStart <= normalizedEnd ? normalizedStart : normalizedEnd);
    const endISO = toISODate(normalizedStart <= normalizedEnd ? normalizedEnd : normalizedStart);

    return series.filter(item => String(item?.date || '') >= startISO && String(item?.date || '') <= endISO);
  }

  const preset = FILTER_PRESETS.find(item => item.key === activeFilterKey);
  if (preset?.mode === 'last' && preset.days) {
    return series.slice(-preset.days);
  }

  return series.slice(-7);
}

function compressSeriesToMaxPoints(series, maxPoints = 5) {
  if (!Array.isArray(series) || series.length === 0) {
    return [];
  }

  if (series.length <= maxPoints) {
    return series.map(item => ({
      ...item,
      plotLabel: formatDateLabel(item.date)
    }));
  }

  const segmentCount = Math.min(maxPoints, series.length);
  const compressed = [];

  for (let i = 0; i < segmentCount; i += 1) {
    const start = Math.floor((i * series.length) / segmentCount);
    const end = Math.floor(((i + 1) * series.length) / segmentCount);
    const chunk = series.slice(start, Math.max(start + 1, end));
    if (chunk.length === 0) {
      continue;
    }

    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const netAmount = chunk.reduce((sum, item) => sum + toNumber(item.netAmount, 0), 0);
    const grossAmount = chunk.reduce((sum, item) => sum + toNumber(item.grossAmount, 0), 0);
    const feeAmount = chunk.reduce((sum, item) => sum + toNumber(item.feeAmount, 0), 0);
    const completedCount = chunk.reduce((sum, item) => sum + Math.round(toNumber(item.completedCount, 0)), 0);
    const cancelledCount = chunk.reduce((sum, item) => sum + Math.round(toNumber(item.cancelledCount, 0)), 0);

    compressed.push({
      key: `${first.date}-${last.date}-${i}`,
      date: last.date,
      netAmount,
      grossAmount,
      feeAmount,
      completedCount,
      cancelledCount,
      plotLabel: first.date === last.date ? formatDateLabel(first.date) : `${formatDateLabel(first.date)}-${formatDateLabel(last.date)}`
    });
  }

  return compressed;
}

function resolvePartnerSinceLabel(profile) {
  const candidate =
    profile?.createdAt ||
    profile?.created_at ||
    profile?.createdon ||
    profile?.createdOn ||
    profile?.registeredAt ||
    profile?.timestamp ||
    null;

  const parsed = parseDateFlexible(candidate);
  if (!parsed) {
    return '-';
  }

  return parsed.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
}

function aggregateTotals(series) {
  const totalNet = series.reduce((sum, item) => sum + toNumber(item.netAmount, 0), 0);
  const totalGross = series.reduce((sum, item) => sum + toNumber(item.grossAmount, 0), 0);
  const totalFee = series.reduce((sum, item) => sum + toNumber(item.feeAmount, 0), 0);
  const totalRides = series.reduce((sum, item) => sum + Math.round(toNumber(item.completedCount, 0)), 0);
  const totalCancellations = series.reduce((sum, item) => sum + Math.round(toNumber(item.cancelledCount, 0)), 0);

  const grossBase = totalGross > 0 ? totalGross : Math.max(0, totalNet + totalFee);
  const effectiveRate = grossBase > 0 ? (totalFee / grossBase) * 100 : 0;

  return {
    totalNet,
    totalGross: grossBase,
    totalFee,
    totalRides,
    totalCancellations,
    effectiveRate
  };
}

export default function EarningsReportScreen({ navigation, route }) {
  const isDarkMode = useSelector(state => state.settingsdata.isDarkMode);
  const auth = useSelector(state => state.auth);
  const { tripHistory, lastReceipt } = usePrototypeRideRuntime();
  const pilotLaunchSnapshot = getPilotLaunchFeatureSnapshot();
  const withdrawalsEnabled = useFeatureFlag(
    'PILOT_DRIVER_WITHDRAWALS_ENABLED',
    pilotLaunchSnapshot.driverWithdrawalsEnabled
  );
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [earningsData, setEarningsData] = useState(null);
  const [isLoadingEarnings, setIsLoadingEarnings] = useState(true);
  const [panelHeight, setPanelHeight] = useState(windowHeight);

  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawValue, setWithdrawValue] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [withdrawPassword, setWithdrawPassword] = useState('');
  const [withdrawError, setWithdrawError] = useState('');
  const [isProcessingWithdraw, setIsProcessingWithdraw] = useState(false);

  const [showWithdrawKYCModal, setShowWithdrawKYCModal] = useState(false);
  const [withdrawKycReason, setWithdrawKycReason] = useState('');
  const [withdrawStepUpChallenge, setWithdrawStepUpChallenge] = useState(null);
  const [pendingWithdrawalPayload, setPendingWithdrawalPayload] = useState(null);
  const [isProcessingKYCWithdraw, setIsProcessingKYCWithdraw] = useState(false);
  const [withdrawKycMode, setWithdrawKycMode] = useState('local');
  const [isWithdrawKycProviderLoading, setIsWithdrawKycProviderLoading] = useState(false);

  const [activeFilterKey, setActiveFilterKey] = useState('today');
  const [customFilterModalVisible, setCustomFilterModalVisible] = useState(false);
  const [customStartDate, setCustomStartDate] = useState(() => {
    const start = startOfDay(new Date());
    start.setDate(start.getDate() - 13);
    return start;
  });
  const [customEndDate, setCustomEndDate] = useState(() => startOfDay(new Date()));
  const [draftStartDate, setDraftStartDate] = useState(() => {
    const start = startOfDay(new Date());
    start.setDate(start.getDate() - 13);
    return start;
  });
  const [draftEndDate, setDraftEndDate] = useState(() => startOfDay(new Date()));
  const [chartWidth, setChartWidth] = useState(0);

  const saldoDisponivel = toNumber(earningsData?.balance, 0);
  const assinaturaPendente = toNumber(earningsData?.subscriptionPendingFee, 0);
  const subscriptionDailyFeeSuspended = earningsData?.subscriptionDailyFeeSuspended !== false;
  const subscriptionDailyFeeNominalCents = Math.max(
    0,
    Math.round(toNumber(
      earningsData?.subscriptionDailyFeeNominalCents,
      DriverBalanceService.SUBSCRIPTION_DAILY_FEE_NOMINAL * 100
    ))
  );
  const subscriptionDailyFeeNominalValue = toNumber(
    earningsData?.subscriptionDailyFeeNominal,
    subscriptionDailyFeeNominalCents > 0 ? subscriptionDailyFeeNominalCents / 100 : DriverBalanceService.SUBSCRIPTION_DAILY_FEE_NOMINAL
  );
  const subscriptionDailyFeeCents = Math.max(0, Math.round(toNumber(earningsData?.subscriptionDailyFeeCents, 0)));
  const subscriptionDailyFeeValue = toNumber(
    earningsData?.subscriptionDailyFee,
    subscriptionDailyFeeCents > 0 ? subscriptionDailyFeeCents / 100 : 0
  );
  const subscriptionDailyFeeNominalLabel = `R$ ${formatCurrency(subscriptionDailyFeeNominalValue)}`;
  const subscriptionDailyFeeLabel =
    subscriptionDailyFeeSuspended
      ? 'R$ 0,00'
      : subscriptionDailyFeeCents === 0
        ? 'Isenta'
      : `R$ ${formatCurrency(subscriptionDailyFeeValue)}`;

  useEffect(() => {
    const loadEarningsData = async () => {
      try {
        setIsLoadingEarnings(true);
        if (!auth?.profile?.uid) {
          setIsLoadingEarnings(false);
          return;
        }

        const baseUrl = getSelfHostedApiUrl('/api');
        Logger.log(`Trazendo Relatório de Faturamento: ${baseUrl}/drivers/${auth.profile.uid}/earnings`);

        const response = await fetch(`${baseUrl}/drivers/${auth.profile.uid}/earnings`);
        const payload = await response.json();

        if (payload?.success && payload?.report) {
          const mergedReport = { ...payload.report };
          try {
            const balanceResult = await DriverBalanceService.getDriverBalance(auth.profile.uid);
            if (balanceResult?.success) {
              mergedReport.balance = toNumber(balanceResult.balance, mergedReport.balance || 0);
              mergedReport.subscriptionPendingFee = toNumber(balanceResult.subscriptionPendingFee, 0);
              mergedReport.subscriptionPendingFeeCents = toNumber(balanceResult.subscriptionPendingFeeCents, 0);
              mergedReport.subscriptionDailyFee = toNumber(balanceResult.subscriptionDailyFee, 0);
              mergedReport.subscriptionDailyFeeCents = toNumber(balanceResult.subscriptionDailyFeeCents, 0);
              mergedReport.subscriptionDailyFeeNominal = toNumber(
                balanceResult.subscriptionDailyFeeNominal,
                DriverBalanceService.SUBSCRIPTION_DAILY_FEE_NOMINAL
              );
              mergedReport.subscriptionDailyFeeNominalCents = toNumber(
                balanceResult.subscriptionDailyFeeNominalCents,
                DriverBalanceService.SUBSCRIPTION_DAILY_FEE_NOMINAL * 100
              );
              mergedReport.subscriptionDailyFeeSuspended = balanceResult.subscriptionDailyFeeSuspended === true;
              mergedReport.subscriptionDailyBillingEnabled = balanceResult.subscriptionDailyBillingEnabled === true;
              mergedReport.subscriptionWaveId = balanceResult.subscriptionWaveId || null;
              mergedReport.availableAfterSubscription =
                toNumber(balanceResult.availableAfterSubscription, NaN)
                || Math.max(0, toNumber(mergedReport.balance, 0) - toNumber(balanceResult.subscriptionPendingFee, 0));
            }
          } catch (balanceError) {
            Logger.warn('⚠️ Não foi possível sincronizar saldo detalhado de saque:', balanceError?.message);
          }

          setEarningsData(mergedReport);
        } else {
          setEarningsData({
            balance: 0,
            rating: 0,
            dailySeries: [],
            dailyEarnings: [],
            tripsToday: 0,
            totalCancellations: 0
          });
        }
      } catch (error) {
        Logger.error('Erro ao carregar dados de ganhos:', error);
        setEarningsData({
          balance: 0,
          rating: 0,
          dailySeries: [],
          dailyEarnings: [],
          tripsToday: 0,
          totalCancellations: 0
        });
      } finally {
        setIsLoadingEarnings(false);
      }
    };

    loadEarningsData();
  }, [auth?.profile?.uid]);

  useEffect(() => {
    const incomingFilter = route?.params?.defaultFilter;
    if (typeof incomingFilter === 'string') {
      if (incomingFilter === 'custom' || incomingFilter === 'custom_range') {
        setActiveFilterKey('custom_range');
      } else if (FILTER_PRESETS.some(item => item.key === incomingFilter)) {
        setActiveFilterKey(incomingFilter);
      }
    }
  }, [route?.params?.defaultFilter]);

  useEffect(() => {
    const rangeDays = Math.round(toNumber(route?.params?.defaultRangeDays, 0));
    if (!rangeDays || rangeDays < 1) {
      return;
    }

    if (rangeDays === 1) {
      setActiveFilterKey('today');
      return;
    }
    if (rangeDays === 3) {
      setActiveFilterKey('d3');
      return;
    }
    if (rangeDays === 7) {
      setActiveFilterKey('d7');
      return;
    }
    if (rangeDays === 30) {
      setActiveFilterKey('d30');
      return;
    }

    const normalizedDays = Math.min(365, Math.max(1, rangeDays));
    const end = startOfDay(new Date());
    const start = new Date(end);
    start.setDate(start.getDate() - (normalizedDays - 1));
    setCustomStartDate(start);
    setCustomEndDate(end);
    setDraftStartDate(start);
    setDraftEndDate(end);
    setActiveFilterKey('custom_range');
  }, [route?.params?.defaultRangeDays]);

  useEffect(() => {
    let isMounted = true;

    const resolveWithdrawKycMode = async () => {
      if (!showWithdrawKYCModal) {
        setWithdrawKycMode('local');
        setIsWithdrawKycProviderLoading(false);
        return;
      }

      setIsWithdrawKycProviderLoading(true);
      const providerResult = await kycService.getPreferredLivenessMode();
      if (!isMounted) {
        return;
      }

      if (!providerResult?.success) {
        Logger.warn('⚠️ [KYC] Fallback local no saque:', providerResult?.error);
        setWithdrawKycMode('local');
        setIsWithdrawKycProviderLoading(false);
        return;
      }

      setWithdrawKycMode(providerResult.mode === 'aws' ? 'aws' : 'local');
      setIsWithdrawKycProviderLoading(false);
    };

    resolveWithdrawKycMode();
    return () => {
      isMounted = false;
    };
  }, [showWithdrawKYCModal]);

  function getWithdrawCostBreakdown(amount) {
    const normalizedAmount = toNumber(amount, 0);
    const fee = DriverBalanceService.calculateWithdrawFee(normalizedAmount);
    const subscriptionSettlement = !subscriptionDailyFeeSuspended && assinaturaPendente > 0 ? assinaturaPendente : 0;
    const totalDebit = normalizedAmount + fee + subscriptionSettlement;
    return {
      fee,
      subscriptionSettlement,
      totalDebit
    };
  }

  function handleWithdrawValueChange(value) {
    setWithdrawValue(value);
    const amount = toNumber(String(value).replace(',', '.'), 0);
    const { totalDebit } = getWithdrawCostBreakdown(amount);

    if (amount <= 0) {
      setWithdrawError('');
      return;
    }

    if (totalDebit > saldoDisponivel) {
      setWithdrawError(`Saldo insuficiente para saque + taxa + assinatura (R$ ${formatCurrency(totalDebit)})`);
    } else {
      setWithdrawError('');
    }
  }

  function finalizeWithdrawalSuccess(result, amount, fee, totalDebit) {
    setWithdrawModalVisible(false);
    setShowWithdrawKYCModal(false);
    setWithdrawValue('');
    setPixKey('');
    setWithdrawPassword('');
    setWithdrawError('');
    setWithdrawKycReason('');
    setWithdrawStepUpChallenge(null);
    setPendingWithdrawalPayload(null);

    setEarningsData(previous => {
      if (!previous) {
        return previous;
      }
      const settlementInReais = toNumber(result.subscriptionSettlementInReais, 0);
      const nextPending = Math.max(0, toNumber(previous.subscriptionPendingFee, 0) - settlementInReais);
      return {
        ...previous,
        balance: toNumber(result.newBalance, 0),
        subscriptionPendingFee: nextPending,
        subscriptionPendingFeeCents: Math.round(nextPending * 100),
        availableAfterSubscription: Math.max(0, toNumber(result.newBalance, 0) - nextPending)
      };
    });

    const settlementToShow = toNumber(result.subscriptionSettlementInReais, 0);
    const totalToShow = toNumber(result.totalDebitInReais, totalDebit);

    Alert.alert(
      'Saque solicitado',
      `Valor: R$ ${formatCurrency(amount)}\nTaxa: R$ ${formatCurrency(fee)}${
        settlementToShow > 0 ? `\nAssinatura pendente: R$ ${formatCurrency(settlementToShow)}` : ''
      }\nDébito total: R$ ${formatCurrency(totalToShow)}`
    );
  }

  function mapKycRequirementMessage(requirement) {
    if (requirement === 'LIVENESS_REQUIRED') {
      return 'Precisamos validar seu rosto com prova de vida para concluir este saque.';
    }
    return 'Precisamos validar sua identidade para concluir este saque.';
  }

  async function handleWithdrawKYCCapture(selfieImageUri) {
    try {
      if (!auth?.profile?.uid) {
        Alert.alert('Erro', 'Motorista não autenticado');
        return;
      }

      if (!withdrawStepUpChallenge?.challengeId || !pendingWithdrawalPayload) {
        setShowWithdrawKYCModal(false);
        setWithdrawModalVisible(true);
        setWithdrawError('Challenge KYC não disponível para concluir saque.');
        return;
      }

      setShowWithdrawKYCModal(false);
      setIsProcessingKYCWithdraw(true);

      const verifyResult = await kycService.verifyDriver(auth.profile.uid, selfieImageUri, {
        challengeId: withdrawStepUpChallenge.challengeId,
        requirement: withdrawStepUpChallenge.requirement,
        livenessPassed: true,
        mode: 'device_signature_v1'
      });

      const isMatch = !!(verifyResult?.success && verifyResult?.data?.isMatch);
      if (!isMatch) {
        setWithdrawModalVisible(true);
        setWithdrawError(verifyResult?.error || 'Validação facial não aprovada. Tente novamente com boa iluminação.');
        return;
      }

      const retryResult = await DriverBalanceService.requestWithdrawal(
        auth.profile.uid,
        pendingWithdrawalPayload.amount,
        pendingWithdrawalPayload.pixKey,
        pendingWithdrawalPayload.password
      );

      if (!retryResult.success) {
        setWithdrawModalVisible(true);
        setWithdrawError(retryResult.error || 'Falha ao solicitar saque após validação KYC');
        return;
      }

      finalizeWithdrawalSuccess(retryResult, pendingWithdrawalPayload.amount, pendingWithdrawalPayload.fee, pendingWithdrawalPayload.totalDebit);
    } catch (error) {
      Logger.error('Erro ao concluir validação KYC para saque:', error);
      setWithdrawModalVisible(true);
      setWithdrawError('Erro ao validar identidade para saque. Tente novamente.');
    } finally {
      setIsProcessingKYCWithdraw(false);
      setIsProcessingWithdraw(false);
    }
  }

  async function handleWithdrawKycAwsSuccess({ sessionId }) {
    try {
      if (!auth?.profile?.uid) {
        Alert.alert('Erro', 'Motorista não autenticado');
        return;
      }

      if (!withdrawStepUpChallenge?.challengeId || !pendingWithdrawalPayload) {
        setShowWithdrawKYCModal(false);
        setWithdrawModalVisible(true);
        setWithdrawError('Challenge KYC não disponível para concluir saque.');
        return;
      }

      setShowWithdrawKYCModal(false);
      setIsProcessingKYCWithdraw(true);

      const verifyResult = await kycService.verifyDriver(auth.profile.uid, null, {
        challengeId: withdrawStepUpChallenge.challengeId,
        requirement: withdrawStepUpChallenge.requirement,
        livenessPassed: true,
        awsSessionId: sessionId,
        mode: kycService.getAwsProviderName()
      });

      const isMatch = !!(verifyResult?.success && verifyResult?.data?.isMatch);
      if (!isMatch) {
        setWithdrawModalVisible(true);
        setWithdrawError(verifyResult?.error || 'Validação facial não aprovada. Tente novamente.');
        return;
      }

      const retryResult = await DriverBalanceService.requestWithdrawal(
        auth.profile.uid,
        pendingWithdrawalPayload.amount,
        pendingWithdrawalPayload.pixKey,
        pendingWithdrawalPayload.password
      );

      if (!retryResult.success) {
        setWithdrawModalVisible(true);
        setWithdrawError(retryResult.error || 'Falha ao solicitar saque após validação KYC');
        return;
      }

      finalizeWithdrawalSuccess(retryResult, pendingWithdrawalPayload.amount, pendingWithdrawalPayload.fee, pendingWithdrawalPayload.totalDebit);
    } catch (error) {
      Logger.error('Erro ao concluir validação KYC AWS para saque:', error);
      setWithdrawModalVisible(true);
      setWithdrawError('Erro ao validar identidade para saque. Tente novamente.');
    } finally {
      setIsProcessingKYCWithdraw(false);
      setIsProcessingWithdraw(false);
    }
  }

  function handleWithdrawKycFallbackLocal() {
    setWithdrawKycMode('local');
  }

  function handleWithdrawKYCCancel() {
    setShowWithdrawKYCModal(false);
    setWithdrawModalVisible(true);
    setWithdrawKycMode('local');
    setIsWithdrawKycProviderLoading(false);
    setWithdrawError('Verificação facial necessária para concluir o saque.');
  }

  async function handleConfirmWithdraw() {
    try {
      if (!withdrawalsEnabled) {
        Alert.alert(
          'Saque fora do piloto',
          'Durante o piloto controlado, os repasses do motorista serao tratados pela operacao assistida.'
        );
        setWithdrawModalVisible(false);
        return;
      }

      if (!auth?.profile?.uid) {
        Alert.alert('Erro', 'Motorista não autenticado');
        return;
      }

      const amount = toNumber(String(withdrawValue).replace(',', '.'), 0);
      if (amount <= 0) {
        setWithdrawError('Informe um valor válido');
        return;
      }

      const { fee, totalDebit, subscriptionSettlement } = getWithdrawCostBreakdown(amount);
      if (totalDebit > saldoDisponivel) {
        setWithdrawError(`Saldo insuficiente para saque + taxa + assinatura (R$ ${formatCurrency(totalDebit)})`);
        return;
      }

      const appPassword = String(withdrawPassword || '').trim();
      if (!appPassword) {
        setWithdrawError('Informe sua senha do app para confirmar o saque');
        return;
      }

      setIsProcessingWithdraw(true);
      const normalizedPixKey = String(pixKey || '').trim();
      const result = await DriverBalanceService.requestWithdrawal(auth.profile.uid, amount, normalizedPixKey, appPassword);

      if (!result.success) {
        if (result.code === 'KYC_STEP_UP_REQUIRED' && result?.kyc?.challengeId) {
          const requirement = result.kyc.requirement || 'VERIFY_REQUIRED';
          setWithdrawKycReason(mapKycRequirementMessage(requirement));
          setWithdrawStepUpChallenge({
            challengeId: result.kyc.challengeId,
            requirement,
            expiresAt: result.kyc.challengeExpiresAt || null
          });
          setPendingWithdrawalPayload({
            amount,
            pixKey: normalizedPixKey,
            password: appPassword,
            fee,
            subscriptionSettlement,
            totalDebit
          });
          setWithdrawError('');
          setWithdrawModalVisible(false);
          setShowWithdrawKYCModal(true);
          return;
        }

        setWithdrawError(result.error || 'Falha ao solicitar saque');
        return;
      }

      finalizeWithdrawalSuccess(result, amount, fee, totalDebit);
    } catch (error) {
      Logger.error('Erro ao confirmar saque:', error);
      setWithdrawError('Erro ao solicitar saque');
    } finally {
      setIsProcessingWithdraw(false);
    }
  }

  const profileName =
    String(auth?.profile?.firstName || auth?.profile?.name || '').trim()
    || String(auth?.profile?.lastName || '').trim()
    || 'Usuário';

  const profilePhoto = auth?.profile?.profile_image
    ? { uri: auth.profile.profile_image }
    : require('../../assets/images/profilePic.png');

  const partnerSinceLabel = resolvePartnerSinceLabel(auth?.profile);
  const ratingLabel = toNumber(earningsData?.rating, 0).toFixed(1);
  const runtimeHistory = useMemo(
    () => {
      const mergedHistory = [lastReceipt, ...(Array.isArray(tripHistory) ? tripHistory : [])]
        .filter(Boolean);
      const seenIds = new Set();

      return mergedHistory.filter((item, index) => {
        const id = String(
          item?.id ||
            item?.bookingId ||
            item?.completedAt ||
            item?.date ||
            `earnings-runtime-history-${index}`
        ).trim();

        if (seenIds.has(id)) {
          return false;
        }

        seenIds.add(id);
        return true;
      });
    },
    [lastReceipt, tripHistory]
  );
  const hasRuntimeHistory = runtimeHistory.length > 0;

  const normalizedSeries = useMemo(
    () =>
      hasRuntimeHistory
        ? buildRuntimeHistorySeries(runtimeHistory)
        : normalizeDailySeries(earningsData),
    [earningsData, hasRuntimeHistory, runtimeHistory]
  );
  const filteredSeries = useMemo(
    () => applySeriesFilter(normalizedSeries, activeFilterKey, { startDate: customStartDate, endDate: customEndDate }),
    [normalizedSeries, activeFilterKey, customStartDate, customEndDate]
  );
  const barSeries = useMemo(() => compressSeriesToMaxPoints(filteredSeries, 7), [filteredSeries]);

  const {
    totalNet,
    totalGross,
    totalFee,
    totalRides,
    totalCancellations,
    effectiveRate
  } = useMemo(() => aggregateTotals(filteredSeries), [filteredSeries]);
  const overallRuntimeTotals = useMemo(
    () => buildTripFinancialTotals(runtimeHistory, { role: 'driver' }),
    [runtimeHistory]
  );
  const summaryTotalNet = hasRuntimeHistory ? overallRuntimeTotals.totalNet : totalNet;
  const summaryTotalGross = hasRuntimeHistory ? overallRuntimeTotals.totalGross : totalGross;
  const summaryTotalFee = hasRuntimeHistory ? overallRuntimeTotals.totalFees : totalFee;
  const summaryTotalRides = hasRuntimeHistory ? overallRuntimeTotals.count : totalRides;
  const summaryEffectiveRate =
    summaryTotalGross > 0 ? (summaryTotalFee / summaryTotalGross) * 100 : effectiveRate;

  const todayFallbackRides = activeFilterKey === 'today' ? Math.round(toNumber(earningsData?.tripsToday, 0)) : 0;
  const safeTotalRides = hasRuntimeHistory
    ? summaryTotalRides
    : Math.max(totalRides, todayFallbackRides);
  const safeTotalCancellations = Math.max(totalCancellations, Math.round(toNumber(earningsData?.totalCancellations, 0)));

  const chartHeight = 152;
  const chartTop = 12;
  const chartBottom = 30;
  const chartInnerHeight = chartHeight - chartTop - chartBottom;
  const chartInnerWidth = Math.max(220, chartWidth - 28);

  const bars = useMemo(() => {
    if (barSeries.length === 0) {
      return [];
    }

    const maxValue = Math.max(1, ...barSeries.map(item => toNumber(item.netAmount, 0)));
    const gap = 8;
    const barWidth = Math.max(16, Math.min(34, (chartInnerWidth - (barSeries.length - 1) * gap) / barSeries.length));
    const totalWidth = barSeries.length * barWidth + (barSeries.length - 1) * gap;
    const startX = Math.max(0, (chartInnerWidth - totalWidth) / 2);

    return barSeries.map((item, index) => {
      const value = toNumber(item.netAmount, 0);
      const height = Math.max(6, (value / maxValue) * chartInnerHeight);
      const x = startX + index * (barWidth + gap);
      const y = chartTop + chartInnerHeight - height;
      return {
        ...item,
        x,
        y,
        value,
        height,
        width: barWidth,
        label: formatWeekdayLabel(item.date),
        isPeak: value >= maxValue
      };
    });
  }, [barSeries, chartInnerHeight, chartInnerWidth]);

  const withdrawDisabled = !withdrawValue || !pixKey || !withdrawPassword || !!withdrawError || isProcessingWithdraw;
  const screenBackground = isDarkMode ? '#0C131F' : '#E7EAEA';
  const cardSurface = isDarkMode ? 'rgba(21,31,46,0.9)' : 'rgba(240,243,242,0.92)';
  const cardBorder = isDarkMode ? 'rgba(151,171,198,0.22)' : 'rgba(129,140,145,0.18)';
  const chipIdle = isDarkMode ? 'rgba(32,42,56,0.94)' : '#D8DDDB';
  const chartLineGrid = isDarkMode ? 'rgba(151,171,198,0.16)' : 'rgba(87,101,108,0.14)';
  const positiveDeltaColor = '#1A7F37';
  const negativeDeltaColor = '#B42318';

  const tierLabel = String(earningsData?.tierName || earningsData?.driverTier || 'Gold Tier');

  const activeSegment = useMemo(() => {
    if (activeFilterKey === 'd7') {
      return 'weekly';
    }
    if (activeFilterKey === 'd30' || activeFilterKey === 'custom_range' || activeFilterKey === 'custom') {
      return 'monthly';
    }
    return 'daily';
  }, [activeFilterKey]);

  const periodLabel = useMemo(() => {
    if (!filteredSeries.length) {
      return 'Sem dados';
    }

    const first = parseDateFlexible(filteredSeries[0].date);
    const last = parseDateFlexible(filteredSeries[filteredSeries.length - 1].date);

    if (!first || !last) {
      return 'Sem dados';
    }

    const firstLabel = first.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const lastLabel = last.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
  }, [filteredSeries]);

  const deltaFromYesterday = useMemo(() => {
    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayISO = toISODate(today);
    const yesterdayISO = toISODate(yesterday);
    const todayValue = toNumber(normalizedSeries.find(item => item.date === todayISO)?.netAmount, 0);
    const yesterdayValue = toNumber(normalizedSeries.find(item => item.date === yesterdayISO)?.netAmount, 0);
    return todayValue - yesterdayValue;
  }, [normalizedSeries]);

  const hasPositiveDelta = deltaFromYesterday >= 0;
  const deltaPrefix = hasPositiveDelta ? '+' : '-';
  const deltaAmountLabel = formatCurrency(Math.abs(deltaFromYesterday));
  const activeFilterTitle = useMemo(() => {
    if (activeFilterKey === 'custom_range' || activeFilterKey === 'custom') {
      return 'Período personalizado';
    }
    return FILTER_PRESETS.find(item => item.key === activeFilterKey)?.label || 'Hoje';
  }, [activeFilterKey]);

  function handleBackPress() {
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (typeof navigation?.navigate === 'function') {
      navigation.navigate('RobotaxiPrototype');
    }
  }

  function openCustomFilterModal() {
    setDraftStartDate(customStartDate);
    setDraftEndDate(customEndDate);
    setCustomFilterModalVisible(true);
  }

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'earnings-report',
    occludedBottom: panelHeight,
  });

  function handlePanelLayout(event) {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }

  function applyCustomFilter() {
    const normalizedStart = startOfDay(draftStartDate || customStartDate || new Date());
    const normalizedEnd = startOfDay(draftEndDate || customEndDate || new Date());
    const start = normalizedStart <= normalizedEnd ? normalizedStart : normalizedEnd;
    const end = normalizedStart <= normalizedEnd ? normalizedEnd : normalizedStart;
    setCustomStartDate(start);
    setCustomEndDate(end);
    setActiveFilterKey('custom_range');
    setCustomFilterModalVisible(false);
  }

  function handleSegmentPress(segmentKey) {
    if (segmentKey === 'daily') {
      setActiveFilterKey('today');
      return;
    }
    if (segmentKey === 'weekly') {
      setActiveFilterKey('d7');
      return;
    }
    setActiveFilterKey('d30');
  }

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet
          onClose={handleBackPress}
          backdropColor="transparent"
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Operação financeira"
            title="Ganhos"
            subtitle={
              withdrawalsEnabled
                ? 'Saldo, saques e leitura clara da operação sem ruído visual.'
                : 'Saldo e leitura clara da operação. Repasses do piloto seguem em operação assistida.'
            }
            fullScreen
            style={{
              paddingTop: insets.top + 16,
              paddingBottom: Math.max(insets.bottom, 18),
            }}
            bodyStyle={styles.earningsBody}
            headerAccessory={<PrototypeMenuCloseButton onPress={handleBackPress} />}
          >
            {isLoadingEarnings ? (
              <View style={styles.loadingWrap}>
                <LoadingSpinner message="Carregando seus ganhos..." color={MAIN_COLOR} />
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.earningsScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={false}
              >
                <PrototypeMenuStatRow
                  items={[
                    { key: 'balance', label: 'Saldo', value: `R$ ${formatCurrency(summaryTotalNet)}` },
                    { key: 'rides', label: 'Corridas', value: String(safeTotalRides) },
                    { key: 'fee', label: 'Taxa média', value: `${summaryEffectiveRate.toFixed(2).replace('.', ',')}%` },
                  ]}
                />

                <View style={styles.earningsHint}>
                  <Text style={styles.earningsHintText}>
                    {`${profileName} • Nota ${ratingLabel} • ${tierLabel} • Desde ${partnerSinceLabel}`}
                  </Text>
                  <Text
                    style={[
                      styles.earningsDeltaText,
                      { color: hasPositiveDelta ? '#1A7F37' : '#B42318' },
                    ]}
                  >
                    {`${hasPositiveDelta ? '↗' : '↘'} ${deltaPrefix}R$ ${deltaAmountLabel} vs ontem`}
                  </Text>
                </View>

                {withdrawalsEnabled ? (
                  <TouchableOpacity
                    style={styles.primaryActionButton}
                    activeOpacity={0.86}
                    onPress={() => setWithdrawModalVisible(true)}
                  >
                    <Ionicons name="wallet-outline" size={17} color="#FFFFFF" />
                    <Text style={styles.primaryActionButtonText}>Realizar saque</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.pilotInfoBanner}>
                    <Ionicons name="information-circle-outline" size={18} color="#1A330E" />
                    <Text style={styles.pilotInfoBannerText}>
                      Saque e repasse ficam fora do app neste piloto e serao conduzidos pela operacao assistida.
                    </Text>
                  </View>
                )}

                <PrototypeMenuSection title="Conta">
                  <PrototypeMenuInfoRow label="Motorista" value={profileName} />
                  <PrototypeMenuInfoRow label="Avaliação" value={ratingLabel} />
                  <PrototypeMenuInfoRow label="Categoria" value={tierLabel} />
                  <PrototypeMenuInfoRow label="Taxa diária" value={subscriptionDailyFeeLabel} last />
                </PrototypeMenuSection>

                <PrototypeMenuSection title="Período">
                  {FILTER_PRESETS.map((preset, index) => (
                    <PrototypeMenuRow
                      key={preset.key}
                      icon="calendar-outline"
                      title={preset.label}
                      subtitle={preset.mode === 'today' ? 'Somente hoje' : preset.mode === 'yesterday' ? 'Fechamento de ontem' : `Janela móvel de ${preset.days} dias`}
                      onPress={() => setActiveFilterKey(preset.key)}
                      active={activeFilterKey === preset.key}
                      trailing={
                        activeFilterKey === preset.key ? <Ionicons name="checkmark" size={18} color={tokenColor.accent.strong} /> : null
                      }
                    />
                  ))}
                  <PrototypeMenuRow
                    icon="options-outline"
                    title="Personalizar período"
                    subtitle={activeFilterKey === 'custom_range' ? periodLabel : 'Escolha uma data inicial e final'}
                    onPress={openCustomFilterModal}
                    active={activeFilterKey === 'custom_range'}
                    trailing={
                      activeFilterKey === 'custom_range' ? <Ionicons name="checkmark" size={18} color={tokenColor.accent.strong} /> : <Ionicons name="calendar-outline" size={16} color={tokenColor.text.muted} />
                    }
                    last
                  />
                </PrototypeMenuSection>

                <PrototypeMenuSection title="Movimento do período">
                  <View style={styles.chartHeader}>
                    <Text style={styles.chartTitle}>{activeFilterTitle}</Text>
                    <Text style={styles.chartRange}>{periodLabel}</Text>
                  </View>

                  <View style={styles.chartWrap} onLayout={event => setChartWidth(event.nativeEvent.layout.width)}>
                    {bars.length === 0 ? (
                      <View style={styles.emptyChartWrap}>
                        <Text style={styles.emptyChartText}>Sem dados para o período</Text>
                      </View>
                    ) : (
                      <Svg width={chartInnerWidth} height={chartHeight}>
                        <Line x1={0} y1={chartHeight - chartBottom} x2={chartInnerWidth} y2={chartHeight - chartBottom} stroke="rgba(17,26,39,0.10)" strokeWidth={1} />
                        <Line x1={0} y1={(chartTop + chartHeight - chartBottom) / 2} x2={chartInnerWidth} y2={(chartTop + chartHeight - chartBottom) / 2} stroke="rgba(17,26,39,0.08)" strokeWidth={1} />

                        {bars.map(bar => (
                          <React.Fragment key={bar.key}>
                            <Rect
                              x={bar.x}
                              y={bar.y}
                              width={bar.width}
                              height={bar.height}
                              rx={8}
                              ry={8}
                              fill={bar.isPeak ? '#234E1C' : 'rgba(42,77,29,0.20)'}
                            />
                            <SvgText
                              x={bar.x + (bar.width / 2)}
                              y={bar.y - 8}
                              fontSize="10"
                              fill="#435061"
                              textAnchor="middle"
                              fontWeight="600"
                            >
                              {formatCurrencyCompact(bar.value)}
                            </SvgText>
                            <SvgText
                              x={bar.x + (bar.width / 2)}
                              y={chartHeight - 8}
                              fontSize="10"
                              fill="#6B7889"
                              textAnchor="middle"
                            >
                              {bar.label}
                            </SvgText>
                          </React.Fragment>
                        ))}
                      </Svg>
                    )}
                  </View>
                </PrototypeMenuSection>

                <PrototypeMenuSection title={hasRuntimeHistory ? 'Resumo acumulado' : 'Resumo financeiro'}>
                  <PrototypeMenuInfoRow
                    label={hasRuntimeHistory ? 'Líquido acumulado' : 'Líquido no período'}
                    value={`R$ ${formatCurrency(summaryTotalNet)}`}
                  />
                  <PrototypeMenuInfoRow
                    label={hasRuntimeHistory ? 'Bruto acumulado' : 'Bruto no período'}
                    value={`R$ ${formatCurrency(summaryTotalGross)}`}
                  />
                  <PrototypeMenuInfoRow
                    label="Taxas da plataforma"
                    value={`R$ ${formatCurrency(summaryTotalFee)}`}
                  />
                  <PrototypeMenuInfoRow label="Corridas canceladas" value={String(safeTotalCancellations)} />
                  <PrototypeMenuInfoRow
                    label="Assinatura pendente"
                    value={assinaturaPendente > 0 ? `R$ ${formatCurrency(assinaturaPendente)}` : 'Sem pendência'}
                    last
                  />
                </PrototypeMenuSection>
              </ScrollView>
            )}
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>

      <Modal
        visible={withdrawalsEnabled && withdrawModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setWithdrawModalVisible(false);
          setWithdrawPassword('');
          setWithdrawError('');
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Realizar saque</Text>

            <Text style={styles.modalLabel}>Saldo disponível</Text>
            <Text style={styles.modalBalance}>R$ {formatCurrency(saldoDisponivel)}</Text>
            <Text style={styles.modalLabel}>Taxa diária da assinatura</Text>
            <View style={styles.modalSubscriptionFeeRow}>
              {subscriptionDailyFeeSuspended ? (
                <Text style={styles.modalSubscriptionDailyFeeStruck}>
                  {subscriptionDailyFeeNominalLabel}
                </Text>
              ) : null}
              <Text style={styles.modalSubscriptionDailyFee}>{subscriptionDailyFeeLabel}</Text>
            </View>
            {subscriptionDailyFeeSuspended ? (
              <Text style={styles.modalSubscriptionFeeNote}>
                Suspensa durante a estabilização do app.
              </Text>
            ) : null}

            <Text style={styles.modalLabel}>Valor</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ex: 150,00"
              keyboardType="numeric"
              value={withdrawValue}
              onChangeText={handleWithdrawValueChange}
            />

            <Text style={styles.modalLabel}>Chave Pix</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Informe sua chave"
              value={pixKey}
              onChangeText={setPixKey}
            />

            <Text style={styles.modalLabel}>Senha do app</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Digite sua senha"
              value={withdrawPassword}
              onChangeText={setWithdrawPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
            />

            {withdrawError ? <Text style={styles.modalError}>{withdrawError}</Text> : null}

            <Text style={styles.modalBreakdown}>
              {(() => {
                const amount = toNumber(String(withdrawValue).replace(',', '.'), 0);
                const { fee, subscriptionSettlement, totalDebit } = getWithdrawCostBreakdown(amount);
                const dailyFeeText = subscriptionDailyFeeSuspended
                  ? `${subscriptionDailyFeeLabel} (${subscriptionDailyFeeNominalLabel} suspensa)`
                  : subscriptionDailyFeeLabel;
                return `Taxa de saque: R$ ${formatCurrency(fee)} • Taxa diária: ${dailyFeeText}${
                  subscriptionSettlement > 0 ? ` • Assinatura: R$ ${formatCurrency(subscriptionSettlement)}` : ''
                } • Débito total: R$ ${formatCurrency(totalDebit)}`;
              })()}
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                activeOpacity={0.86}
                onPress={() => {
                  setWithdrawModalVisible(false);
                  setWithdrawPassword('');
                  setWithdrawError('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalConfirmButton, withdrawDisabled && styles.modalConfirmButtonDisabled]}
                activeOpacity={0.86}
                disabled={withdrawDisabled}
                onPress={handleConfirmWithdraw}
              >
                <Text style={styles.modalConfirmText}>{isProcessingWithdraw ? 'Processando...' : 'Confirmar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={customFilterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.customFilterModal}>
            <Text style={styles.modalTitle}>Personalizar filtro</Text>
            <Text style={styles.modalLabel}>Data inicial</Text>
            <View style={styles.datePickerWrap}>
              <DatePicker
                date={draftStartDate}
                mode="date"
                locale="pt-BR"
                onDateChange={nextDate => setDraftStartDate(startOfDay(nextDate))}
                theme="light"
              />
            </View>
            <Text style={styles.modalLabel}>Data final</Text>
            <View style={styles.datePickerWrap}>
              <DatePicker
                date={draftEndDate}
                mode="date"
                locale="pt-BR"
                onDateChange={nextDate => setDraftEndDate(startOfDay(nextDate))}
                theme="light"
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} activeOpacity={0.86} onPress={() => setCustomFilterModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} activeOpacity={0.86} onPress={applyCustomFilter}>
                <Text style={styles.modalConfirmText}>Aplicar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showWithdrawKYCModal}
        animationType="slide"
        onRequestClose={handleWithdrawKYCCancel}
      >
        {isWithdrawKycProviderLoading ? (
          <View style={styles.kycProviderLoadingContainer}>
            <ActivityIndicator size="large" color={MAIN_COLOR} />
            <Text style={styles.kycProviderLoadingText}>Preparando validação facial...</Text>
          </View>
        ) : (
          <>
            {withdrawKycMode === 'aws' ? (
              <AWSLivenessWebViewScreen
                driverId={auth?.profile?.uid}
                challengeId={withdrawStepUpChallenge?.challengeId || null}
                requirement={withdrawStepUpChallenge?.requirement || null}
                onSuccess={handleWithdrawKycAwsSuccess}
                onCancel={handleWithdrawKYCCancel}
                onFallbackLocal={handleWithdrawKycFallbackLocal}
              />
            ) : (
              <KYCCameraScreen onCapture={handleWithdrawKYCCapture} onCancel={handleWithdrawKYCCancel} type="selfie" />
            )}
          </>
        )}

        {withdrawKycReason ? (
          <View style={styles.withdrawKycBanner}>
            <Text style={styles.withdrawKycBannerText}>{withdrawKycReason}</Text>
          </View>
        ) : null}
      </Modal>

      <Modal visible={isProcessingKYCWithdraw} transparent animationType="fade">
        <View style={styles.processingOverlay}>
          <View style={styles.processingCard}>
            <ActivityIndicator size="large" color={MAIN_COLOR} />
            <Text style={styles.processingText}>Validando identidade para concluir saque...</Text>
          </View>
        </View>
      </Modal>
    </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  earningsBody: {
    flex: 1,
  },
  earningsScrollContent: {
    paddingBottom: 12,
  },
  earningsHint: {
    marginBottom: 18,
    paddingTop: 2,
  },
  earningsHintText: {
    color: tokenColor.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  earningsDeltaText: {
    marginTop: 5,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryActionButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: tokenColor.accent.strong,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  primaryActionButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    letterSpacing: 0.12,
  },
  pilotInfoBanner: {
    marginBottom: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(26, 51, 14, 0.10)',
    backgroundColor: 'rgba(26, 51, 14, 0.06)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pilotInfoBannerText: {
    flex: 1,
    color: tokenColor.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  chartHeader: {
    marginBottom: 10,
  },
  chartTitle: {
    color: tokenColor.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  chartRange: {
    marginTop: 2,
    color: tokenColor.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  chartWrap: {
    paddingTop: 6,
    minHeight: 176,
  },
  emptyChartWrap: {
    minHeight: 172,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChartText: {
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    color: tokenColor.text.secondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.36)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16
  },
  modalContent: {
    width: '100%',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 16
  },
  customFilterModal: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 16
  },
  datePickerWrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8E1EB',
    overflow: 'hidden',
    marginBottom: 4,
    backgroundColor: '#FFFFFF'
  },
  modalTitle: {
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    color: '#0F1728',
    marginBottom: 10
  },
  modalLabel: {
    color: '#5E6A7B',
    fontFamily: fonts.Medium,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 6
  },
  modalBalance: {
    color: '#0F1728',
    fontFamily: fonts.Bold,
    fontSize: 24,
    marginBottom: 6
  },
  modalSubscriptionDailyFee: {
    color: '#0F1728',
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    marginBottom: 6
  },
  modalSubscriptionFeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2
  },
  modalSubscriptionDailyFeeStruck: {
    color: '#7A8699',
    fontFamily: fonts.Medium,
    fontSize: 14,
    textDecorationLine: 'line-through'
  },
  modalSubscriptionFeeNote: {
    color: '#5E6A7B',
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6
  },
  modalInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8E1EB',
    paddingHorizontal: 12,
    color: '#101826',
    fontFamily: fonts.Medium,
    fontSize: 15
  },
  modalError: {
    marginTop: 8,
    color: '#B42318',
    fontFamily: fonts.Medium,
    fontSize: 13
  },
  modalBreakdown: {
    marginTop: 10,
    color: '#5E6A7B',
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16
  },
  modalActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10
  },
  modalCancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D5DDE7',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCancelText: {
    color: '#233143',
    fontFamily: fonts.SemiBold,
    fontSize: 14
  },
  modalConfirmButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1A7F37',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalConfirmButtonDisabled: {
    backgroundColor: '#8EB89A'
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 14
  },
  kycProviderLoadingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24
  },
  kycProviderLoadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#111111',
    textAlign: 'center'
  },
  withdrawKycBanner: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  withdrawKycBannerText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600'
  },
  processingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
    paddingHorizontal: 24
  },
  processingCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 18,
    backgroundColor: '#fff',
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 6
  },
  processingText: {
    marginTop: 12,
    color: '#2a2a2a',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600'
  }
});
