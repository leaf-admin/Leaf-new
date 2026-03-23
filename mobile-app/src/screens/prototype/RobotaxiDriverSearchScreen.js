import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import DriverSearchRadar from '../../components/prototype/DriverSearchRadar';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 214;
const SEARCH_RADIUS_STAGE_SWITCH_SECONDS = 8;

export default function RobotaxiDriverSearchScreen({ navigation, route }) {
  const { bookingStatus, searchingElapsedSeconds, selectedVehicle, selectedDestination, driverInfo, lastError, cancelRideSearch } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [elapsed, setElapsed] = useState(0);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const terminalRouteHandledRef = useRef(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || selectedDestination?.name || 'Destino';
  const vehicle = route?.params?.vehicle || selectedVehicle || 'Leaf Plus';
  const expandedRadius = elapsed >= SEARCH_RADIUS_STAGE_SWITCH_SECONDS;
  const searchRadiusLabel = expandedRadius ? '5,0 km' : '2,5 km';
  const onlineVehiclesCount = expandedRadius ? 16 : 8;
  const secondsToExpand = Math.max(0, SEARCH_RADIUS_STAGE_SWITCH_SECONDS - elapsed);
  const expansionHint = expandedRadius ? 'Raio máximo de busca ativo' : `Expandindo busca em ${secondsToExpand}s`;

  useEffect(() => {
    setElapsed(searchingElapsedSeconds || 0);
  }, [searchingElapsedSeconds]);

  useEffect(() => {
    if (bookingStatus === 'accepted' || bookingStatus === 'started') {
      navigation.navigate('RobotaxiPrototypeTrip', {
        destination,
        vehicle,
        elapsed,
        driverName: driverInfo?.name || 'Motorista'
      });
    }
  }, [bookingStatus, destination, driverInfo?.name, elapsed, navigation, vehicle]);

  useEffect(() => {
    if (bookingStatus === 'searching' || bookingStatus === 'requesting') {
      terminalRouteHandledRef.current = false;
      return;
    }

    if (terminalRouteHandledRef.current) {
      return;
    }

    if (bookingStatus === 'idle' && lastError) {
      terminalRouteHandledRef.current = true;
      if (/pagamento|payment/i.test(lastError)) {
        navigation.replace('RobotaxiPrototypePaymentFailed', {
          errorMessage: lastError,
          retryRouteName: 'RobotaxiPrototypeDestination',
          retryParams: {}
        });
        return;
      }

      if (/cancelad|cancelled|cancelada/i.test(lastError)) {
        navigation.replace('RobotaxiPrototypeCancellation', {
          source: 'search'
        });
        return;
      }

      navigation.replace('RobotaxiPrototypeNoDrivers', {
        reason: lastError
      });
    }
  }, [bookingStatus, lastError, navigation]);

  const handleDismiss = () => {
    if (bookingStatus === 'searching' || bookingStatus === 'requesting') {
      cancelRideSearch();
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-search',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <View pointerEvents="none" style={styles.radarWrap}>
          <DriverSearchRadar elapsedSeconds={elapsed} />
        </View>

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.searchingCard}>
            <CardHandle />
            <Text style={styles.title}>Procurando motorista</Text>
            <Text style={styles.subtitle}>Veículo: {vehicle}</Text>
            <Text style={styles.subtitle}>Destino: {destination}</Text>
            <Text style={styles.subtitle}>Tempo de busca: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</Text>
            <Text style={styles.subtitle}>Raio atual: {searchRadiusLabel}</Text>
            <Text style={styles.subtitle}>Motoristas online simulados: {onlineVehiclesCount}</Text>
            <Text style={styles.hintText}>{expansionHint}</Text>
            {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}

            <PrototypePrimaryButton
              label={bookingStatus === 'requesting' ? 'Criando corrida...' : 'Cancelar busca'}
              onPress={bookingStatus === 'requesting' ? undefined : handleDismiss}
              icon={bookingStatus === 'requesting' ? 'time-outline' : 'close-circle-outline'}
              style={styles.actionButton}
            />

            <TouchableOpacity
              style={styles.driverPanelShortcut}
              activeOpacity={0.86}
              onPress={() => navigation.navigate('RobotaxiPrototypeDriverPanel')}
            >
              <Text style={styles.driverPanelShortcutText}>Abrir interface do motorista</Text>
            </TouchableOpacity>
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
  radarWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sheetWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  searchingCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    textAlign: 'center'
  },
  subtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center'
  },
  hintText: {
    marginTop: 3,
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textAlign: 'center'
  },
  errorText: {
    marginTop: 8,
    color: '#8A1F2B',
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center'
  },
  actionButton: {
    marginTop: 10
  },
  driverPanelShortcut: {
    marginTop: 8,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  driverPanelShortcutText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
