import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 98;
const FALLBACK_CARD_HEIGHT = 250;

export default function RobotaxiPaymentSuccessScreen({ navigation, route }) {
  const { bookingStatus, selectedDestination, selectedVehicle, driverInfo } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || selectedDestination?.name || 'Destino';
  const vehicle = route?.params?.vehicle || selectedVehicle || 'Leaf Plus';

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-payment-success',
    occludedBottom: sheetBottom + cardHeight
  });

  useEffect(() => {
    if (bookingStatus === 'accepted' || bookingStatus === 'started') {
      navigation.replace('RobotaxiPrototypeTrip', {
        destination,
        vehicle,
        driverName: driverInfo?.name || 'Motorista'
      });
    }
  }, [bookingStatus, destination, driverInfo?.name, navigation, vehicle]);

  useEffect(() => {
    if (route?.params?.autoAdvance === false) {
      return;
    }

    if (bookingStatus !== 'searching' && bookingStatus !== 'requesting') {
      return;
    }

    const timer = setTimeout(() => {
      navigation.replace('RobotaxiPrototypeDriverSearch', { destination, vehicle });
    }, 760);

    return () => clearTimeout(timer);
  }, [bookingStatus, destination, navigation, route?.params?.autoAdvance, vehicle]);

  const handleDismiss = () => {
    navigation.navigate('RobotaxiPrototype');
  };

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

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <View style={styles.iconWrap}>
              <Ionicons name="checkmark" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>Pagamento confirmado</Text>
            <Text style={styles.subtitle}>Corrida criada com sucesso. Agora vamos buscar seu motorista.</Text>

            <PrototypePrimaryButton
              label="Continuar para busca"
              icon="car-sport-outline"
              onPress={() => navigation.replace('RobotaxiPrototypeDriverSearch', { destination, vehicle })}
              style={styles.primaryButton}
            />

            <PrototypePrimaryButton
              label="Voltar ao mapa"
              icon="map-outline"
              onPress={() => navigation.navigate('RobotaxiPrototype')}
              style={styles.secondaryButton}
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
  card: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  iconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent.primary,
    shadowColor: color.shadow.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8
  },
  title: {
    marginTop: 10,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
    textAlign: 'center'
  },
  subtitle: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center'
  },
  primaryButton: {
    marginTop: 12
  },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: color.surface.secondary,
    borderColor: color.border.strong
  }
});
