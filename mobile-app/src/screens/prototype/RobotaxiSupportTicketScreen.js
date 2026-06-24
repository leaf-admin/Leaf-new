import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuSection,
  PrototypeMenuSurface,
} from '../../components/prototype/PrototypeMenuSurface';
import { LeafButton, LeafEmptyState, leafRideColors } from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';

const SURFACE_TOP_PADDING = 16;
const SURFACE_BOTTOM_PADDING = 18;
const BACKDROP_COLOR = 'transparent';

const TICKET_TYPES = [
  {
    id: 'payment',
    title: 'Pagamento',
    subtitle: 'Cobrança, estorno ou recibo',
    icon: 'card-outline',
  },
  {
    id: 'trip',
    title: 'Viagem',
    subtitle: 'Embarque, rota ou motorista',
    icon: 'car-outline',
  },
  {
    id: 'safety',
    title: 'Segurança',
    subtitle: 'Relato prioritário',
    icon: 'shield-checkmark-outline',
  },
];

function pickTicketContextText(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(Boolean) || '';
}

function resolveTicketReturnRoute(context = {}) {
  const source = String(context.source || '').toLowerCase();
  const status = normalizeRuntimeRideStatus(context.bookingStatus);

  if (source === 'receipt' || status === 'completed') {
    return 'RobotaxiPrototypeReceipt';
  }
  if (source === 'driver-trip') {
    return 'RobotaxiPrototypeDriverTrip';
  }
  if (context.bookingId || context.rideId || context.tripId) {
    return 'RobotaxiPrototypeTrip';
  }
  return 'RobotaxiPrototypeSupport';
}

function TicketTypeRow({ item, active, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      style={[styles.typeRow, active && styles.typeRowActive]}
      testID={`robotaxi-support-ticket-type-${item.id}`}
      accessibilityLabel={`robotaxi-support-ticket-type-${item.id}`}
    >
      <View style={styles.typeIcon}>
        <Ionicons name={item.icon} size={17} color={active ? leafRideColors.leaf : leafRideColors.text} />
      </View>
      <View style={styles.typeCopy}>
        <Text style={styles.typeTitle}>{item.title}</Text>
        <Text style={styles.typeSubtitle}>{item.subtitle}</Text>
      </View>
      <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={active ? leafRideColors.leaf : leafRideColors.muted} />
    </TouchableOpacity>
  );
}

export default function RobotaxiSupportTicketScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(windowHeight);
  const initialType = route?.params?.type || route?.params?.selectedType || 'trip';
  const [selectedTypeId, setSelectedTypeId] = useState(initialType);
  const [subject, setSubject] = useState(route?.params?.subject || '');
  const [description, setDescription] = useState(route?.params?.description || '');
  const [createdTicket, setCreatedTicket] = useState(null);
  const { openSupportTicket, supportLoading, supportError } = usePrototypeRideRuntime();
  const bookingId = pickTicketContextText(
    route?.params?.bookingId,
    route?.params?.rideId,
    route?.params?.tripId,
    route?.params?.activeBookingId,
  );
  const bookingStatus = normalizeRuntimeRideStatus(pickTicketContextText(route?.params?.bookingStatus, route?.params?.status));
  const supportSource = pickTicketContextText(route?.params?.source, bookingId ? 'support-ticket' : '');
  const ticketChatContext = useMemo(
    () => ({
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(bookingStatus ? { bookingStatus } : {}),
      source: supportSource || 'support-ticket',
    }),
    [bookingId, bookingStatus, supportSource],
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-support-ticket',
    occludedBottom: panelHeight,
  });

  const selectedType = useMemo(
    () => TICKET_TYPES.find(item => item.id === selectedTypeId) || TICKET_TYPES[0],
    [selectedTypeId],
  );
  const canSubmit = description.trim().length >= 12;

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate(resolveTicketReturnRoute(ticketChatContext), ticketChatContext);
  }, [navigation, ticketChatContext]);

  const handlePanelLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPanelHeight(nextHeight);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      Alert.alert('Conte um pouco mais', 'Descreva o que aconteceu com pelo menos 12 caracteres.');
      return;
    }

    try {
      const result = await openSupportTicket({
        type: selectedType.id,
        priority: selectedType.id === 'safety' ? 'N1' : 'N3',
        subject: subject.trim() || selectedType.title,
        description: `${subject.trim() || selectedType.title}: ${description.trim()}`,
        ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
        ...(bookingStatus ? { bookingStatus } : {}),
        ...(supportSource ? { source: supportSource } : {}),
      });
      setCreatedTicket(result?.ticket || null);
    } catch (error) {
      Alert.alert('Não foi possível abrir ticket', error?.message || 'Tente novamente em instantes.');
    }
  }, [
    bookingId,
    bookingStatus,
    canSubmit,
    description,
    openSupportTicket,
    selectedType.id,
    selectedType.title,
    subject,
    supportSource,
  ]);

  const handleOpenCreatedTicketChat = useCallback(() => {
    if (ticketChatContext.bookingId || ticketChatContext.rideId || ticketChatContext.tripId) {
      navigation.replace('RobotaxiPrototypeChat', ticketChatContext);
      return;
    }

    navigation.replace('Support', {
      initialTab: 'chat',
      source: ticketChatContext.source || 'support-ticket',
      ticketId: createdTicket?.id || null,
    });
  }, [createdTicket?.id, navigation, ticketChatContext]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none" testID="robotaxi-support-ticket-screen">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropColor={BACKDROP_COLOR}
          dragEnabled={false}
          sheetStyle={styles.sheetWrap}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Math.max(0, insets.top - 4)}
            style={styles.keyboardAvoiding}
          >
            <PrototypeMenuSurface
              onLayout={handlePanelLayout}
              eyebrow="Suporte"
              title="Abrir ticket"
              subtitle="Registre o problema com contexto suficiente para a operação agir rápido."
              fullScreen
              style={{
                paddingTop: insets.top + SURFACE_TOP_PADDING,
                paddingBottom: Math.max(insets.bottom, SURFACE_BOTTOM_PADDING),
              }}
              headerAccessory={(
                <PrototypeMenuCloseButton
                  onPress={handleDismiss}
                  testID="robotaxi-support-ticket-close-button"
                  accessibilityLabel="robotaxi-support-ticket-close-button"
                />
              )}
            >
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <PrototypeMenuSection title="Tipo de atendimento">
                  {TICKET_TYPES.map(item => (
                    <TicketTypeRow
                      key={item.id}
                      item={item}
                      active={item.id === selectedTypeId}
                      onPress={() => setSelectedTypeId(item.id)}
                    />
                  ))}
                </PrototypeMenuSection>

                <View style={styles.formBlock}>
                  <Text style={styles.inputLabel}>Assunto</Text>
                  <TextInput
                    value={subject}
                    onChangeText={setSubject}
                    placeholder={selectedType.title}
                    placeholderTextColor={leafRideColors.muted}
                    style={styles.input}
                    testID="robotaxi-support-ticket-subject"
                    accessibilityLabel="robotaxi-support-ticket-subject"
                  />
                  <Text style={styles.inputLabel}>Detalhes</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Explique o que aconteceu e quando percebeu o problema."
                    placeholderTextColor={leafRideColors.muted}
                    style={[styles.input, styles.textarea]}
                    multiline
                    textAlignVertical="top"
                    testID="robotaxi-support-ticket-description"
                    accessibilityLabel="robotaxi-support-ticket-description"
                  />
                </View>

                <LeafButton
                  label={supportLoading ? 'Enviando...' : 'Enviar ticket'}
                  icon="send-outline"
                  tone="primary"
                  disabled={supportLoading || !canSubmit}
                  onPress={handleSubmit}
                  style={styles.doneButton}
                  testID="robotaxi-support-ticket-submit"
                  accessibilityLabel="robotaxi-support-ticket-submit"
                />

                {supportLoading ? (
                  <View style={styles.feedbackRow}>
                    <ActivityIndicator size="small" color={leafRideColors.leaf} />
                    <Text style={styles.feedbackText}>Sincronizando com suporte...</Text>
                  </View>
                ) : null}
                {supportError ? <Text style={styles.errorText}>{supportError}</Text> : null}
                {createdTicket?.id ? (
                  <LeafEmptyState
                    icon="checkmark-circle-outline"
                    title={`Ticket #${createdTicket.id} criado`}
                    message="A operação recebeu sua solicitação. Você pode acompanhar pelo chat de suporte."
                    actionLabel="Abrir chat"
                    onAction={handleOpenCreatedTicketChat}
                    testID="robotaxi-support-ticket-created"
                  />
                ) : null}
              </ScrollView>
            </PrototypeMenuSurface>
          </KeyboardAvoidingView>
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
  keyboardAvoiding: {
    flex: 1,
  },
  content: {
    paddingTop: 18,
    paddingBottom: 34,
    gap: 18,
  },
  typeRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: leafRideColors.line,
    paddingVertical: 10,
  },
  typeRowActive: {
    backgroundColor: 'rgba(15,59,22,0.04)',
  },
  typeIcon: {
    width: 30,
    alignItems: 'flex-start',
  },
  typeCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  typeTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 19,
  },
  typeSubtitle: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  formBlock: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  inputLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 8,
  },
  input: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: leafRideColors.bg,
    paddingHorizontal: 14,
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  textarea: {
    minHeight: 116,
    paddingTop: 12,
    marginBottom: 0,
  },
  doneButton: {
    alignSelf: 'stretch',
  },
  feedbackRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 17,
  },
});
