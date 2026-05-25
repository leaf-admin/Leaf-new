import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
  PrototypeMenuStatRow,
} from '../../components/prototype/PrototypeMenuSurface';
import {
  LeafButton,
  LeafDriverIdentity,
  LeafInfoRow,
  LeafPill,
  LeafProgressBar,
  leafRideColors,
} from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

function resolveStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'started') return 'Em viagem';
  if (normalized === 'arrived') return 'No embarque';
  if (normalized === 'accepted') return 'A caminho';
  if (normalized === 'completed') return 'Concluída';
  return 'Em andamento';
}

function resolveDriver(runtime, route) {
  const driver = runtime.driverInfo || {};
  const booking = runtime.activeBooking || {};
  return {
    name: route?.params?.driverName || driver.name || booking.driverName || 'Motorista Leaf',
    rating: driver.rating ? `${driver.rating} · verificado` : 'Verificado pela Leaf',
    vehicle:
      route?.params?.vehicleModel ||
      driver.vehicleModel ||
      booking.vehicleModel ||
      runtime.selectedVehicle ||
      'Leaf Plus',
    plate:
      route?.params?.vehiclePlate ||
      driver.vehiclePlate ||
      booking.vehiclePlate ||
      booking.plate ||
      '',
  };
}

export default function RobotaxiPublicTripTrackingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const runtime = usePrototypeRideRuntime();

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-public-trip-tracking',
    occludedBottom: panelHeight,
  });

  const driver = useMemo(() => resolveDriver(runtime, route), [runtime, route]);
  const destination =
    route?.params?.destination ||
    runtime.selectedDestination?.name ||
    runtime.selectedDestination?.address ||
    'Destino compartilhado';
  const origin = runtime.currentAddress || route?.params?.originAddress || 'Origem protegida';
  const eta =
    route?.params?.eta ||
    runtime.tripArrivalText ||
    (runtime.tripDurationMin ? `Chega em ${runtime.tripDurationMin} min` : 'ETA em atualização');
  const statusLabel = resolveStatusLabel(runtime.bookingStatus || route?.params?.status);
  const etaStatLabel = eta.replace('Chega em ', '').replace('ETA em atualização', 'Atualizando');
  const statusStatLabel = statusLabel === 'Em andamento' ? 'Em rota' : statusLabel;
  const progress = String(runtime.bookingStatus || '').toLowerCase() === 'started' ? 0.58 : 0.28;

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Splash');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-public-tracking-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Acompanhamento"
            title="Viagem em tempo real"
            subtitle="Prévia pública com dados essenciais, sem telefone ou dados da conta."
            badgeLabel={statusLabel}
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-public-tracking-close-button"
                accessibilityLabel="robotaxi-public-tracking-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <View style={styles.heroCard}>
                <View style={styles.heroHeader}>
                  <Text style={styles.heroTitle}>{eta}</Text>
                  <LeafPill label={statusLabel} tone="leaf" />
                </View>
                <LeafProgressBar progress={progress} />
                <View style={styles.routeBlock}>
                  <LeafInfoRow marker="A" title="Origem" subtitle={origin} subtitleLines={2} />
                  <LeafInfoRow marker="B" title="Destino" subtitle={destination} subtitleLines={2} />
                </View>
              </View>

              <PrototypeMenuSection title="Motorista e veículo">
                <LeafDriverIdentity
                  initial={driver.name.charAt(0).toUpperCase()}
                  name={driver.name}
                  rating={driver.rating}
                  vehicle={driver.vehicle}
                  plate={driver.plate || '--'}
                />
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Resumo público">
                <PrototypeMenuStatRow
                  items={[
                    { key: 'eta', label: 'Previsão', value: etaStatLabel },
                    { key: 'status', label: 'Status', value: statusStatLabel },
                    { key: 'privacy', label: 'Privacidade', value: 'Protegido' },
                  ]}
                />
                <PrototypeMenuInfoRow label="Link" value={route?.params?.publicLink || 'Gerado pelo app'} last />
              </PrototypeMenuSection>

              <LeafButton
                label="Voltar para a viagem"
                tone="primary"
                onPress={handleDismiss}
                style={styles.doneButton}
                testID="robotaxi-public-tracking-back"
                accessibilityLabel="robotaxi-public-tracking-back"
              />
            </ScrollView>
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
  content: {
    paddingTop: 18,
    paddingBottom: 30,
    gap: 18,
  },
  heroCard: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  heroTitle: {
    flex: 1,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 27,
  },
  routeBlock: {
    gap: 12,
    marginTop: 18,
  },
  doneButton: {
    alignSelf: 'stretch',
  },
});
