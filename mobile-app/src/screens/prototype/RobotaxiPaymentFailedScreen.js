import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 244;

export default function RobotaxiPaymentFailedScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const errorMessage = route?.params?.errorMessage || 'Não conseguimos confirmar o pagamento desta vez.';
  const retryRouteName = route?.params?.retryRouteName || 'RobotaxiPrototypeDestination';
  const retryParams = route?.params?.retryParams || {};

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-payment-failed',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    navigation.navigate('RobotaxiPrototype');
  };

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <View style={styles.iconWrap}>
              <Ionicons name="warning-outline" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>Pagamento não confirmado</Text>
            <Text style={styles.subtitle}>{errorMessage}</Text>

            <PrototypePrimaryButton
              label="Tentar novamente"
              icon="refresh-outline"
              onPress={() => navigation.replace(retryRouteName, retryParams)}
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
    left: 0,
    right: 0
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16
  },
  iconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.text.primary,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 8
  },
  title: {
    marginTop: 10,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
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
