import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeIn } from 'react-native-reanimated';
import { useSelector } from 'react-redux';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, DestinationInput, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import WooviPaymentModal from '../../components/payment/WooviPaymentModal';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { DESTINATION_HISTORY } from './robotaxiPrototypeData';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography, touch, motion } = robotaxiPrototypeTokens;
const SEARCH_STEP = 'search';
const QUOTE_STEP = 'quote';
const SEARCH_RESULT_LIMIT = 3;
const SEARCH_BOTTOM_OFFSET = 116;
const SHEET_MIN_BOTTOM_MARGIN = 10;
const SEARCH_FALLBACK_HEIGHT = 308;
const QUOTE_FALLBACK_HEIGHT = 500;
const PLAN_LIST_VIEWPORT_HEIGHT = 206;
const ORIGIN_ADDRESS = '1540 Mission St, San Francisco';
const stepEasing = Easing.bezier(...motion.bezier.snappy);
const DEFAULT_PLAN_RATE_CARDS = Object.freeze({
  plus: {
    name: 'Leaf Plus',
    base_fare: 2.79,
    fixed_fee: 1.1,
    rate_per_hour: 15.6,
    rate_per_unit_distance: 1.53,
    min_fare: 8.5
  },
  elite: {
    name: 'Leaf Elite',
    base_fare: 4.98,
    fixed_fee: 1.8,
    rate_per_hour: 17.4,
    rate_per_unit_distance: 2.41,
    min_fare: 10.5
  },
  moto: {
    name: 'Leaf Moto',
    base_fare: 2.18,
    fixed_fee: 0.86,
    rate_per_hour: 12.17,
    rate_per_unit_distance: 1.19,
    min_fare: 6.9
  }
});

function getPlanIdFromCarName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (normalized.includes('elite') || normalized === 'premium') return 'elite';
  if (normalized.includes('moto') || normalized.includes('motorcycle') || normalized.includes('bike')) return 'moto';
  if (
    normalized.includes('plus') ||
    normalized.includes('standard') ||
    normalized.includes('econ') ||
    normalized === 'basic'
  ) {
    return 'plus';
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

  const subtotal = baseFare + fixedFee + distance * ratePerKm + durationHours * ratePerHour;
  return Number(Math.max(subtotal, minFare).toFixed(2));
}

function formatCurrency(value) {
  return `R$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RobotaxiDestinationScreen({ navigation, route }) {
  const {
    currentAddress,
    currentCoordinate,
    profileUid,
    riderProfile,
    loadDestinationSuggestions,
    selectDestination,
    requestRide,
    clearFlowPreview
  } = usePrototypeRideRuntime();
  const catalogCars = useSelector(state => state?.cartypes?.cars || []);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [step, setStep] = useState(SEARCH_STEP);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('plus');
  const [isPixModalVisible, setPixModalVisible] = useState(false);
  const [submittingRide, setSubmittingRide] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(SEARCH_FALLBACK_HEIGHT);
  const [searchTopAnchor, setSearchTopAnchor] = useState(null);
  const [results, setResults] = useState(DESTINATION_HISTORY);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const executeSearch = async () => {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        setResults(DESTINATION_HISTORY);
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
        }
      }
    };

    const timer = setTimeout(executeSearch, query.trim() ? 240 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadDestinationSuggestions, query]);

  const visibleResults = useMemo(() => {
    return results.slice(0, SEARCH_RESULT_LIMIT);
  }, [results]);

  const destinationInfo = selectedDestination || visibleResults[0] || DESTINATION_HISTORY[0];
  const originAddress = currentAddress || ORIGIN_ADDRESS;
  const destinationCoordinate = destinationInfo?.coordinate || selectedDestination?.coordinate || null;
  const canRequestRide = Boolean(
    Number.isFinite(destinationCoordinate?.latitude) && Number.isFinite(destinationCoordinate?.longitude)
  );

  const durationMin = useMemo(() => {
    const value = Number.parseInt(destinationInfo?.eta || '8', 10);
    return Number.isFinite(value) ? Math.max(4, value + 4) : 9;
  }, [destinationInfo]);

  const distanceKm = useMemo(() => {
    const estimate = durationMin * 0.52;
    return Math.max(1.2, Number(estimate.toFixed(1)));
  }, [durationMin]);

  const arrivalTime = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + durationMin);
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now);
  }, [durationMin]);

  const durationLabel = useMemo(() => {
    return `${durationMin} min`;
  }, [durationMin]);

  const distanceLabel = useMemo(() => {
    return `${Number(distanceKm).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }, [distanceKm]);

  const planRateCards = useMemo(() => {
    if (!Array.isArray(catalogCars) || catalogCars.length === 0) {
      return DEFAULT_PLAN_RATE_CARDS;
    }

    const merged = {
      plus: { ...DEFAULT_PLAN_RATE_CARDS.plus },
      elite: { ...DEFAULT_PLAN_RATE_CARDS.elite },
      moto: { ...DEFAULT_PLAN_RATE_CARDS.moto }
    };

    catalogCars.forEach(car => {
      const planId = getPlanIdFromCarName(car?.name);
      if (!planId) return;

      merged[planId] = {
        ...merged[planId],
        ...car,
        name: car?.name || merged[planId].name
      };
    });

    return merged;
  }, [catalogCars]);

  const plans = useMemo(() => {
    return [
      {
        id: 'plus',
        title: planRateCards.plus?.name || 'Leaf Plus',
        value: calculateBusinessFare(distanceKm, durationMin, planRateCards.plus)
      },
      {
        id: 'elite',
        title: planRateCards.elite?.name || 'Leaf Elite',
        value: calculateBusinessFare(distanceKm, durationMin, planRateCards.elite)
      },
      {
        id: 'moto',
        title: planRateCards.moto?.name || 'Leaf Moto',
        value: calculateBusinessFare(distanceKm, durationMin, planRateCards.moto)
      }
    ];
  }, [distanceKm, durationMin, planRateCards]);
  const selectedPlanData = plans.find(item => item.id === selectedPlan) || plans[0];

  const baseSearchBottomOffset = insets.bottom + SEARCH_BOTTOM_OFFSET;
  const quoteBottomFromSearchAnchor =
    searchTopAnchor == null ? baseSearchBottomOffset : windowHeight - searchTopAnchor - sheetHeight;
  const sheetBottomOffset =
    step === SEARCH_STEP
      ? baseSearchBottomOffset
      : Math.max(insets.bottom + SHEET_MIN_BOTTOM_MARGIN, quoteBottomFromSearchAnchor);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-destination',
    occludedBottom: sheetBottomOffset + sheetHeight
  });

  const handleDismiss = useCallback(() => {
    setPixModalVisible(false);
    clearFlowPreview();
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [clearFlowPreview, navigation]);

  const handleSelectDestination = useCallback(async item => {
    const resolved = await selectDestination(item);
    if (!resolved?.coordinate) {
      Alert.alert('Destino indisponível', 'Não foi possível carregar as coordenadas desse destino agora.');
      return;
    }

    setSelectedDestination(resolved);
    setQuery(resolved.name);
    setStep(QUOTE_STEP);
    setSheetHeight(QUOTE_FALLBACK_HEIGHT);

  }, [selectDestination]);

  const handleBackToSearch = useCallback(() => {
    setStep(SEARCH_STEP);
    setSheetHeight(SEARCH_FALLBACK_HEIGHT);
    clearFlowPreview();
  }, [clearFlowPreview]);

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setSheetHeight(nextHeight);

      if (step === SEARCH_STEP) {
        const nextTopAnchor = windowHeight - baseSearchBottomOffset - nextHeight;
        if (Number.isFinite(nextTopAnchor) && nextTopAnchor > 0) {
          setSearchTopAnchor(nextTopAnchor);
        }
      }
    }
  }, [baseSearchBottomOffset, step, windowHeight]);

  const handleOpenPixModal = useCallback(() => {
    if (!canRequestRide) {
      Alert.alert('Selecione um destino', 'Defina um destino válido antes de solicitar.');
      return;
    }
    setPixModalVisible(true);
  }, [canRequestRide]);

  const handleClosePixModal = useCallback(() => {
    if (submittingRide) {
      return;
    }
    setPixModalVisible(false);
  }, [submittingRide]);

  const handlePixPaymentConfirmed = useCallback(async () => {
    if (submittingRide) {
      return;
    }

    if (!canRequestRide) {
      Alert.alert('Selecione um destino', 'Defina um destino válido antes de confirmar o pagamento.');
      return;
    }

    try {
      setSubmittingRide(true);
      setPixModalVisible(false);

      await requestRide({
        destination: {
          name: destinationInfo?.name || 'Destino',
          address: destinationInfo?.address || '',
          coordinate: destinationCoordinate
        },
        vehicle: selectedPlanData.title,
        fare: selectedPlanData.value,
        paymentMethod: 'pix'
      });

      navigation.replace('RobotaxiPrototypePaymentSuccess', {
        destination: destinationInfo?.name || 'Destino',
        vehicle: selectedPlanData.title,
        autoAdvance: true
      });
    } catch (error) {
      navigation.replace('RobotaxiPrototypePaymentFailed', {
        errorMessage: error?.message || 'Falha ao enviar a corrida para o servidor.',
        retryRouteName: 'RobotaxiPrototypeDestination',
        retryParams: {}
      });
    } finally {
      setSubmittingRide(false);
    }
  }, [
    canRequestRide,
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.name,
    navigation,
    requestRide,
    selectedPlanData.title,
    selectedPlanData.value,
    submittingRide
  ]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottomOffset }]}
          dragHandleZoneHeight={48}
        >
          {step === SEARCH_STEP ? (
            <PrototypeCard onLayout={handleCardLayout} style={styles.searchCard}>
              <CardHandle />

              <Animated.View
                key={SEARCH_STEP}
                entering={FadeIn.duration(motion.timing.standard).easing(stepEasing)}
                style={styles.contentWrap}
              >
                <DestinationInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Para onde você quer ir?"
                  rightIcon="navigate"
                />

                <FlatList
                  data={visibleResults}
                  keyExtractor={item => item.id}
                  contentContainerStyle={styles.listContent}
                  style={styles.list}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    return (
                      <TouchableOpacity
                        style={styles.destinationRow}
                        activeOpacity={0.88}
                        onPress={() => handleSelectDestination(item)}
                      >
                        <View style={styles.destinationIconWrap}>
                          <Ionicons name="location-outline" size={14} color={color.text.primary} />
                        </View>

                        <View style={styles.destinationTextWrap}>
                          <Text numberOfLines={1} style={styles.destinationName}>
                            {item.name}
                          </Text>
                          <Text numberOfLines={1} style={styles.destinationAddress}>
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
                        <ActivityIndicator size="small" color={color.accent.primary} />
                        <Text style={styles.searchingText}>Buscando destinos…</Text>
                      </View>
                    ) : (
                      <Text style={styles.emptyText}>Nenhum destino encontrado.</Text>
                    )
                  }
                />
              </Animated.View>
            </PrototypeCard>
          ) : (
            <Animated.View
              key={QUOTE_STEP}
              entering={FadeIn.duration(motion.timing.standard).easing(stepEasing)}
              style={styles.quoteStack}
              onLayout={handleCardLayout}
            >
              <PrototypeCard style={[styles.searchCard, styles.quoteRouteCard]}>
                <CardHandle />
                <View style={styles.routeBlock}>
                  <View style={styles.routeRow}>
                    <Text style={styles.routeLabel}>Origem</Text>
                    <Text numberOfLines={1} style={styles.routeValue}>
                      {originAddress}
                    </Text>
                  </View>

                  <View style={styles.routeDivider} />

                  <View style={styles.routeRow}>
                    <Text style={styles.routeLabel}>Destino</Text>
                    <Text numberOfLines={1} style={styles.routeValue}>
                      {destinationInfo.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.routeSecondary}>
                      {destinationInfo.address}
                    </Text>
                  </View>
                </View>
              </PrototypeCard>

              <PrototypeCard style={[styles.searchCard, styles.quotePlanCard]}>
                <View style={styles.quoteHeader}>
                  <TouchableOpacity style={styles.backButton} activeOpacity={0.85} onPress={handleBackToSearch}>
                    <Ionicons name="arrow-back" size={17} color={color.text.primary} />
                  </TouchableOpacity>

                  <View style={styles.quoteHeaderText}>
                    <Text style={styles.quoteTitle}>Confirme sua viagem</Text>
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
                  {plans.map(item => {
                    const active = selectedPlan === item.id;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.planRow, active && styles.planRowActive, active && styles.planRowExpanded]}
                        activeOpacity={0.86}
                        onPress={() => setSelectedPlan(item.id)}
                      >
                        <View style={styles.planTextWrap}>
                          <Text style={[styles.planName, active && styles.planNameActive]}>{item.title}</Text>
                          {active ? (
                            <View style={styles.planMetricsRow}>
                              <View style={styles.planMetric}>
                                <Ionicons name="time-outline" size={13} color="#4B5563" />
                                <Text style={styles.planMetricText}>{durationLabel}</Text>
                              </View>

                              <View style={styles.planMetric}>
                                <Ionicons name="map-outline" size={13} color="#4B5563" />
                                <Text style={styles.planMetricText}>{distanceLabel}</Text>
                              </View>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.planRightWrap}>
                          <Text style={[styles.planValue, active && styles.planValueActive]}>{formatCurrency(item.value)}</Text>
                          {active ? <Text style={styles.planArrival}>Chegada {arrivalTime}</Text> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <PrototypePrimaryButton
                  label={`Solicitar ${selectedPlanData.title}`}
                  icon="car-sport-outline"
                  style={styles.submitButton}
                  onPress={handleOpenPixModal}
                />
              </PrototypeCard>
            </Animated.View>
          )}
        </PrototypeDismissibleSheet>

        <WooviPaymentModal
          visible={isPixModalVisible}
          onClose={handleClosePixModal}
          onPaymentConfirmed={handlePixPaymentConfirmed}
          tripData={{
            pickup: {
              add: originAddress,
              lat: currentCoordinate?.latitude,
              lng: currentCoordinate?.longitude
            },
            drop: {
              add: destinationInfo?.address || destinationInfo?.name || 'Destino',
              lat: destinationCoordinate?.latitude,
              lng: destinationCoordinate?.longitude
            },
            carType: selectedPlanData.title,
            estimatedFare: selectedPlanData.value
          }}
          estimates={{ estimateFare: selectedPlanData.value }}
          passengerId={profileUid || 'prototype-passenger'}
          passengerName={riderProfile?.name || 'Passageira Leaf'}
          passengerEmail={riderProfile?.email || 'passageiro@leaf.app.br'}
        />
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  sheetWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  searchCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  contentWrap: {
    marginTop: 2
  },
  quoteStack: {
    gap: 8
  },
  quoteRouteCard: {
    paddingBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: 'rgba(11,16,32,0.14)',
    shadowColor: '#0B1020',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 14
  },
  quotePlanCard: {
    paddingTop: 12,
    height: 350,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: 'rgba(11,16,32,0.14)',
    shadowColor: '#0B1020',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 14
  },
  list: {
    maxHeight: SEARCH_RESULT_LIMIT * 66 + 6,
    marginTop: 10
  },
  listContent: {
    paddingBottom: 2
  },
  destinationRow: {
    minHeight: 58,
    borderRadius: 14,
    marginBottom: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  destinationIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary
  },
  destinationTextWrap: {
    flex: 1,
    marginHorizontal: 10
  },
  destinationName: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  destinationAddress: {
    color: color.text.secondary,
    marginTop: 1,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  destinationEta: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  emptyText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center',
    paddingVertical: 8
  },
  searchingWrap: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8
  },
  searchingText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  quoteHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  backButton: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent'
  },
  quoteHeaderText: {
    marginLeft: 8,
    flex: 1
  },
  quoteTitle: {
    color: '#111827',
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  routeBlock: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(11,16,32,0.12)',
    backgroundColor: '#FFFFFF'
  },
  routeRow: {
    minHeight: 52,
    paddingHorizontal: 10,
    justifyContent: 'center'
  },
  routeLabel: {
    color: '#000000',
    fontFamily: fonts.Bold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  routeValue: {
    marginTop: 2,
    color: '#111827',
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  routeSecondary: {
    marginTop: 1,
    color: '#6B7280',
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  routeDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border.separator
  },
  planListScroll: {
    marginTop: 10,
    height: PLAN_LIST_VIEWPORT_HEIGHT
  },
  planListContent: {
    paddingBottom: 10
  },
  planRow: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(11,16,32,0.1)',
    backgroundColor: '#F5F7FA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6
  },
  planRowActive: {
    borderColor: '#B8C2CF',
    backgroundColor: '#E7ECF3',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.11,
    shadowRadius: 12,
    elevation: 4
  },
  planRowExpanded: {
    minHeight: 82,
    alignItems: 'flex-start',
    paddingVertical: 10
  },
  planTextWrap: {
    flex: 1,
    marginRight: 8
  },
  planName: {
    color: '#111827',
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  planNameActive: {
    color: '#0B1220'
  },
  planMetricsRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  planMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  planMetricText: {
    color: '#4B5563',
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  planRightWrap: {
    minWidth: 104,
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  planValue: {
    color: '#111827',
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  planValueActive: {
    color: '#0B1220'
  },
  planArrival: {
    marginTop: 4,
    color: '#4B5563',
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textAlign: 'right'
  },
  submitButton: {
    marginTop: 10,
    backgroundColor: '#111827',
    borderColor: '#0B1220',
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.26,
    shadowRadius: 14,
    elevation: 10
  }
});
