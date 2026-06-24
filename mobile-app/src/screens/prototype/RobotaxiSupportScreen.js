import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { leafRideColors } from '../../components/prototype/LeafRideUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';

const { color } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

const SUPPORT_OPTIONS = [
  {
    id: 'payment',
    aliases: ['billing', 'pix', 'payment', 'receipt'],
    title: 'Problema com Pix',
    subtitle: 'Revisão de cobrança e recibo da viagem',
    icon: 'card-outline',
    priority: 'N2',
    severity: 'payment',
  },
  {
    id: 'lost_item',
    aliases: ['lost_item', 'lost-items', 'objects', 's3'],
    title: 'Objetos perdidos',
    subtitle: 'Abra um chamado rápido para itens esquecidos',
    icon: 'briefcase-outline',
    priority: 'N3',
    severity: 'support',
  },
  {
    id: 'safety',
    aliases: ['safety', 'sos', 'emergency'],
    title: 'Segurança',
    subtitle: 'Sinalização prioritária durante ou após a corrida',
    icon: 'shield-checkmark-outline',
    priority: 'N1',
    severity: 'safety',
  },
];

function pickSupportText(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(Boolean) || '';
}

function resolveSupportRideContext(routeParams = {}, runtime = {}) {
  const receipt = routeParams?.receipt || null;
  const bookingId = pickSupportText(
    routeParams?.bookingId,
    routeParams?.activeBookingId,
    routeParams?.rideId,
    routeParams?.tripId,
    receipt?.bookingId,
    receipt?.id,
    runtime?.activeBookingId,
    runtime?.driverActiveRide?.bookingId,
    runtime?.driverActiveRide?.id,
    runtime?.activeBooking?.bookingId,
    runtime?.activeBooking?.id,
    runtime?.driverTripMeta?.bookingId,
    runtime?.driverTripMeta?.rideId,
  );
  const bookingStatus = normalizeRuntimeRideStatus(pickSupportText(
    routeParams?.bookingStatus,
    routeParams?.status,
    runtime?.bookingStatus,
    runtime?.driverActiveRide?.status,
    runtime?.activeBooking?.status,
  ));

  return {
    ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
    source: pickSupportText(routeParams?.source, bookingId ? 'active-ride-support' : 'support'),
    ...(bookingStatus ? { bookingStatus } : {}),
  };
}

function resolveInitialSupportOptionId(routeParams = {}) {
  const requestedTopic = pickSupportText(
    routeParams?.initialTopicId,
    routeParams?.topicId,
    routeParams?.type,
  ).toLowerCase();

  if (!requestedTopic) {
    return SUPPORT_OPTIONS[0].id;
  }

  return (
    SUPPORT_OPTIONS.find(item =>
      item.id === requestedTopic ||
      item.aliases?.some(alias => alias.toLowerCase() === requestedTopic)
    )?.id || SUPPORT_OPTIONS[0].id
  );
}

function resolveSupportReturnRoute(context = {}) {
  const source = String(context.source || '').toLowerCase();
  const status = normalizeRuntimeRideStatus(context.bookingStatus);

  if (source === 'receipt' || status === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (source === 'driver-trip') {
    return 'RobotaxiPrototypeDriverTrip';
  }
  if (context.bookingId) {
    return 'RobotaxiPrototypeTrip';
  }
  return 'RobotaxiPrototype';
}

function SupportOptionRow({ item, active, onPress, rowTestID, last = false }) {
  return (
    <TouchableOpacity
      style={[styles.optionRow, active && styles.optionRowActive, last && styles.optionRowLast]}
      activeOpacity={0.78}
      onPress={onPress}
      testID={rowTestID}
      accessibilityLabel={rowTestID}
    >
      <View style={styles.optionIconSlot}>
        <Ionicons name={item.icon} size={18} color={active ? leafRideColors.leaf : leafRideColors.text} />
      </View>
      <View style={styles.optionCopyWrap}>
        <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{item.title}</Text>
        <Text style={styles.optionSubtitle}>{item.subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={color.text.muted} />
    </TouchableOpacity>
  );
}

export default function RobotaxiSupportScreen({ navigation, route }) {
  const runtime = usePrototypeRideRuntime();
  const { reportIncident, supportLoading, supportError, supportLastTicket, supportLastIncident } = runtime;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const [selectedOptionId, setSelectedOptionId] = useState(() => resolveInitialSupportOptionId(route?.params));
  const selectedOption = useMemo(() => SUPPORT_OPTIONS.find(item => item.id === selectedOptionId) || SUPPORT_OPTIONS[0], [selectedOptionId]);
  const supportRideContext = useMemo(
    () => resolveSupportRideContext(route?.params, runtime),
    [
      route?.params,
      runtime.activeBookingId,
      runtime.bookingStatus,
      runtime.driverActiveRide,
      runtime.activeBooking,
      runtime.driverTripMeta,
    ],
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-support',
    occludedBottom: panelHeight,
  });

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate(resolveSupportReturnRoute(supportRideContext), supportRideContext);
  }, [navigation, supportRideContext]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleCreateTicket = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeSupportTicket', {
      type: selectedOption.id,
      priority: selectedOption.priority,
      severity: selectedOption.severity,
      subject: selectedOption.title,
      description: selectedOption.subtitle,
      ...supportRideContext,
    });
  }, [
    navigation,
    selectedOption.id,
    selectedOption.priority,
    selectedOption.severity,
    selectedOption.subtitle,
    selectedOption.title,
    supportRideContext,
  ]);

  const handleOpenChat = useCallback(() => {
    if (supportRideContext.bookingId || supportRideContext.rideId || supportRideContext.tripId) {
      navigation.replace('RobotaxiPrototypeChat', supportRideContext);
      return;
    }

    navigation.replace('Support', {
      initialTab: 'chat',
      source: supportRideContext.source || 'prototype-support',
    });
  }, [navigation, supportRideContext]);

  const handleReportIncident = useCallback(async () => {
    try {
      await reportIncident({
        type: selectedOption.id,
        priority: selectedOption.priority,
        severity: selectedOption.severity,
        description: selectedOption.title,
        subject: selectedOption.title,
        ...supportRideContext,
      });
      Alert.alert('Incidente registrado', 'Recebemos sua sinalização de segurança.');
    } catch (error) {
      Alert.alert('Não foi possível registrar', error?.message || 'Tente novamente em instantes.');
    }
  }, [reportIncident, selectedOption.id, selectedOption.priority, selectedOption.severity, selectedOption.title, supportRideContext]);

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-support-screen"
        accessibilityLabel="robotaxi-support-screen"
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
            eyebrow="Ajuda e segurança"
            title="Suporte"
            subtitle="Escolha como deseja ajuda nesta corrida e siga para o canal certo."
            fullScreen
            style={{
              paddingTop: insets.top + SURFACE_TOP_PADDING,
              paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
            }}
            bodyStyle={styles.body}
            headerAccessory={(
              <PrototypeMenuCloseButton
                onPress={handleDismiss}
                testID="robotaxi-support-close-button"
                accessibilityLabel="robotaxi-support-close-button"
              />
            )}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              <PrototypeMenuSection title="Assuntos">
                {SUPPORT_OPTIONS.map((item, index) => (
                  <SupportOptionRow
                    key={item.id}
                    item={item}
                    active={item.id === selectedOptionId}
                    onPress={() => setSelectedOptionId(item.id)}
                    rowTestID={`robotaxi-support-option-${item.id}`}
                    last={index === SUPPORT_OPTIONS.length - 1}
                  />
                ))}
              </PrototypeMenuSection>

              <PrototypeMenuSection title="Canais">
                <PrototypeMenuRow
                  icon="chatbubble-ellipses-outline"
                  title="Falar no chat"
                  subtitle="Abrir conversa em tempo real com motorista ou suporte."
                  onPress={handleOpenChat}
                  testID="robotaxi-support-open-chat"
                  accessibilityLabel="robotaxi-support-open-chat"
                />
                <PrototypeMenuRow
                  icon="warning-outline"
                  title="Abrir reclamacao"
                  subtitle="Registrar um relato mais completo com evidências."
                  last
                  onPress={() => navigation.replace('RobotaxiPrototypeComplain', {
                    ...supportRideContext,
                    type: selectedOption.id,
                    priority: selectedOption.priority,
                    severity: selectedOption.severity,
                  })}
                  testID="robotaxi-support-open-complain"
                  accessibilityLabel="robotaxi-support-open-complain"
                />
              </PrototypeMenuSection>

              <View style={styles.actionsBlock}>
                <PrototypePrimaryButton
                  label={supportLoading ? 'Enviando...' : 'Registrar incidente'}
                  icon="alert-circle-outline"
                  onPress={supportLoading ? undefined : handleReportIncident}
                  style={styles.primaryButton}
                  testID="robotaxi-support-report-incident"
                  accessibilityLabel="robotaxi-support-report-incident"
                />
                <PrototypePrimaryButton
                  label={supportLoading ? 'Enviando...' : 'Abrir ticket'}
                  icon="document-text-outline"
                  onPress={supportLoading ? undefined : handleCreateTicket}
                  style={styles.primaryButton}
                  testID="robotaxi-support-open-ticket"
                  accessibilityLabel="robotaxi-support-open-ticket"
                />
              </View>

              {supportLoading ? (
                <View style={styles.feedbackRow}>
                  <ActivityIndicator size="small" color={color.accent.primary} />
                  <Text style={styles.feedbackText}>Sincronizando com suporte...</Text>
                </View>
              ) : null}
              {supportLastTicket?.id ? <Text style={styles.feedbackText}>Ticket recente: #{supportLastTicket.id}</Text> : null}
              {supportLastIncident?.id ? <Text style={styles.feedbackText}>Incidente recente: #{supportLastIncident.id}</Text> : null}
              {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
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
  body: {
    flex: 1,
  },
  content: {
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  optionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: leafRideColors.line,
  },
  optionRowActive: {
    backgroundColor: leafRideColors.bg,
  },
  optionRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  optionIconSlot: {
    width: 28,
    alignItems: 'flex-start',
  },
  optionCopyWrap: {
    flex: 1,
    paddingRight: 10,
  },
  optionTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 19,
  },
  optionTitleActive: {
    color: leafRideColors.leaf,
  },
  optionSubtitle: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  actionsBlock: {
    marginTop: 4,
    gap: 8,
  },
  primaryButton: {
    marginTop: 0,
  },
  feedbackRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    marginTop: 8,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 17,
  },
});
