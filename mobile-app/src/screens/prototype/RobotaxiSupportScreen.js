import leafTypography from '../../components/prototype/LeafTypography';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuRow,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, leafRideColors } from '../../components/prototype/LeafRideUI';
import { LeafObjectIcon } from '../../components/prototype/LeafVisualElements';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';

const { color } = robotaxiPrototypeTokens;
const SURFACE_TOP_PADDING = 20;
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
    return 'RobotaxiPrototype';
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
      accessibilityRole="radio"
      accessibilityLabel={item.title}
      accessibilityHint={item.subtitle}
      accessibilityState={{ checked: active }}
    >
      <View style={styles.optionIconSlot}>
        <LeafObjectIcon name={item.id === 'payment' ? 'payment' : item.id === 'safety' ? 'privacy' : 'help'} size={40} />
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
  const [showSecondaryActions, setShowSecondaryActions] = useState(false);
  const selectedOption = useMemo(() => SUPPORT_OPTIONS.find(item => item.id === selectedOptionId) || SUPPORT_OPTIONS[0], [selectedOptionId]);
  const incidentIsPrimary = selectedOption.id === 'safety';
  const primaryActionLabel = incidentIsPrimary ? 'Registrar incidente' : 'Abrir ticket';
  const primaryActionAccessibilityLabel = supportLoading
    ? 'Enviando solicitação de suporte'
    : incidentIsPrimary
      ? 'Registrar incidente de segurança'
      : `Abrir ticket: ${selectedOption.title}`;
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
  const hasRideChatContext = Boolean(
    supportRideContext.bookingId || supportRideContext.rideId || supportRideContext.tripId,
  );
  const openChatTitle = hasRideChatContext
    ? 'Falar com motorista'
    : supportLastTicket?.id
      ? 'Acompanhar ticket'
      : 'Abrir conversa com suporte';
  const openChatSubtitle = hasRideChatContext
    ? 'Enviar mensagem no chat desta corrida.'
    : 'Usar a thread de atendimento da Leaf.';

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
    if (hasRideChatContext) {
      navigation.replace('RobotaxiPrototypeChat', supportRideContext);
      return;
    }

    if (supportLastTicket?.id) {
      navigation.replace('RobotaxiPrototypeSupportThread', {
        ticketId: supportLastTicket.id,
        ticket: supportLastTicket,
        source: supportRideContext.source || 'prototype-support',
      });
      return;
    }

    navigation.replace('RobotaxiPrototypeSupportTicket', {
      type: selectedOption.id,
      priority: selectedOption.priority,
      severity: selectedOption.severity,
      subject: selectedOption.title,
      description: selectedOption.subtitle,
      source: supportRideContext.source || 'prototype-support',
    });
  }, [
    hasRideChatContext,
    navigation,
    selectedOption.id,
    selectedOption.priority,
    selectedOption.severity,
    selectedOption.subtitle,
    selectedOption.title,
    supportLastTicket,
    supportRideContext,
  ]);

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

  const handlePrimarySupportAction = incidentIsPrimary
    ? handleReportIncident
    : handleCreateTicket;

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="robotaxi-support-screen"
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
                accessibilityLabel="Fechar suporte"
              />
            )}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              <View style={styles.supportLead}>
                <View style={styles.supportLeadCopy}>
                  <Text style={styles.supportLeadTitle}>Como podemos ajudar?</Text>
                  <Text style={styles.supportLeadDetail}>{hasRideChatContext
                    ? 'Ajuda com esta viagem e sua segurança.'
                    : runtime.activeRole === 'driver'
                      ? 'Corridas, repasses e cadastro.'
                      : 'Viagens, Pix e sua conta.'}</Text>
                </View>
                <LeafObjectIcon name="help" size={48} />
              </View>
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

              <View style={styles.actionsBlock}>
                <PrototypePrimaryButton
                  label={supportLoading ? 'Enviando...' : primaryActionLabel}
                  icon={incidentIsPrimary ? 'alert-circle-outline' : 'document-text-outline'}
                  onPress={supportLoading ? undefined : handlePrimarySupportAction}
                  style={styles.primaryButton}
                  testID="robotaxi-support-primary-action"
                  accessibilityLabel={primaryActionAccessibilityLabel}
                />
                <LeafButton
                  label={showSecondaryActions ? 'Ocultar opções' : 'Mais opções'}
                  icon={showSecondaryActions ? 'chevron-up-outline' : 'ellipsis-horizontal'}
                  tone="ghost"
                  onPress={() => setShowSecondaryActions(value => !value)}
                  style={styles.secondaryActionsDisclosure}
                  testID="robotaxi-support-more-actions"
                  accessibilityLabel={showSecondaryActions ? 'Ocultar opções de suporte' : 'Mais opções de suporte'}
                />
              </View>

              {showSecondaryActions ? (
                <PrototypeMenuSection title="Outras formas de ajuda">
                  <PrototypeMenuRow
                    icon="chatbubble-ellipses-outline"
                    title={openChatTitle}
                    subtitle={openChatSubtitle}
                    onPress={handleOpenChat}
                    testID="robotaxi-support-open-chat"
                    accessibilityLabel={openChatTitle}
                    accessibilityHint={openChatSubtitle}
                  />
                  <PrototypeMenuRow
                    icon="warning-outline"
                    title="Abrir reclamação"
                    subtitle="Registrar um relato mais completo com evidências."
                    last
                    onPress={() => navigation.replace('RobotaxiPrototypeComplain', {
                      ...supportRideContext,
                      type: selectedOption.id,
                      priority: selectedOption.priority,
                      severity: selectedOption.severity,
                    })}
                    testID="robotaxi-support-open-complain"
                    accessibilityLabel="Abrir reclamação de suporte"
                    accessibilityHint="Registra um relato detalhado e permite anexar evidências."
                  />
                </PrototypeMenuSection>
              ) : null}

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
  supportLead: { flexDirection: 'row', alignItems: 'flex-start', gap: 18, marginBottom: 8 },
  supportLeadCopy: { flex: 1, minWidth: 0 },
  supportLeadTitle: { ...leafTypography.semiBold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: '#222222' },
  supportLeadDetail: { ...leafTypography.regular, fontSize: 14, lineHeight: 20, color: '#6A6A6A', marginTop: 8 },
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
    minHeight: 78,
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
    width: 54,
    alignItems: 'flex-start',
  },
  optionCopyWrap: {
    flex: 1,
    paddingRight: 10,
  },
  optionTitle: {
    color: leafRideColors.text,
    ...leafTypography.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  optionTitleActive: {
    color: leafRideColors.leaf,
  },
  optionSubtitle: {
    marginTop: 1,
    color: leafRideColors.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  actionsBlock: {
    marginTop: 4,
    gap: 8,
  },
  primaryButton: {
    marginTop: 0,
  },
  secondaryActionsDisclosure: {
    width: '100%',
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
    ...leafTypography.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    marginTop: 8,
    color: leafRideColors.dangerText,
    ...leafTypography.medium,
    fontSize: 12,
    lineHeight: 17,
  },
});
