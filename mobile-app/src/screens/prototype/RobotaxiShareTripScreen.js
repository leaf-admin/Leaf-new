import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuInfoRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';
const DEFAULT_PUBLIC_TRIP_BASE_URL = 'https://leaf.app.br/viagem';

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return DEFAULT_PUBLIC_TRIP_BASE_URL;
  }
  return value.replace(/\/+$/, '');
}

function resolveTripId(route, runtime) {
  return (
    route?.params?.tripId ||
    route?.params?.bookingId ||
    runtime.activeBookingId ||
    runtime.activeBooking?.bookingId ||
    runtime.activeBooking?.id ||
    runtime.lastReceipt?.bookingId ||
    runtime.lastReceipt?.id ||
    `leaf-${Date.now()}`
  );
}

function buildPublicTripLink(tripId) {
  const baseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_PUBLIC_TRIP_BASE_URL);
  return `${baseUrl}/${encodeURIComponent(String(tripId || 'preview'))}`;
}

function resolveDriver(runtime, route) {
  const driver = runtime.driverInfo || {};
  const booking = runtime.activeBooking || {};
  return {
    name: route?.params?.driverName || driver.name || booking.driverName || 'Motorista Leaf',
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

export default function RobotaxiShareTripScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [copied, setCopied] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const runtime = usePrototypeRideRuntime();

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-share-trip',
    occludedBottom: panelHeight,
  });

  const tripId = useMemo(() => resolveTripId(route, runtime), [route, runtime]);
  const publicLink = useMemo(() => buildPublicTripLink(tripId), [tripId]);
  const driver = useMemo(() => resolveDriver(runtime, route), [route, runtime]);
  const destination =
    route?.params?.destination ||
    runtime.selectedDestination?.name ||
    runtime.selectedDestination?.address ||
    'Destino da viagem';
  const eta =
    runtime.tripArrivalText ||
    route?.params?.tripArrivalText ||
    (runtime.tripDurationMin ? `Chega em ${runtime.tripDurationMin} min` : 'ETA em atualização');

  const shareMessage = useMemo(
    () =>
      `Acompanhe minha viagem Leaf em tempo real: ${publicLink}\nDestino: ${destination}\n${eta}`,
    [destination, eta, publicLink],
  );

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  }, [navigation]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(publicLink);
    setCopied(true);
  }, [publicLink]);

  const handleNativeShare = useCallback(async () => {
    try {
      await Share.share({ message: shareMessage, url: publicLink });
    } catch (error) {
      Alert.alert('Não foi possível compartilhar', error?.message || 'Tente novamente em instantes.');
    }
  }, [publicLink, shareMessage]);

  const handleWhatsApp = useCallback(async () => {
    const encoded = encodeURIComponent(shareMessage);
    const whatsappUrl = `whatsapp://send?text=${encoded}`;
    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
        return;
      }
      await Share.share({ message: shareMessage, url: publicLink });
    } catch (error) {
      Alert.alert('Não foi possível abrir o WhatsApp', error?.message || 'Use copiar link por enquanto.');
    }
  }, [publicLink, shareMessage]);

  const handlePreview = useCallback(() => {
    navigation.navigate('RobotaxiPrototypePublicTracking', {
      tripId,
      publicLink,
      destination,
      eta,
      driverName: driver.name,
      vehicleModel: driver.vehicle,
      vehiclePlate: driver.plate,
    });
  }, [destination, driver.name, driver.plate, driver.vehicle, eta, navigation, publicLink, tripId]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-share-trip-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <PrototypeMenuSurface
            onLayout={handlePanelLayout}
            eyebrow="Compartilhar"
            title="Acompanhar viagem"
            subtitle="Envie um link para alguém ver ETA, destino e status sem acessar sua conta."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-share-trip-close-button"
                accessibilityLabel="robotaxi-share-trip-close-button"
              />
            )}
          >
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <View style={styles.linkCard}>
                <Text style={styles.linkLabel}>Link público da viagem</Text>
                <Text style={styles.linkText} numberOfLines={2}>
                  {publicLink}
                </Text>
              </View>

              <View style={styles.primaryActionBlock}>
                <LeafButton
                  label={copied ? 'Copiado' : 'Copiar link'}
                  icon={copied ? 'checkmark-outline' : 'copy-outline'}
                  tone="primary"
                  onPress={handleCopy}
                  style={styles.primaryActionButton}
                  testID="robotaxi-share-copy-link"
                  accessibilityLabel="robotaxi-share-copy-link"
                />
                <LeafButton
                  label={showMoreActions ? 'Ocultar opções' : 'Mais opções'}
                  icon={showMoreActions ? 'chevron-up-outline' : 'ellipsis-horizontal'}
                  tone="ghost"
                  onPress={() => setShowMoreActions(value => !value)}
                  style={styles.moreActionsButton}
                  testID="robotaxi-share-more-actions"
                  accessibilityLabel="robotaxi-share-more-actions"
                />
              </View>

              {showMoreActions ? (
                <View
                  style={styles.actionGrid}
                  testID="robotaxi-share-secondary-actions"
                  accessibilityLabel="robotaxi-share-secondary-actions"
                >
                <LeafButton
                  label="WhatsApp"
                  icon="logo-whatsapp"
                  tone="leaf"
                  onPress={handleWhatsApp}
                  style={styles.actionButton}
                  testID="robotaxi-share-whatsapp"
                  accessibilityLabel="robotaxi-share-whatsapp"
                />
                <LeafButton
                  label="Enviar"
                  icon="share-outline"
                  tone="ghost"
                  onPress={handleNativeShare}
                  style={styles.actionButton}
                  testID="robotaxi-share-native"
                  accessibilityLabel="robotaxi-share-native"
                />
                <LeafButton
                  label="Prévia"
                  icon="eye-outline"
                  tone="ghost"
                  onPress={handlePreview}
                  style={styles.actionButton}
                  testID="robotaxi-share-preview"
                  accessibilityLabel="robotaxi-share-preview"
                />
                </View>
              ) : null}

              <PrototypeMenuSection title="O que aparece para a pessoa">
                <PrototypeMenuInfoRow label="Destino" value={destination} />
                <PrototypeMenuInfoRow label="Previsão" value={eta} />
                <PrototypeMenuInfoRow label="Motorista" value={driver.name} />
                <PrototypeMenuInfoRow label="Veículo" value={driver.plate ? `${driver.vehicle} · ${driver.plate}` : driver.vehicle} last />
              </PrototypeMenuSection>

              <LeafEmptyState
                icon="people-outline"
                title="Aberturas do link"
                message="A tela já reserva o espaço para mostrar quem abriu o acompanhamento. O backend público tokenizado ainda precisa emitir esse evento."
                testID="robotaxi-share-opened-empty-state"
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
  linkCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  linkLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  linkText: {
    marginTop: 6,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  primaryActionBlock: {
    gap: 10,
  },
  primaryActionButton: {
    width: '100%',
  },
  moreActionsButton: {
    width: '100%',
  },
  actionGrid: {
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    width: '48%',
    minWidth: 142,
  },
});
