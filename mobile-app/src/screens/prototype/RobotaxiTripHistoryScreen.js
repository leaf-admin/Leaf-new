import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LeafRootTabs } from '../../components/prototype/PrototypeScaffold';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { ListSkeleton, SkeletonLoader } from '../../components/LoadingStates';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import {
  buildTripFinancialTotals,
  formatCurrencyBRL,
  resolveTripDisplayLabel,
} from './tripFinancialSummary';
import { LeafButton, LeafEmptyState } from '../../components/prototype/LeafRideUI';
import BookingHistoryService, { BOOKING_HISTORY_CACHE_TTL_MS } from '../../services/BookingHistoryService';
import { formatTripDateLabel, resolveTripAddressLabel } from './tripAddressPresentation';

const { color, typography } = robotaxiPrototypeTokens;
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

function buildHistoryStats(history, isDriverRole) {
  const totals = buildTripFinancialTotals(history, {
    role: isDriverRole ? 'driver' : 'passenger',
  });
  const totalTrips = totals.count;
  const totalAmount = isDriverRole ? totals.totalNet : totals.totalGross;
  const knownAmountCount = isDriverRole ? totals.netKnownCount : totals.grossKnownCount;

  return [
    {
      key: 'rides',
      label: isDriverRole ? 'Concluídas' : 'Viagens',
      value: String(totalTrips),
    },
    {
      key: 'amount',
      label: isDriverRole ? 'Total líquido' : 'Total pago',
      value:
        totalTrips > 0 && knownAmountCount === totalTrips
          ? formatCurrencyBRL(totalAmount)
          : 'Indisponível',
    },
  ];
}

function HistoryRow({ item, isDriverRole = false, last = false, onPress }) {
  const routeLabels = splitRouteLabel(item);
  const valueLabel = formatHistoryValue(item, isDriverRole);
  const counterpartyLabel = isDriverRole
    ? String(item?.passengerName || 'Passageiro Leaf').trim()
    : String(item?.driverName || 'Motorista Leaf').trim();
  const counterpartyTitle = isDriverRole ? 'Passageiro' : 'Motorista';
  const distance = Number(item?.distanceKm ?? item?.distance);
  const duration = Number(item?.durationMinutes ?? item?.duration);
  const metrics = [Number.isFinite(distance) && distance > 0 ? `${distance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : null,
    Number.isFinite(duration) && duration > 0 ? `${Math.round(duration)} min` : null].filter(Boolean).join(' · ');
  const status = String(item?.status || '').toUpperCase();
  const statusLabel = ['COMPLETE', 'COMPLETED'].includes(status) ? 'Concluída' : ['CANCELLED', 'CANCELED'].includes(status) ? 'Cancelada' : 'Registro da viagem';

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[styles.tripRow, last && styles.tripRowLast]}
      testID={`robotaxi-history-row-${item?.id || item?.rideId || 'receipt'}`}
    >
      <LeafObjectIcon name="activity" size={64} />
      <View style={styles.tripCopy}>
        <Text style={styles.tripDestination} numberOfLines={2}>{routeLabels.dropoff}</Text>
        <Text style={styles.tripDetail}>{formatTripDateLabel(item?.date || item?.completedAt || item?.createdAt)}</Text>
        {metrics ? <Text style={styles.tripDetail}>{metrics}</Text> : null}
        <Text style={styles.tripAmount}>{valueLabel} · {isDriverRole ? 'líquido' : 'total pago'}</Text>
        <Text style={styles.tripDetail} numberOfLines={2}>Partida: {routeLabels.pickup}</Text>
        <Text style={styles.tripDetail}>{counterpartyTitle}: {counterpartyLabel}</Text>
        <Text style={styles.tripStatus}>{statusLabel}</Text>
      </View>
      <Ionicons name="chevron-forward" size={13} color="#6A6A6A" />
    </TouchableOpacity>
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
  const { bookings: history, loading: loadingHistory, loadingMore, refreshing, error: historyError, pageInfo } = visibleHistory;
  const stats = useMemo(() => buildHistoryStats(history, isDriverRole), [history, isDriverRole]);
  const primaryStat = stats[0] || null;
  const secondaryStat = stats[1] || null;

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
    navigation.navigate('RobotaxiPrototype');
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
            title={isRootTab ? 'Atividade' : isDriverRole ? 'Viagens' : 'Histórico'}
            pageTitle={isRootTab}
            subtitle={
              isDriverRole
                ? 'Recibos, trajetos e valores líquidos em uma leitura direta.'
                : 'Origem, destino e comprovantes das suas últimas viagens.'
            }
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: (isRootTab ? 92 : 0) + Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            bodyStyle={styles.body}
            headerAccessory={isRootTab ? null : <PrototypeMenuCloseButton onPress={handleDismiss} />}
          >
            {loadingHistory || history.length > 0 ? <View style={styles.summaryCardGrid}>
              {primaryStat ? (
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCardLabel}>{primaryStat.label}</Text>
                  {loadingHistory ? (
                    <View testID="robotaxi-history-summary-loading-rides" accessibilityRole="progressbar" accessibilityLabel="Carregando número de viagens">
                      <SkeletonLoader width={48} height={28} style={{ marginTop: 6 }} />
                    </View>
                  ) : <Text style={styles.summaryCardValue}>{primaryStat.value}</Text>}
                </View>
              ) : null}
              {secondaryStat ? (
                <View style={[styles.summaryCard, styles.summaryCardAccent]}>
                  <Text style={styles.summaryCardLabel}>{secondaryStat.label}</Text>
                  {loadingHistory ? (
                    <View testID="robotaxi-history-summary-loading-amount" accessibilityRole="progressbar" accessibilityLabel="Carregando total das viagens">
                      <SkeletonLoader width={112} height={28} style={{ marginTop: 6 }} />
                    </View>
                  ) : <Text style={[styles.summaryCardValue, styles.summaryCardValueAccent]}>
                    {secondaryStat.value}
                  </Text>}
                </View>
              ) : null}
            </View> : null}

            <PrototypeMenuSection title={isDriverRole ? 'Recibos recentes' : 'Viagens recentes'} style={styles.historySection}>
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
                  {refreshing ? (
                    <View style={styles.refreshStatus} accessibilityRole="progressbar" testID="robotaxi-history-refreshing">
                      <ActivityIndicator size="small" color="#6A6A6A" />
                      <Text style={styles.tripDetail}>Atualizando viagens…</Text>
                    </View>
                  ) : null}
                  {historyError ? (
                    <TouchableOpacity style={styles.refreshStatus} accessibilityRole="button" onPress={() => loadHistory({ forceRefresh: true })} testID="robotaxi-history-refresh-error">
                      <Ionicons name="refresh" size={16} color="#6A6A6A" />
                      <Text style={[styles.tripDetail, { flex: 1 }]}>Não foi possível atualizar. Toque para tentar novamente.</Text>
                    </TouchableOpacity>
                  ) : null}
                  {history.map((item, index) => (
                    <HistoryRow
                      key={item?.id || `trip-history-${index}`}
                      item={item}
                      isDriverRole={isDriverRole}
                      last={index === history.length - 1}
                      onPress={() => openReceipt(item)}
                    />
                  ))}
                  {pageInfo.hasNextPage ? (
                    <LeafButton
                      label={loadingMore ? 'Carregando...' : 'Carregar mais'}
                      tone="secondary"
                      disabled={loadingMore}
                      onPress={() => loadHistory({ append: true, after: pageInfo.endCursor })}
                    />
                  ) : null}
                  </>
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
            </PrototypeMenuSection>
          </PrototypeMenuSurface>
        </PrototypeDismissibleSheet>
        {isRootTab ? <LeafRootTabs navigation={navigation} insets={insets} active="activity" /> : null}
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  refreshStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  tripRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
  tripRowLast: { borderBottomWidth: 0 },
  tripCopy: { flex: 1, minWidth: 0, gap: 6 },
  tripDestination: { ...leafTypography.semiBold, fontSize: 16, lineHeight: 22, color: '#222222' },
  tripDetail: { ...leafTypography.regular, fontSize: 13, lineHeight: 18, color: '#6A6A6A' },
  tripAmount: { ...leafTypography.medium, fontSize: 14, lineHeight: 20, color: '#222222' },
  tripStatus: { ...leafTypography.regular, fontSize: 12, lineHeight: 17, color: '#6A6A6A' },
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
  summaryCardGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    minHeight: 86,
    borderRadius: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5E5',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  summaryCardAccent: {
    backgroundColor: 'transparent',
    borderColor: '#E5E5E5',
  },
  summaryCardLabel: {
    color: color.text.secondary,
    ...leafTypography.semiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryCardValue: {
    marginTop: 6,
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 24,
    lineHeight: 28,
  },
  summaryCardValueAccent: {
    color: '#1A330E',
  },
  scroll: {
    flex: 1,
  },
  historySection: { flex: 1, minHeight: 0, marginBottom: 0 },
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
