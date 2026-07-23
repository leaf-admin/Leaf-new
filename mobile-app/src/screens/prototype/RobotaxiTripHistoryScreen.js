import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import {
  buildTripFinancialTotals,
  formatCurrencyBRL,
  resolveTripDisplayLabel,
} from './tripFinancialSummary';
import { LeafButton, LeafEmptyState } from '../../components/prototype/LeafRideUI';
import BookingHistoryService from '../../services/BookingHistoryService';

const { color, typography } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

export function splitRouteLabel(item) {
  const pickup = String(
    item?.pickup ||
      item?.pickupAddress ||
      item?.pickupLocation?.add ||
      item?.originAddress ||
      '',
  ).trim();
  const dropoff = String(
    item?.destinationAddress ||
      item?.dropoff ||
      item?.dropoffAddress ||
      item?.drop ||
      item?.destinationLocation?.add ||
      '',
  ).trim();
  if (pickup || dropoff) {
    return {
      pickup: pickup || 'Origem indisponível',
      dropoff: dropoff || 'Destino indisponível',
    };
  }

  const routeLabel = String(item?.route || '').trim();
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

  return [
    {
      key: 'rides',
      label: isDriverRole ? 'Concluídas' : 'Viagens',
      value: String(totalTrips),
    },
    {
      key: 'amount',
      label: isDriverRole ? 'Total líquido' : 'Total pago',
      value: totalTrips > 0 ? formatCurrencyBRL(totalAmount) : '--',
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

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[styles.historyRow, last && styles.historyRowLast]}
      testID={`robotaxi-history-row-${item?.id || item?.rideId || 'receipt'}`}
    >
      <View style={styles.historyHeader}>
        <View style={styles.historyHeaderMeta}>
          <View style={styles.historyDateWrap}>
            <Ionicons name="time-outline" size={14} color={color.text.secondary} />
            <Text style={styles.historyDate}>{String(item?.date || 'Registro recente').trim()}</Text>
          </View>
          <View style={styles.historyStatusPill}>
            <Text style={styles.historyStatusPillText}>Concluída</Text>
          </View>
        </View>
        <View style={styles.historyAmountPill}>
          <Text style={styles.historyAmountPillText}>{valueLabel}</Text>
        </View>
      </View>

      <View style={styles.historyCounterpartyRow}>
        <View style={styles.historyCounterpartyAvatar}>
          <Ionicons
            name="person"
            size={14}
            color={isDriverRole ? '#1A330E' : '#365A6D'}
          />
        </View>
        <View style={styles.historyCounterpartyCopy}>
          <Text style={styles.historyCounterpartyLabel}>{counterpartyTitle}</Text>
          <Text style={styles.historyCounterpartyValue}>{counterpartyLabel}</Text>
        </View>
      </View>

      <View style={styles.routeLineWrap}>
        <View style={styles.routeMarkerColumn}>
          <View style={[styles.routeDot, styles.routeDotOrigin]} />
          <View style={styles.routeConnector} />
          <View style={[styles.routeDot, styles.routeDotDestination]} />
        </View>

        <View style={styles.routeCopyWrap}>
          <View>
            <Text style={styles.routeLabel}>Partida</Text>
            <Text style={styles.routeValue}>{routeLabels.pickup}</Text>
          </View>
          <View style={styles.routeSpacer} />
          <View>
            <Text style={styles.routeLabel}>Chegada</Text>
            <Text style={styles.routeValue}>{routeLabels.dropoff}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function RobotaxiTripHistoryScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { activeRole, profileUid } = usePrototypeRideRuntime();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const isDriverRole = activeRole === 'driver';
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });
  const stats = useMemo(() => buildHistoryStats(history, isDriverRole), [history, isDriverRole]);
  const primaryStat = stats[0] || null;
  const secondaryStat = stats[1] || null;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-trip-history',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const loadHistory = useCallback(async ({ append = false, after = null } = {}) => {
    if (!profileUid) {
      setHistoryError('Entre na sua conta para consultar o histórico.');
      setLoadingHistory(false);
      return;
    }

    try {
      append ? setLoadingMore(true) : setLoadingHistory(true);
      setHistoryError('');
      const result = await BookingHistoryService.getBookingHistory(
        profileUid,
        isDriverRole ? 'DRIVER' : 'CUSTOMER',
        { first: 10, after },
      );
      if (!result?.success) {
        throw new Error(result?.error || 'Não foi possível carregar o histórico.');
      }
      const nextBookings = Array.isArray(result.bookings) ? result.bookings : [];
      setHistory(previous => append ? [...previous, ...nextBookings] : nextBookings);
      setPageInfo(result.pageInfo || { hasNextPage: false, endCursor: null });
    } catch (error) {
      setHistoryError(error?.message || 'Não foi possível carregar o histórico.');
    } finally {
      setLoadingHistory(false);
      setLoadingMore(false);
    }
  }, [isDriverRole, profileUid]);

  useEffect(() => {
    loadHistory();
    const removeFocus = navigation?.addListener?.('focus', () => loadHistory());
    return () => removeFocus?.();
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
            title={isDriverRole ? 'Viagens' : 'Histórico'}
            subtitle={
              isDriverRole
                ? 'Recibos, trajetos e valores líquidos em uma leitura direta.'
                : 'Origem, destino e comprovantes das suas últimas viagens.'
            }
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            bodyStyle={styles.body}
            headerAccessory={<PrototypeMenuCloseButton onPress={handleDismiss} />}
          >
            <View style={styles.summaryCardGrid}>
              {primaryStat ? (
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCardLabel}>{primaryStat.label}</Text>
                  <Text style={styles.summaryCardValue}>{primaryStat.value}</Text>
                </View>
              ) : null}
              {secondaryStat ? (
                <View style={[styles.summaryCard, styles.summaryCardAccent]}>
                  <Text style={styles.summaryCardLabel}>{secondaryStat.label}</Text>
                  <Text style={[styles.summaryCardValue, styles.summaryCardValueAccent]}>
                    {secondaryStat.value}
                  </Text>
                </View>
              ) : null}
            </View>

            <PrototypeMenuSection title={isDriverRole ? 'Recibos recentes' : 'Viagens recentes'}>
              <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                {loadingHistory ? (
                  <View style={styles.centerState} testID="robotaxi-history-loading">
                    <ActivityIndicator color="#1A330E" />
                  </View>
                ) : historyError ? (
                  <LeafEmptyState
                    icon="cloud-offline-outline"
                    title="Histórico indisponível"
                    message={historyError}
                    actionLabel="Tentar novamente"
                    onAction={() => loadHistory()}
                    testID="robotaxi-history-error"
                  />
                ) : history.length > 0 ? (
                  <>
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    backgroundColor: 'rgba(255,255,255,0.84)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  summaryCardAccent: {
    backgroundColor: 'rgba(232,239,227,0.9)',
    borderColor: 'rgba(26,51,14,0.12)',
  },
  summaryCardLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryCardValue: {
    marginTop: 6,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 24,
    lineHeight: 28,
  },
  summaryCardValueAccent: {
    color: '#1A330E',
  },
  scroll: {
    maxHeight: 320,
  },
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
    fontFamily: fonts.Medium,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  historyCounterpartyValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  routeValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 14,
    lineHeight: 18,
  },
  routeSpacer: {
    height: 10,
  },
});
