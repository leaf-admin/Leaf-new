import React, { useCallback, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
const FALLBACK_CARD_HEIGHT = 274;

export default function RobotaxiCancellationScreen({ navigation, route }) {
  const { cancelRideSearch } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isCancelling, setIsCancelling] = useState(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const source = route?.params?.source || 'trip';

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-cancellation',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const handleConfirmCancellation = useCallback(async () => {
    if (isCancelling) {
      return;
    }

    try {
      setIsCancelling(true);
      await cancelRideSearch();
      navigation.navigate('RobotaxiPrototype');
    } catch (error) {
      Alert.alert('Nao foi possivel cancelar', error?.message || 'Tente novamente em instantes.');
    } finally {
      setIsCancelling(false);
    }
  }, [cancelRideSearch, isCancelling, navigation]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <View style={styles.iconWrap}>
              <Ionicons name="close-circle-outline" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>Cancelar corrida</Text>
            <Text style={styles.subtitle}>
              {source === 'trip'
                ? 'Ao cancelar agora, vamos encerrar sua solicitacao e retornar ao mapa.'
                : 'Confirme o cancelamento para voltar ao estado inicial.'}
            </Text>

            <View style={styles.warningBox}>
              <Text style={styles.warningText}>Cancelamento pode impactar prioridade em uma nova solicitacao.</Text>
            </View>

            <PrototypePrimaryButton
              label={isCancelling ? 'Cancelando...' : 'Confirmar cancelamento'}
              icon="close-outline"
              onPress={isCancelling ? undefined : handleConfirmCancellation}
              style={styles.cancelButton}
            />

            <TouchableOpacity
              style={styles.keepButton}
              activeOpacity={0.86}
              onPress={handleDismiss}
            >
              <Text style={styles.keepButtonText}>Continuar corrida</Text>
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
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4A5565'
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
  warningBox: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  warningText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textAlign: 'center'
  },
  cancelButton: {
    marginTop: 10,
    backgroundColor: '#3B4553',
    borderColor: '#303945'
  },
  keepButton: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  keepButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
