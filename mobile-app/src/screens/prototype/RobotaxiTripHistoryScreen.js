import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import LeafTouchable from '../../components/design-system/LeafTouchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LeafRootTabs } from '../../components/prototype/PrototypeScaffold';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { ListSkeleton, SkeletonLoader } from '../../components/LoadingStates';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { navigateLeafRootTab } from '../../navigation/leafRootTabNavigation';
import {
  buildTripFinancialTotals,
  formatCurrencyBRL,
  resolveTripDisplayAmount,
  resolveTripDisplayLabel,
  resolveTripTollAmount,
} from './tripFinancialSummary';
import { LeafButton, LeafEmptyState } from '../../components/prototype/LeafRideUI';
import BookingHistoryService, { BOOKING_HISTORY_CACHE_TTL_MS } from '../../services/BookingHistoryService';
import { resolveTripAddressLabel, shortTripAddressLabel } from './tripAddressPresentation';

const { color, typography, motion } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 20;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

export function splitRouteLabel(item) {
  const pickup = resolveTripAddressLabel(
    item?.pickup ||
      item?.pickupAddress ||
      item?.pickupLocation?.add ||
      item?.originAddress ||
      '',
    item?.pickupAddress, item?.pickupLocation, item?.originAddress,
  );
  const dropoff = resolveTripAddressLabel(
    item?.destinationAddress ||
      item?.dropoff ||
      item?.dropoffAddress ||
      item?.drop ||
      item?.destinationLocation?.add ||
      '',
    item?.dropoffAddress, item?.drop, item?.destinationLocation,
  );
  if (pickup || dropoff) {
    return {
      pickup: pickup || 'Origem indisponível',
      dropoff: dropoff || 'Destino indisponível',
    };
  }

  const routeLabel = typeof item?.route === 'string' ? item.route.trim() : '';
  if (/→|->/.test(routeLabel)) {
    const [origin, destination] = routeLabel.split(/\s*(?:→|->)\s*/);
    return {
      pickup: String(origin || '').trim() || 'Origem indisponível',
      dropoff: String(destination || '').trim() || 'Destino indisponível',
    };
  }

  return {
    pickup: routeLabel || 'Origem indisponível',
    dropoff: 'Destino indisponível',
  };
}

function formatHistoryValue(item, isDriverRole) {
  return resolveTripDisplayLabel(item, {
    role: isDriverRole ? 'driver' : 'passenger',
  });
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function isCancelledStatus(item) {
  return ['CANCELLED', 'CANCELED'].includes(String(item?.status || '').toUpperCase());
}

// Period tabs of the statement. The server returns newest first and has no
// date parameter, so the list filters what is loaded and keeps loading older
// pages until the chosen period is covered. "Tudo" pages on demand instead.
const HISTORY_PERIODS = {
  all: { label: 'Tudo', days: null },
  today: { label: 'Hoje', days: 0 },
  '7d': { label: '7 dias', days: 7 },
  '30d': { label: '30 dias', days: 30 },
  month: { label: 'Mês', calendarMonth: true },
};
const PASSENGER_PERIOD_KEYS = ['7d', 'month', 'all'];
const DRIVER_PERIOD_KEYS = ['7d', '30d', 'all'];
const PERIOD_TAB_WIDTH = 84;
const PERIOD_UNDERLINE_WIDTH = 56;

function resolveHistoryItemTimeMs(item) {
  const value = item?.completedAt || item?.date || item?.tripdate || item?.startTime || item?.createdAt;
  if (!value) return NaN;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber > 1e12 ? asNumber : asNumber * 1000;
  return new Date(value).getTime();
}

export function resolveHistoryFilterStartMs(filterKey, nowMs = Date.now()) {
  const filter = HISTORY_PERIODS[filterKey];
  if (!filter || (filter.days === null && !filter.calendarMonth)) return null;
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  if (filter.calendarMonth) start.setDate(1);
  else if (filter.days > 0) start.setDate(start.getDate() - (filter.days - 1));
  return start.getTime();
}

export function filterHistoryByStart(history, startMs) {
  const list = Array.isArray(history) ? history : [];
  if (startMs === null) return list;
  return list.filter((item) => {
    const timeMs = resolveHistoryItemTimeMs(item);
    return Number.isFinite(timeMs) && timeMs >= startMs;
  });
}

function resolvePeriodTabLabel(periodKey, nowMs = Date.now()) {
  if (periodKey !== 'month') return HISTORY_PERIODS[periodKey]?.label || '';
  const name = MONTH_NAMES[new Date(nowMs).getMonth()];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function resolvePeriodTotalLabel(periodKey, isDriverRole, { complete = true, count = 0, nowMs = Date.now() } = {}) {
  const prefix = isDriverRole ? 'Líquido' : 'Pago';
  if (periodKey === '7d') return `${prefix} nos últimos 7 dias`;
  if (periodKey === '30d') return `${prefix} nos últimos 30 dias`;
  if (periodKey === 'month') return `${prefix} em ${MONTH_NAMES[new Date(nowMs).getMonth()]}, até hoje`;
  if (complete) return isDriverRole ? 'Líquido desde a primeira corrida' : 'Pago desde a primeira viagem';
  const noun = isDriverRole ? (count === 1 ? 'corrida' : 'corridas') : count === 1 ? 'viagem' : 'viagens';
  return count === 1 ? `${prefix} na última ${noun}` : `${prefix} nas últimas ${count} ${noun}`;
}

// Statement header: the period total plus receipt lines. A total is shown only
// when each trip has a known role-appropriate amount; the toll and fee lines
// appear only when the loaded receipts carry them.
export function buildHistoryStatement(history, isDriverRole) {
  const list = Array.isArray(history) ? history.filter(Boolean) : [];
  const totals = buildTripFinancialTotals(list, {
    role: isDriverRole ? 'driver' : 'passenger',
  });
  const totalTrips = totals.count;
  const totalAmount = isDriverRole ? totals.totalNet : totals.totalGross;
  const knownAmountCount = isDriverRole ? totals.netKnownCount : totals.grossKnownCount;
  const amount = totalTrips > 0 && knownAmountCount === totalTrips ? totalAmount : null;
  const completed = list.filter((item) => !isCancelledStatus(item));
  const toll = list.reduce((sum, item) => sum + resolveTripTollAmount(item), 0);
  const distance = completed.reduce((sum, item) => {
    const km = Number(item?.distanceKm ?? item?.distance);
    return sum + (Number.isFinite(km) && km > 0 ? km : 0);
  }, 0);
  const lines = [{ key: 'rides', label: isDriverRole ? 'Corridas' : 'Viagens', value: String(completed.length) }];
  if (!isDriverRole && distance > 0) {
    lines.push({ key: 'distance', label: 'Distância', value: `${distance.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km` });
  }
  if (toll > 0) lines.push({ key: 'toll', label: 'Pedágios', value: formatCurrencyBRL(toll) });
  if (isDriverRole && totals.totalFees > 0 && totals.feeKnownCount === totalTrips) {
    lines.push({ key: 'fees', label: 'Taxas', value: `− ${formatCurrencyBRL(totals.totalFees)}` });
  }
  return { amount, lines };
}

function splitCurrency(amount) {
  const [whole, cents] = formatCurrencyBRL(amount).replace(/^R\$\s*/, '').split(',');
  return { whole, cents: `,${cents}` };
}

function resolveDayParts(timeMs, nowMs = Date.now()) {
  if (!Number.isFinite(timeMs)) return { key: 'undated', day: '', week: '', today: false };
  const date = new Date(timeMs);
  const now = new Date(nowMs);
  const today = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return {
    key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    day: String(date.getDate()),
    week: today ? 'hoje' : WEEKDAY_NAMES[date.getDay()],
    today,
  };
}

function formatTime(timeMs) {
  const date = new Date(timeMs);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function PeriodTabs({ keys, activeKey, onChange }) {
  const activeIndex = Math.max(0, keys.indexOf(activeKey));
  const offset = useRef(new Animated.Value(activeIndex * PERIOD_TAB_WIDTH)).current;
  useEffect(() => {
    Animated.timing(offset, {
      toValue: activeIndex * PERIOD_TAB_WIDTH,
      duration: motion.timing.slow,
      easing: Easing.bezier(...motion.bezier.snappy),
      useNativeDriver: true,
    }).start();
  }, [activeIndex, offset]);

  return (
    <View style={styles.periodTabs} accessibilityRole="tablist" testID="robotaxi-history-date-filter">
      {keys.map((key) => {
        const active = key === activeKey;
        const label = resolvePeriodTabLabel(key);
        return (
          <LeafTouchable
            key={key}
            onPress={() => onChange(key)}
            style={styles.periodTab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Período: ${label}`}
            testID={`robotaxi-history-date-filter-${key}`}
          >
            <Text style={[styles.periodTabText, active && styles.periodTabTextActive]}>{label}</Text>
          </LeafTouchable>
        );
      })}
      <Animated.View pointerEvents="none" style={[styles.periodUnderline, { transform: [{ translateX: offset }] }]} />
    </View>
  );
}

function HistoryRow({ item, isDriverRole = false, first = false, showDay = false, onPress }) {
  const routeLabels = splitRouteLabel(item);
  const timeMs = resolveHistoryItemTimeMs(item);
  const dayParts = resolveDayParts(timeMs);
  const amount = resolveTripDisplayAmount(item, { role: isDriverRole ? 'driver' : 'passenger' });
  const cancelled = isCancelledStatus(item);
  const toll = resolveTripTollAmount(item);
  // Placeholder names are not information; show the counterparty only when known.
  const counterpartyName = String(isDriverRole ? item?.passengerName || '' : item?.driverName || '').trim();
  const counterpartyLabel = /^(passageiro|motorista) leaf$/i.test(counterpartyName) ? '' : counterpartyName;
  const pickupLabel = shortTripAddressLabel(routeLabels.pickup);
  const context = toll > 0
    ? `inclui ${formatCurrencyBRL(toll)} de pedágio`
    : isDriverRole && counterpartyLabel
    ? counterpartyLabel
    : pickupLabel && pickupLabel !== 'Origem indisponível'
    ? `de ${pickupLabel}`
    : '';
  const chargedCancel = cancelled && Number(amount) > 0;
  const meta = [chargedCancel ? 'Cancelada' : null, Number.isFinite(timeMs) ? formatTime(timeMs) : null, context]
    .filter(Boolean)
    .join(' · ');
  const valueLabel = cancelled && !chargedCancel ? 'Cancelada' : formatHistoryValue(item, isDriverRole);
  const destination = shortTripAddressLabel(routeLabels.dropoff);
  const rule = first ? null : styles.rowRule;

  return (
    <LeafTouchable
      activeOpacity={0.82}
      onPress={onPress}
      style={styles.tripRow}
      testID={`robotaxi-history-row-${item?.id || item?.rideId || 'receipt'}`}
      accessibilityRole="button"
      accessibilityLabel={[dayParts.today ? 'Hoje' : dayParts.day ? `Dia ${dayParts.day}` : null, destination, valueLabel, cancelled ? 'Cancelada' : null].filter(Boolean).join(', ')}
    >
      <View style={[styles.dayColumn, showDay && rule]}>
        {showDay ? (
          <>
            <Text style={[styles.dayNumber, dayParts.today && styles.dayToday]}>{dayParts.day}</Text>
            <Text style={[styles.dayWeek, dayParts.today && styles.dayWeekToday]}>{dayParts.week}</Text>
          </>
        ) : null}
      </View>
      <View style={[styles.tripBody, rule]}>
        <View style={styles.tripCopy}>
          <Text style={styles.tripDestination} numberOfLines={1}>{destination}</Text>
          {meta ? <Text style={styles.tripDetail} numberOfLines={1}>{meta}</Text> : null}
        </View>
        <Text style={[styles.tripAmount, cancelled && !chargedCancel && styles.tripAmountMuted]}>{valueLabel}</Text>
      </View>
    </LeafTouchable>
  );
}

function ReceiptLine({ label, value }) {
  return (
    <View style={styles.receiptLine}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <View style={styles.receiptLeader} />
      <Text style={styles.receiptValue}>{value}</Text>
    </View>
  );
}

export default function RobotaxiTripHistoryScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const isRootTab = route?.params?.rootTab === true;
  const { height: windowHeight } = useWindowDimensions();
  const { activeRole, profileUid, lastReceipt } = usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const isDriverRole = activeRole === 'driver';
  const historyRole = isDriverRole ? 'DRIVER' : 'CUSTOMER';
  const historyRevision = lastReceipt?.receiptId || lastReceipt?.id || lastReceipt?.rideId || null;
  const historyOwner = JSON.stringify([profileUid, historyRole, historyRevision]);
  const initialHistory = useMemo(() => {
    const options = { first: 10, after: null, ...(historyRevision ? { revision: historyRevision } : {}) };
    const cached = profileUid
      ? BookingHistoryService.getCachedBookingHistory?.(profileUid, historyRole, options)
      : null;
    return {
      owner: historyOwner,
      bookings: cached?.result?.bookings || [],
      pageInfo: cached?.result?.pageInfo || { hasNextPage: false, endCursor: null },
      updatedAt: cached?.updatedAt || 0,
      loaded: Boolean(cached?.result?.success),
      loading: !cached?.result?.success,
      loadingMore: false,
      refreshing: false,
      error: '',
    };
  }, [historyOwner, historyRevision, historyRole, profileUid]);
  const [historyState, setHistoryState] = useState(initialHistory);
  // Never render the previous identity's data while its request is settling.
  const visibleHistory = historyState.owner === historyOwner ? historyState : initialHistory;
  const historyStateRef = useRef(visibleHistory);
  historyStateRef.current = visibleHistory;
  const liveOwnerRef = useRef(historyOwner);
  liveOwnerRef.current = historyOwner;
  const mountedRef = useRef(false);
  const pendingHistoryRef = useRef(null);
  const { bookings: loadedHistory, loading: loadingHistory, loadingMore, refreshing, error: historyError, pageInfo } = visibleHistory;
  const periodKeys = isDriverRole ? DRIVER_PERIOD_KEYS : PASSENGER_PERIOD_KEYS;
  const [chosenPeriodKey, setDateFilterKey] = useState(null);
  // The middle tab (this month, or 30 days for the driver) opens by default.
  const dateFilterKey = periodKeys.includes(chosenPeriodKey) ? chosenPeriodKey : periodKeys[1];
  const dateFilterStartMs = useMemo(() => resolveHistoryFilterStartMs(dateFilterKey), [dateFilterKey]);
  const history = useMemo(
    () => filterHistoryByStart(loadedHistory, dateFilterStartMs),
    [dateFilterStartMs, loadedHistory],
  );
  const isDateFiltered = dateFilterStartMs !== null;
  // Older pages may still hold rides of the chosen period.
  const oldestLoadedMs = loadedHistory.length
    ? resolveHistoryItemTimeMs(loadedHistory[loadedHistory.length - 1])
    : NaN;
  const periodNeedsMorePages = Boolean(
    isDateFiltered &&
      pageInfo?.hasNextPage &&
      (!Number.isFinite(oldestLoadedMs) || oldestLoadedMs >= dateFilterStartMs),
  );
  // A period total is a total only once its pages are loaded.
  const loadingSummary = loadingHistory || periodNeedsMorePages;
  const statement = useMemo(() => buildHistoryStatement(history, isDriverRole), [history, isDriverRole]);
  const totalLabel = resolvePeriodTotalLabel(dateFilterKey, isDriverRole, {
    complete: !pageInfo?.hasNextPage,
    count: history.length,
  });
  const totalParts = statement.amount === null ? null : splitCurrency(statement.amount);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-trip-history',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    if (route?.params?.returnToAccount && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigateLeafRootTab(navigation, 'home');
  }, [navigation, route?.params?.returnToAccount]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const loadHistory = useCallback(async ({ append = false, after = null, forceRefresh = false } = {}) => {
    if (!profileUid) {
      setHistoryState({ ...initialHistory, loading: false, error: 'Entre na sua conta para consultar o histórico.' });
      return;
    }
    const previous = historyStateRef.current;
    if (!append && !forceRefresh && previous.loaded && Date.now() - previous.updatedAt < BOOKING_HISTORY_CACHE_TTL_MS) {
      return;
    }
    if (pendingHistoryRef.current?.owner === historyOwner && !pendingHistoryRef.current.cancelled) return;
    const request = { owner: historyOwner, cancelled: false };
    pendingHistoryRef.current = request;
    const isCurrentRequest = () => mountedRef.current && !request.cancelled && liveOwnerRef.current === historyOwner;
    setHistoryState({
      ...previous,
      loading: !previous.loaded,
      loadingMore: append,
      refreshing: previous.loaded && !append,
      error: '',
    });
    try {
      const result = await BookingHistoryService.getBookingHistory(
        profileUid,
        historyRole,
        { first: 10, after, ...(historyRevision ? { revision: historyRevision } : {}), ...(forceRefresh ? { forceRefresh: true } : {}) },
      );
      if (!isCurrentRequest()) return;
      if (!result?.success) throw new Error(result?.error || 'Não foi possível carregar o histórico.');
      const nextBookings = Array.isArray(result.bookings) ? result.bookings : [];
      setHistoryState(current => ({
        ...current,
        bookings: append ? [...current.bookings, ...nextBookings] : nextBookings,
        pageInfo: result.pageInfo || { hasNextPage: false, endCursor: null },
        updatedAt: Date.now(),
        loaded: true,
        error: '',
      }));
    } catch (error) {
      if (isCurrentRequest()) {
        setHistoryState(current => ({ ...current, error: error?.message || 'Não foi possível carregar o histórico.' }));
      }
    } finally {
      if (isCurrentRequest()) {
        setHistoryState(current => ({ ...current, loading: false, loadingMore: false, refreshing: false }));
      }
      if (pendingHistoryRef.current === request) pendingHistoryRef.current = null;
    }
  }, [historyOwner, historyRevision, historyRole, initialHistory, profileUid]);

  useEffect(() => {
    mountedRef.current = true;
    loadHistory();
    const removeFocus = navigation?.addListener?.('focus', () => loadHistory());
    return () => {
      mountedRef.current = false;
      if (pendingHistoryRef.current) pendingHistoryRef.current.cancelled = true;
      removeFocus?.();
    };
  }, [loadHistory, navigation]);

  useEffect(() => {
    if (!periodNeedsMorePages || loadingHistory || loadingMore || refreshing) return;
    loadHistory({ append: true, after: pageInfo.endCursor });
  }, [loadHistory, loadingHistory, loadingMore, pageInfo?.endCursor, periodNeedsMorePages, refreshing]);

  const openReceipt = useCallback((item) => {
    navigation.navigate('RobotaxiPrototypeReceipt', {
      receipt: item,
      receiptId: item?.receiptId || item?.id,
      bookingId: item?.rideId || item?.id,
      viewerRole: isDriverRole ? 'driver' : 'passenger',
      fromTrip: false,
      fromHistory: true,
    });
  }, [isDriverRole, navigation]);

  const showStatement = loadingHistory || history.length > 0 || (isDateFiltered && periodNeedsMorePages);

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-trip-history-screen"
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow={isDriverRole ? 'Corridas concluídas' : 'Histórico de viagens'}
            title={isRootTab ? 'Atividade' : isDriverRole ? 'Corridas' : 'Viagens e recibos'}
            pageTitle={isRootTab}
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: (isRootTab ? 92 : 0) + Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            bodyStyle={styles.body}
            // Background refresh lives in the header: an inline row above the list
            // pushed every trip down and back up on each visit.
            headerAccessory={<View style={styles.headerAccessory}>
              {refreshing ? <ActivityIndicator size="small" color="#6A6A6A" testID="robotaxi-history-refreshing"
                accessibilityRole="progressbar" accessibilityLabel="Atualizando viagens" /> : null}
              {isRootTab ? null : <PrototypeMenuCloseButton onPress={handleDismiss} />}
            </View>}
          >
            {loadedHistory.length > 0 ? (
              <PeriodTabs keys={periodKeys} activeKey={dateFilterKey} onChange={setDateFilterKey} />
            ) : null}
            {showStatement ? (
              <View style={styles.statement} testID="robotaxi-history-statement">
                <Text style={styles.totalLabel}>{totalLabel}</Text>
                {loadingSummary ? (
                  <View testID="robotaxi-history-summary-loading-amount" accessibilityRole="progressbar" accessibilityLabel="Carregando total das viagens">
                    <SkeletonLoader width={160} height={48} style={{ marginTop: 8 }} />
                    <SkeletonLoader width={220} height={14} style={{ marginTop: 14 }} />
                  </View>
                ) : (
                  <>
                    {totalParts ? (
                      <View style={styles.totalRow} accessible accessibilityLabel={`${totalLabel}: ${formatCurrencyBRL(statement.amount)}`}>
                        <Text style={styles.totalCurrency}>R$</Text>
                        <Text style={styles.totalWhole}>{totalParts.whole}</Text>
                        <Text style={styles.totalCents}>{totalParts.cents}</Text>
                      </View>
                    ) : <Text style={styles.totalUnavailable}>Indisponível</Text>}
                    <View style={styles.receiptLines}>
                      {statement.lines.map((line) => <ReceiptLine key={line.key} label={line.label} value={line.value} />)}
                    </View>
                  </>
                )}
              </View>
            ) : null}

            <View style={[styles.historySection, showStatement && styles.historySectionRuled]}>
              <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                {loadingHistory ? (
                  <View style={styles.centerState} testID="robotaxi-history-loading">
                    <ListSkeleton rows={4} rowHeight={56} />
                  </View>
                ) : historyError && !history.length ? (
                  <LeafEmptyState
                    icon="cloud-offline-outline"
                    title="Histórico indisponível"
                    message={historyError}
                    actionLabel="Tentar novamente"
                    onAction={() => loadHistory({ forceRefresh: true })}
                    testID="robotaxi-history-error"
                  />
                ) : history.length > 0 ? (
                  <>
                  {historyError ? (
                    <LeafTouchable style={styles.refreshStatus} accessibilityRole="button" onPress={() => loadHistory({ forceRefresh: true })} testID="robotaxi-history-refresh-error">
                      <Ionicons name="refresh" size={16} color="#6A6A6A" />
                      <Text style={[styles.tripDetail, { flex: 1 }]}>Não foi possível atualizar. Toque para tentar novamente.</Text>
                    </LeafTouchable>
                  ) : null}
                  {history.map((item, index) => (
                    <HistoryRow
                      key={item?.id || `trip-history-${index}`}
                      item={item}
                      isDriverRole={isDriverRole}
                      first={index === 0}
                      showDay={index === 0 || resolveDayParts(resolveHistoryItemTimeMs(item)).key !== resolveDayParts(resolveHistoryItemTimeMs(history[index - 1])).key}
                      onPress={() => openReceipt(item)}
                    />
                  ))}
                  {pageInfo.hasNextPage && !isDateFiltered ? (
                    <LeafButton
                      label={loadingMore ? 'Carregando...' : 'Carregar mais'}
                      tone="secondary"
                      disabled={loadingMore}
                      onPress={() => loadHistory({ append: true, after: pageInfo.endCursor })}
                    />
                  ) : null}
                  </>
                ) : isDateFiltered && loadedHistory.length > 0 ? (
                  periodNeedsMorePages || loadingMore ? (
                    <View style={styles.centerState} testID="robotaxi-history-filter-loading">
                      <ListSkeleton rows={3} rowHeight={56} />
                    </View>
                  ) : (
                    <LeafEmptyState
                      icon="calendar-outline"
                      title={isDriverRole ? 'Nenhuma corrida neste período' : 'Nenhuma viagem neste período'}
                      message="Escolha outro período para ver mais recibos."
                      actionLabel="Ver tudo"
                      onAction={() => setDateFilterKey('all')}
                      testID="robotaxi-history-filter-empty"
                    />
                  )
                ) : (
                  <LeafEmptyState
                    icon="receipt-outline"
                    title="Nenhuma corrida concluída ainda"
                    message={
                      isDriverRole
                        ? 'Assim que a primeira viagem terminar, ela aparece aqui com valor e trajeto.'
                        : 'Suas viagens encerradas vão aparecer aqui com origem, destino e comprovante.'
                    }
                    testID="robotaxi-history-empty"
                  />
                )}
              </ScrollView>
            </View>
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>
        {isRootTab ? <LeafRootTabs navigation={navigation} insets={insets} active="activity" /> : null}
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  headerAccessory: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  refreshStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  tripRow: { flexDirection: 'row', gap: 8 },
  dayColumn: { width: 40, alignItems: 'center', paddingTop: 10 },
  dayNumber: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: '#222222', fontVariant: ['tabular-nums'] },
  dayToday: { color: '#1A330E' },
  dayWeek: { ...leafTypography.medium, fontSize: 11, lineHeight: 13, color: '#6A6A6A' },
  dayWeekToday: { ...leafTypography.semiBold, color: '#1A330E' },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5' },
  tripBody: { flex: 1, minWidth: 0, minHeight: 58, paddingVertical: 9, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  tripCopy: { flex: 1, minWidth: 0 },
  tripDestination: { ...leafTypography.medium, fontSize: 15, lineHeight: 21, color: '#222222' },
  tripDetail: { ...leafTypography.regular, fontSize: 13, lineHeight: 18, color: '#6A6A6A' },
  tripAmount: { ...leafTypography.semiBold, fontSize: 15, lineHeight: 21, color: '#222222', fontVariant: ['tabular-nums'] },
  tripAmountMuted: { color: '#6A6A6A' },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    flex: 1,
  },
  periodTabs: {
    flexDirection: 'row',
    marginTop: -4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
  },
  periodTab: {
    width: PERIOD_TAB_WIDTH,
    height: 44,
    justifyContent: 'center',
  },
  periodTabText: {
    ...leafTypography.medium,
    fontSize: 14,
    color: '#6A6A6A',
  },
  periodTabTextActive: {
    ...leafTypography.semiBold,
    color: '#1A330E',
  },
  periodUnderline: {
    position: 'absolute',
    left: 0,
    bottom: -1,
    width: PERIOD_UNDERLINE_WIDTH,
    height: 2,
    backgroundColor: '#1A330E',
  },
  statement: {
    marginTop: 20,
    marginBottom: 16,
  },
  totalLabel: {
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
    color: color.text.secondary,
  },
  totalRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  totalCurrency: {
    ...leafTypography.medium,
    marginRight: 6,
    fontSize: 20,
    lineHeight: 24,
    color: '#1A330E',
  },
  totalWhole: {
    ...leafTypography.semiBold,
    fontSize: 54,
    lineHeight: 60,
    letterSpacing: -2.2,
    color: '#1A330E',
    fontVariant: ['tabular-nums'],
  },
  totalCents: {
    ...leafTypography.medium,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: '#56764A',
    fontVariant: ['tabular-nums'],
  },
  totalUnavailable: {
    ...leafTypography.semiBold,
    marginTop: 6,
    fontSize: 24,
    lineHeight: 30,
    color: color.text.primary,
  },
  receiptLines: {
    marginTop: 12,
    gap: 5,
  },
  receiptLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  receiptLabel: {
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#3A3A38',
  },
  // Dotted leader of a printed receipt between the label and its value.
  receiptLeader: {
    flex: 1,
    minWidth: 12,
    marginBottom: 5,
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderColor: '#B9BEB5',
  },
  receiptValue: {
    ...leafTypography.medium,
    fontSize: 14,
    lineHeight: 20,
    color: color.text.primary,
    fontVariant: ['tabular-nums'],
  },
  scroll: {
    flex: 1,
  },
  historySection: { flex: 1, minHeight: 0 },
  historySectionRuled: { borderTopWidth: 1.5, borderTopColor: '#222222' },
  scrollContent: {
    paddingBottom: 6,
  },
  centerState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyRow: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    backgroundColor: 'rgba(255,255,255,0.84)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  historyRowLast: {
    marginBottom: 0,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyHeaderMeta: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  historyDateWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historyDate: {
    color: color.text.secondary,
    ...leafTypography.medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  historyStatusPill: {
    alignSelf: 'flex-start',
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(26,127,55,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(26,127,55,0.14)',
  },
  historyStatusPillText: {
    color: '#1A7F37',
    ...leafTypography.semiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  historyAmountPill: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    backgroundColor: 'rgba(244,247,250,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyAmountPillText: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  historyCounterpartyRow: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    backgroundColor: 'rgba(244,247,250,0.92)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyCounterpartyAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,51,14,0.08)',
  },
  historyCounterpartyCopy: {
    flex: 1,
    minWidth: 0,
  },
  historyCounterpartyLabel: {
    color: color.text.secondary,
    ...leafTypography.semiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  historyCounterpartyValue: {
    marginTop: 2,
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  routeLineWrap: {
    marginTop: 10,
    flexDirection: 'row',
  },
  routeMarkerColumn: {
    width: 16,
    alignItems: 'center',
    paddingTop: 4,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  routeDotOrigin: {
    backgroundColor: '#1C9B63',
  },
  routeDotDestination: {
    backgroundColor: '#E07A22',
  },
  routeConnector: {
    width: 1,
    minHeight: 18,
    flex: 1,
    marginVertical: 4,
    backgroundColor: 'rgba(17,26,39,0.14)',
  },
  routeCopyWrap: {
    flex: 1,
    marginLeft: 10,
  },
  routeLabel: {
    color: color.text.muted,
    ...leafTypography.medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  routeValue: {
    marginTop: 2,
    color: color.text.primary,
    ...leafTypography.medium,
    fontSize: 14,
    lineHeight: 18,
  },
  routeSpacer: {
    height: 10,
  },
});
