import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 382;

function formatCurrency(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

export default function RobotaxiDriverPanelScreen({ navigation, route }) {
  const {
    driverOnline,
    setDriverOnline,
    driverOffers,
    activeBookingId,
    selectedDestination,
    selectedFare,
    tripDurationMin,
    currentAddress,
    profileName,
    tripHistory,
    driverActivation,
    driverCanGoOnline
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [activeRequestId, setActiveRequestId] = useState(null);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const requestPool = useMemo(() => {
    if (Array.isArray(driverOffers) && driverOffers.length > 0) {
      return driverOffers;
    }

    if (!activeBookingId) {
      return [];
    }

    return [
      {
        id: activeBookingId,
        bookingId: activeBookingId,
        passenger: profileName || 'Passageiro Leaf',
        pickup: currentAddress || 'Origem atual',
        dropoff: selectedDestination?.name || 'Destino selecionado',
        eta: `${Math.max(2, Math.round(tripDurationMin || 6))} min`,
        payout: formatCurrency(selectedFare || 0),
        fare: Number(selectedFare || 0)
      }
    ];
  }, [activeBookingId, currentAddress, driverOffers, profileName, selectedDestination?.name, selectedFare, tripDurationMin]);

  useEffect(() => {
    if (!requestPool.length) {
      setActiveRequestId(null);
      return;
    }

    const currentExists = requestPool.some(item => item.id === activeRequestId);
    if (!currentExists) {
      setActiveRequestId(requestPool[0].id);
    }
  }, [activeRequestId, requestPool]);

  const activeRequest = useMemo(() => {
    return requestPool.find(item => item.id === activeRequestId) || requestPool[0] || null;
  }, [activeRequestId, requestPool]);

  const todayTrips = Array.isArray(tripHistory) ? tripHistory.length : 0;
  const todayEarnings = useMemo(() => {
    if (!Array.isArray(tripHistory) || tripHistory.length === 0) {
      return 0;
    }
    return tripHistory.reduce((sum, item) => sum + Number(item?.fare || 0), 0);
  }, [tripHistory]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-panel',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleToggleOnline = useCallback(
    value => {
      setDriverOnline(value)
        .then(result => {
          if (result?.blocked) {
            Alert.alert(
              'Ativação pendente',
              'Conclua as etapas de ativação do motorista para ficar online.',
              [
                { text: 'Depois' },
                {
                  text: 'Abrir ativação',
                  onPress: () => navigation.navigate('RobotaxiPrototypeDriverActivation')
                }
              ]
            );
          }
        })
        .catch(() => {});
    },
    [navigation, setDriverOnline]
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.panelCard}>
            <CardHandle />
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>Painel do motorista</Text>
                <Text style={styles.subtitle}>Operação em tempo real</Text>
              </View>

              <View style={styles.statusWrap}>
                <Text style={styles.statusText}>{driverOnline ? 'Online' : driverCanGoOnline ? 'Offline' : 'Ativação pendente'}</Text>
                <Switch
                  value={driverOnline}
                  onValueChange={handleToggleOnline}
                  trackColor={{ false: '#C7D0DA', true: '#2A4D1D' }}
                  thumbColor={driverOnline ? '#1A330E' : '#F7F9FC'}
                />
              </View>
            </View>

            {!driverCanGoOnline ? (
              <TouchableOpacity
                style={styles.activationBanner}
                activeOpacity={0.88}
                onPress={() => navigation.navigate('RobotaxiPrototypeDriverActivation')}
              >
                <Text style={styles.activationBannerTitle}>Concluir ativação</Text>
                <Text style={styles.activationBannerText}>
                  Etapa atual: {driverActivation?.currentStage || 'driver_data_activation'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>4.96</Text>
                <Text style={styles.metricLabel}>Avaliação</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>{todayTrips}</Text>
                <Text style={styles.metricLabel}>Concluídas</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>{formatCurrency(todayEarnings)}</Text>
                <Text style={styles.metricLabel}>Ganhos</Text>
              </View>
            </View>

            <View style={styles.requestsWrap}>
              {requestPool.length > 0 ? (
                requestPool.map(item => {
                  const active = item.id === activeRequestId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      activeOpacity={0.88}
                      style={[styles.requestRow, active && styles.requestRowActive]}
                      onPress={() => setActiveRequestId(item.id)}
                    >
                      <View style={styles.requestTextWrap}>
                        <Text style={styles.requestPassenger}>{item.passenger}</Text>
                        <Text style={styles.requestRoute}>
                          {item.pickup} -> {item.dropoff}
                        </Text>
                      </View>
                      <View style={styles.requestMeta}>
                        <Text style={styles.requestEta}>{item.eta}</Text>
                        <Text style={styles.requestPayout}>{item.payout}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>Nenhuma corrida aguardando aceite agora.</Text>
                </View>
              )}
            </View>

            <PrototypePrimaryButton
              label={activeRequest ? 'Abrir oferta selecionada' : 'Aguardando nova oferta'}
              icon="car-sport-outline"
              onPress={
                activeRequest
                  ? () => navigation.navigate('RobotaxiPrototypeDriverOffer', { request: activeRequest })
                  : undefined
              }
              style={styles.ctaButton}
            />
          </PrototypeCard>
        </PrototypeDismissibleSheet>
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
  panelCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  subtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  statusWrap: {
    alignItems: 'flex-end'
  },
  statusText: {
    marginBottom: 2,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  activationBanner: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    minHeight: 54,
    justifyContent: 'center'
  },
  activationBannerTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  activationBannerText: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  metricsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  metricBox: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  metricValue: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  metricLabel: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  requestsWrap: {
    marginTop: 10,
    gap: 8
  },
  requestRow: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  requestRowActive: {
    borderColor: 'rgba(26,51,14,0.34)',
    backgroundColor: color.surface.activeSoft
  },
  requestTextWrap: {
    flex: 1,
    marginRight: 8
  },
  requestPassenger: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  requestRoute: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  requestMeta: {
    alignItems: 'flex-end'
  },
  requestEta: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  requestPayout: {
    marginTop: 1,
    color: color.accent.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  emptyWrap: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  emptyText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  ctaButton: {
    marginTop: 10
  }
});
