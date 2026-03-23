import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 376;

const HISTORY_ITEMS = [
  { id: 'r1', date: 'Hoje 22:12', route: 'Mission St -> Stanford Shopping Center', value: 'R$ 22,43' },
  { id: 'r2', date: 'Ontem 09:05', route: 'Market St -> Ferry Building', value: 'R$ 14,10' },
  { id: 'r3', date: 'Dom 20:41', route: 'SoMa -> Marina District', value: 'R$ 18,35' }
];

export default function RobotaxiReceiptScreen({ navigation, route }) {
  const { tripHistory, lastReceipt } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const runtimeHistory = tripHistory?.length ? tripHistory : HISTORY_ITEMS;
  const [selectedId, setSelectedId] = useState(runtimeHistory[0]?.id || HISTORY_ITEMS[0].id);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const fromTrip = Boolean(route?.params?.fromTrip);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-receipt',
    occludedBottom: sheetBottom + cardHeight
  });

  useEffect(() => {
    if (lastReceipt?.id) {
      setSelectedId(lastReceipt.id);
      return;
    }

    if (!runtimeHistory.find(item => item.id === selectedId) && runtimeHistory[0]?.id) {
      setSelectedId(runtimeHistory[0].id);
    }
  }, [lastReceipt?.id, runtimeHistory, selectedId]);

  const selected = useMemo(() => {
    return runtimeHistory.find(item => item.id === selectedId) || runtimeHistory[0] || HISTORY_ITEMS[0];
  }, [runtimeHistory, selectedId]);

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

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.receiptCard}>
            <CardHandle />
            <Text style={styles.title}>{fromTrip ? 'Corrida finalizada' : 'Recibos'}</Text>
            <Text style={styles.subtitle}>Resumo financeiro e historico recente</Text>

            <View style={styles.historyWrap}>
              {runtimeHistory.map(item => {
                const active = selected.id === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.88}
                    onPress={() => setSelectedId(item.id)}
                    style={[styles.historyRow, active && styles.historyRowActive]}
                  >
                    <View style={styles.historyTextWrap}>
                      <Text style={styles.historyDate}>{item.date}</Text>
                      <Text numberOfLines={1} style={styles.historyRoute}>
                        {item.route}
                      </Text>
                    </View>
                    <Text style={styles.historyValue}>{item.value}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.detailsBox}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Tarifa base</Text>
                <Text style={styles.detailValue}>R$ {(selected.baseFare ?? 12).toFixed(2)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Distancia e tempo</Text>
                <Text style={styles.detailValue}>R$ {(selected.variableFare ?? 10.43).toFixed(2)}</Text>
              </View>
              <View style={[styles.detailRow, styles.detailRowLast]}>
                <Text style={styles.detailLabelStrong}>Total pago</Text>
                <Text style={styles.detailValueStrong}>{selected.value}</Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.secondaryAction}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeRating', { fromReceipt: true })}
              >
                <Ionicons name="star-outline" size={15} color={color.text.primary} />
                <Text style={styles.secondaryActionText}>Avaliar viagem</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryAction}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeComplain', { fromReceipt: true, receipt: selected })}
              >
                <Ionicons name="warning-outline" size={15} color={color.text.primary} />
                <Text style={styles.secondaryActionText}>Reportar problema</Text>
              </TouchableOpacity>
            </View>

            <PrototypePrimaryButton
              label="Voltar para o mapa"
              icon="map-outline"
              onPress={() => navigation.navigate('RobotaxiPrototype')}
              style={styles.closeButton}
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
  receiptCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
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
  historyWrap: {
    marginTop: 10,
    gap: 8
  },
  historyRow: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center'
  },
  historyRowActive: {
    borderColor: 'rgba(26,51,14,0.34)',
    backgroundColor: color.surface.activeSoft
  },
  historyTextWrap: {
    flex: 1,
    marginRight: 10
  },
  historyDate: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  historyRoute: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  },
  historyValue: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailsBox: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: 'hidden'
  },
  detailRow: {
    minHeight: 40,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  detailRowLast: {
    borderBottomWidth: 0
  },
  detailLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailValue: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  detailLabelStrong: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  detailValueStrong: {
    color: color.accent.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  secondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  secondaryActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  closeButton: {
    marginTop: 10
  }
});
